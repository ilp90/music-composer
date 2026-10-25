import { z } from 'zod';

/** Recording limits (SPEC §2.3). The client enforces them while recording; the API enforces them again. */
export const MAX_RECORDING_MS = 5 * 60 * 1000;
/** 5 min at ~2.6 Mbps is ~100 MB; leave headroom for encoder variance. */
export const MAX_RECORDING_BYTES = 200 * 1024 * 1024;
export const RECORDING_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** MediaRecorder output: WebM (Chrome, Firefox, Edge) or MP4 (Safari), optionally with codecs. */
export const RecordingMimeType = z
  .string()
  .max(100)
  .regex(/^video\/(webm|mp4)(;.*)?$/, 'Unsupported recording format');

export const CreateRecordingBody = z.object({
  mimeType: RecordingMimeType,
  sizeBytes: z.number().int().positive().max(MAX_RECORDING_BYTES),
  // A little slack over the cap: the recorder stops on a timer, and the last chunk lands after it.
  durationMs: z
    .number()
    .int()
    .nonnegative()
    .max(MAX_RECORDING_MS + 10_000),
});
export type CreateRecordingBody = z.infer<typeof CreateRecordingBody>;

export const PartUrl = z.object({ partNumber: z.number().int().positive(), url: z.url() });

/** Where to PUT each part of a multipart upload (straight to S3; never through the API). */
export const UploadTarget = z.object({
  recordingId: z.string(),
  partSize: z.number().int().positive(),
  partUrls: z.array(PartUrl).min(1),
  expiresAt: z.iso.datetime(),
});
export type UploadTarget = z.infer<typeof UploadTarget>;

export const CompleteRecordingBody = z.object({
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10_000),
        etag: z.string().min(1).max(200),
      }),
    )
    .min(1)
    .max(10_000),
});
export type CompleteRecordingBody = z.infer<typeof CompleteRecordingBody>;

export const Recording = z.object({
  id: z.string(),
  status: z.enum(['pending', 'ready']),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  durationMs: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type Recording = z.infer<typeof Recording>;

export const RecordingPage = z.object({
  items: z.array(Recording),
  nextCursor: z.string().nullable(),
});
export type RecordingPage = z.infer<typeof RecordingPage>;

export const RecordingUrl = z.object({ url: z.url(), expiresAt: z.iso.datetime() });
export type RecordingUrl = z.infer<typeof RecordingUrl>;
