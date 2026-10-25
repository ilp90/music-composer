import type { CreateRecordingBody, UploadTarget } from '@mc/shared';
import { ApiError } from '../../lib/apiClient';
import type { LocalRecording, LocalRecordingStore } from './localStore';

export interface UploaderDeps {
  store: LocalRecordingStore;
  createUpload(body: CreateRecordingBody): Promise<UploadTarget>;
  /** Fresh part URLs for an upload the API already knows (the old ones may have expired). */
  resumeUpload(recordingId: string): Promise<UploadTarget>;
  complete(
    recordingId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<unknown>;
  /** PUTs one part straight to S3; resolves with its ETag. */
  putPart(url: string, body: Blob): Promise<string>;
  sleep(ms: number): Promise<void>;
}

const PART_CONCURRENCY = 3;
const PART_ATTEMPTS = 4;

const isApiError = (err: unknown, ...codes: string[]): err is ApiError =>
  err instanceof ApiError && codes.includes(err.code);

async function withRetries<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= PART_ATTEMPTS) throw err;
      // Exponential backoff with jitter: ~1 s, 2 s, 4 s.
      await sleep(2 ** (attempt - 1) * 1000 * (0.75 + Math.random() * 0.5));
    }
  }
}

/** Runs `fn` over `items` with at most `limit` in flight; rejects on the first failure. */
async function forEachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item);
    }),
  );
}

/**
 * Uploads one saved recording: start (or resume) the multipart upload, PUT the missing parts
 * straight to S3, then complete it. Progress is saved after every part, so a retry only sends
 * what's left. Resolves 'done' (local copy deleted) or 'failed' (permanent; kept with a reason);
 * rejects on transient errors (offline, 5xx), leaving the item queued for a later retry.
 */
export async function uploadRecording(
  saved: LocalRecording,
  deps: UploaderDeps,
): Promise<'done' | 'failed'> {
  let item: LocalRecording = { ...saved, etags: { ...saved.etags } };
  const save = () => deps.store.put(item);
  const fail = async (failure: string) => {
    item = { ...item, failure };
    await save();
    return 'failed' as const;
  };

  let target: UploadTarget | undefined;
  if (item.recordingId) {
    try {
      target = await deps.resumeUpload(item.recordingId);
    } catch (err) {
      if (isApiError(err, 'CONFLICT')) {
        // Already completed (an earlier attempt's response was lost): nothing left to do.
        await deps.store.delete(item.localId);
        return 'done';
      }
      if (!isApiError(err, 'NOT_FOUND')) throw err;
      // The server discarded the upload (e.g. a failed size check): start over.
      item = { ...item, etags: {} };
      delete item.recordingId;
    }
  }

  if (!target) {
    try {
      target = await deps.createUpload({
        mimeType: item.mimeType,
        sizeBytes: item.blob.size,
        durationMs: item.durationMs,
      });
    } catch (err) {
      if (isApiError(err, 'QUOTA_EXCEEDED', 'VALIDATION_ERROR'))
        return fail((err as ApiError).message);
      throw err;
    }
    item = { ...item, recordingId: target.recordingId, partSize: target.partSize, etags: {} };
    await save();
  }

  const missing = target.partUrls.filter((p) => !item.etags[p.partNumber]);
  await forEachLimited(missing, PART_CONCURRENCY, async ({ partNumber, url }) => {
    const start = (partNumber - 1) * target.partSize;
    const etag = await withRetries(
      () => deps.putPart(url, item.blob.slice(start, start + target.partSize)),
      deps.sleep,
    );
    item = { ...item, etags: { ...item.etags, [partNumber]: etag } };
    await save();
  });

  const parts = target.partUrls.map(({ partNumber }) => ({
    partNumber,
    etag: item.etags[partNumber]!,
  }));
  try {
    await deps.complete(target.recordingId, parts);
  } catch (err) {
    if (isApiError(err, 'UPLOAD_INCOMPLETE')) {
      // Parts were lost or rejected: forget them so the next attempt re-sends everything.
      item = { ...item, etags: {} };
      await save();
    }
    throw err;
  }

  await deps.store.delete(item.localId);
  return 'done';
}
