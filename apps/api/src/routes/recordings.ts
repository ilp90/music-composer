import {
  CompleteRecordingBody,
  CreateRecordingBody,
  type Recording,
  type RecordingPage,
  type RecordingUrl,
  type UploadTarget,
} from '@mc/shared';
import type { FastifyPluginAsync } from 'fastify';
import { ulid } from 'ulid';
import { z } from 'zod';
import type { Config } from '../config';
import { AppError } from '../errors';
import { requireAuth } from '../plugins/authGuard';
import {
  QuotaExceededError,
  type RecordingRecord,
  type RecordingsRepository,
} from '../repositories/recordings';
import type { Storage } from '../services/storage';
import type { TokenService } from '../services/tokens';

export interface RecordingRoutesOptions {
  config: Config;
  recordings: RecordingsRepository;
  storage: Storage;
  tokens: TokenService;
  now: () => Date;
}

const IdParams = z.object({ id: z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/) });
const ListQuery = z.object({
  cursor: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
const UrlQuery = z.object({ download: z.enum(['0', '1']).optional() });

const extensionFor = (mimeType: string) => (mimeType.startsWith('video/mp4') ? 'mp4' : 'webm');

function toPublic(r: RecordingRecord): Recording {
  const { id, status, mimeType, sizeBytes, durationMs, createdAt } = r;
  return { id, status, mimeType, sizeBytes, durationMs, createdAt };
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Recording not found');

export const recordingRoutes: FastifyPluginAsync<RecordingRoutesOptions> = async (app, opts) => {
  const { config, recordings, storage, tokens, now } = opts;
  app.addHook('preHandler', requireAuth(tokens));

  /** Every lookup is in the caller's own partition: other users' recordings are simply "not found". */
  async function load(userId: string, params: unknown): Promise<RecordingRecord> {
    const parsed = IdParams.safeParse(params);
    if (!parsed.success) throw notFound();
    const recording = await recordings.get(userId, parsed.data.id);
    if (!recording) throw notFound();
    return recording;
  }

  async function uploadTarget(r: RecordingRecord): Promise<UploadTarget> {
    const partCount = Math.ceil(r.sizeBytes / config.RECORDING_PART_BYTES);
    const expiresIn = config.UPLOAD_URL_TTL_SECONDS;
    return {
      recordingId: r.id,
      partSize: config.RECORDING_PART_BYTES,
      partUrls: await storage.presignParts(r.s3Key, r.uploadId, partCount, expiresIn),
      expiresAt: new Date(now().getTime() + expiresIn * 1000).toISOString(),
    };
  }

  /** Starts a multipart upload and reserves quota. The browser then PUTs each part to S3 directly. */
  app.post('/recordings', async (request, reply) => {
    const body = CreateRecordingBody.parse(request.body);
    const id = ulid();
    const s3Key = `recordings/${request.userId}/${id}.${extensionFor(body.mimeType)}`;
    const uploadId = await storage.createMultipartUpload(s3Key, body.mimeType);

    const recording: RecordingRecord = {
      id,
      userId: request.userId,
      status: 'pending',
      s3Key,
      uploadId,
      ...body,
      createdAt: now().toISOString(),
    };
    try {
      await recordings.create(recording, config.RECORDING_QUOTA_BYTES);
    } catch (err) {
      await storage.abortMultipartUpload(s3Key, uploadId).catch(() => {});
      if (err instanceof QuotaExceededError) {
        throw new AppError(
          409,
          'QUOTA_EXCEEDED',
          'Your recording storage is full. Delete some recordings to make room.',
        );
      }
      throw err;
    }

    return reply.status(201).send(await uploadTarget(recording));
  });

  /** Fresh part URLs for resuming an upload after the previous ones expired (e.g. after a reload). */
  app.post('/recordings/:id/upload-urls', async (request) => {
    const recording = await load(request.userId, request.params);
    if (recording.status !== 'pending') {
      throw new AppError(409, 'CONFLICT', 'This recording is already uploaded');
    }
    return uploadTarget(recording);
  });

  /** Assembles the parts and verifies the object before marking it ready. Safe to retry. */
  app.post('/recordings/:id/complete', async (request): Promise<Recording> => {
    const recording = await load(request.userId, request.params);
    if (recording.status === 'ready') return toPublic(recording);
    const { parts } = CompleteRecordingBody.parse(request.body);

    try {
      // false = S3 no longer knows the upload: a previous attempt completed it and its response was lost.
      await storage.completeMultipartUpload(recording.s3Key, recording.uploadId, parts);
    } catch (err) {
      if (
        err instanceof Error &&
        ['InvalidPart', 'InvalidPartOrder', 'EntityTooSmall'].includes(err.name)
      ) {
        throw new AppError(
          400,
          'UPLOAD_INCOMPLETE',
          'Some parts are missing or invalid; upload them and retry',
        );
      }
      throw err;
    }

    // The size was declared up front (for the quota) but uploads aren't size-limited by S3: check it.
    const actualSize = await storage.size(recording.s3Key);
    if (actualSize !== recording.sizeBytes) {
      await storage.delete(recording.s3Key).catch(() => {});
      await recordings.delete(recording);
      throw new AppError(
        400,
        'UPLOAD_INCOMPLETE',
        `Uploaded ${actualSize ?? 0} bytes but ${recording.sizeBytes} were declared`,
      );
    }

    await recordings.markReady(recording.userId, recording.id);
    return toPublic({ ...recording, status: 'ready' });
  });

  app.get('/recordings', async (request): Promise<RecordingPage> => {
    const { cursor, limit } = ListQuery.parse(request.query);
    const page = await recordings.listReady(request.userId, limit, cursor);
    return { items: page.items.map(toPublic), nextCursor: page.nextCursor };
  });

  /** Short-lived signed URL for playback, or for download with `?download=1`. */
  app.get('/recordings/:id/url', async (request): Promise<RecordingUrl> => {
    const recording = await load(request.userId, request.params);
    if (recording.status !== 'ready') throw notFound();
    const { download } = UrlQuery.parse(request.query);
    const expiresIn = config.PLAYBACK_URL_TTL_SECONDS;
    const filename = `music-composer-${recording.createdAt.slice(0, 19).replace(/[:T]/g, '-')}.${extensionFor(recording.mimeType)}`;
    return {
      url: await storage.presignGet(
        recording.s3Key,
        expiresIn,
        download === '1' ? filename : undefined,
      ),
      expiresAt: new Date(now().getTime() + expiresIn * 1000).toISOString(),
    };
  });

  /** Deletes the video and frees its quota. Idempotent. */
  app.delete('/recordings/:id', async (request, reply) => {
    let recording: RecordingRecord;
    try {
      recording = await load(request.userId, request.params);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 404) return reply.status(204).send();
      throw err;
    }
    // Storage first: if it fails, the row stays and the user can retry (no orphaned, billed objects).
    if (recording.status === 'pending') {
      await storage.abortMultipartUpload(recording.s3Key, recording.uploadId);
    }
    await storage.delete(recording.s3Key);
    await recordings.delete(recording);
    return reply.status(204).send();
  });
};
