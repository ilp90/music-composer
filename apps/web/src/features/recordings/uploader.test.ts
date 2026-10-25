import type { UploadTarget } from '@mc/shared';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/apiClient';
import type { LocalRecording, LocalRecordingStore } from './localStore';
import { uploadRecording, type UploaderDeps } from './uploader';

const PART = 4;

function memoryStore() {
  const items = new Map<string, LocalRecording>();
  const store: LocalRecordingStore = {
    put: async (item) => void items.set(item.localId, { ...item, etags: { ...item.etags } }),
    delete: async (id) => void items.delete(id),
    listForUser: async (userId) => [...items.values()].filter((i) => i.userId === userId),
  };
  return { store, items };
}

const saved = (overrides: Partial<LocalRecording> = {}): LocalRecording => ({
  localId: 'local-1',
  userId: 'u1',
  blob: new Blob(['0123456789']), // 10 bytes → 3 parts of 4
  mimeType: 'video/webm',
  durationMs: 3000,
  createdAt: '2026-10-24T00:00:00.000Z',
  etags: {},
  ...overrides,
});

const target = (recordingId = 'rec-1'): UploadTarget => ({
  recordingId,
  partSize: PART,
  partUrls: [1, 2, 3].map((n) => ({ partNumber: n, url: `https://s3.test/part-${n}` })),
  expiresAt: '2026-10-24T01:00:00.000Z',
});

/** Fake API + S3. `failPart` makes a part's PUT fail that many times before succeeding. */
function fakes(options: { failPart?: Record<number, number> } = {}) {
  const { store, items } = memoryStore();
  const uploaded = new Map<number, string>();
  const failures = { ...options.failPart };
  const deps = {
    store,
    createUpload: vi.fn(async () => target()),
    resumeUpload: vi.fn(async (id: string) => target(id)),
    complete: vi.fn(async () => ({})),
    putPart: vi.fn(async (url: string, body: Blob) => {
      const n = Number(url.split('-').pop());
      if ((failures[n] ?? 0) > 0) {
        failures[n]!--;
        throw new Error('network');
      }
      uploaded.set(n, await body.text());
      return `"etag-${n}"`;
    }),
    sleep: vi.fn(async () => {}),
  } satisfies UploaderDeps;
  return { deps, items, uploaded };
}

describe('uploadRecording', () => {
  it('creates the upload, PUTs each slice, completes, and deletes the local copy', async () => {
    const { deps, items, uploaded } = fakes();
    await deps.store.put(saved());

    expect(await uploadRecording(saved(), deps)).toBe('done');
    expect(deps.createUpload).toHaveBeenCalledWith({
      mimeType: 'video/webm',
      sizeBytes: 10,
      durationMs: 3000,
    });
    expect(Object.fromEntries(uploaded)).toEqual({ 1: '0123', 2: '4567', 3: '89' });
    expect(deps.complete).toHaveBeenCalledWith('rec-1', [
      { partNumber: 1, etag: '"etag-1"' },
      { partNumber: 2, etag: '"etag-2"' },
      { partNumber: 3, etag: '"etag-3"' },
    ]);
    expect(items.size).toBe(0);
  });

  it('retries a flaky part with backoff', async () => {
    const { deps } = fakes({ failPart: { 2: 2 } });

    expect(await uploadRecording(saved(), deps)).toBe('done');
    expect(deps.putPart.mock.calls.filter(([url]) => url.endsWith('part-2'))).toHaveLength(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up on a run after repeated part failures, keeping progress for next time', async () => {
    const { deps, items } = fakes({ failPart: { 3: 99 } });
    await deps.store.put(saved());

    await expect(uploadRecording(saved(), deps)).rejects.toThrow('network');
    const kept = items.get('local-1')!;
    expect(kept.recordingId).toBe('rec-1');
    expect(kept.etags).toEqual({ 1: '"etag-1"', 2: '"etag-2"' });
    expect(deps.complete).not.toHaveBeenCalled();
  });

  it('resumes: fresh URLs for the same upload, and only the missing parts are sent', async () => {
    const { deps, uploaded } = fakes();
    const partial = saved({
      recordingId: 'rec-9',
      partSize: PART,
      etags: { 1: '"etag-1"', 2: '"etag-2"' },
    });

    expect(await uploadRecording(partial, deps)).toBe('done');
    expect(deps.createUpload).not.toHaveBeenCalled();
    expect(deps.resumeUpload).toHaveBeenCalledWith('rec-9');
    expect([...uploaded.keys()]).toEqual([3]);
    expect(deps.complete).toHaveBeenCalledWith('rec-9', expect.any(Array));
  });

  it('starts over if the server no longer knows the upload', async () => {
    const { deps } = fakes();
    deps.resumeUpload.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'gone'));

    expect(await uploadRecording(saved({ recordingId: 'old', etags: { 1: 'x' } }), deps)).toBe(
      'done',
    );
    expect(deps.createUpload).toHaveBeenCalledOnce();
    expect(deps.putPart).toHaveBeenCalledTimes(3);
  });

  it('treats an already-completed upload as done', async () => {
    const { deps, items } = fakes();
    await deps.store.put(saved({ recordingId: 'rec-1' }));
    deps.resumeUpload.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'already uploaded'));

    expect(await uploadRecording(saved({ recordingId: 'rec-1' }), deps)).toBe('done');
    expect(deps.putPart).not.toHaveBeenCalled();
    expect(items.size).toBe(0);
  });

  it('marks a full quota as a permanent failure and keeps the video', async () => {
    const { deps, items } = fakes();
    deps.createUpload.mockRejectedValueOnce(new ApiError(409, 'QUOTA_EXCEEDED', 'Storage full'));

    expect(await uploadRecording(saved(), deps)).toBe('failed');
    expect(items.get('local-1')).toMatchObject({ failure: 'Storage full' });
    expect(items.get('local-1')!.blob.size).toBe(10);
  });

  it('leaves the item queued when the API is unreachable', async () => {
    const { deps, items } = fakes();
    await deps.store.put(saved());
    deps.createUpload.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    await expect(uploadRecording(saved(), deps)).rejects.toThrow('offline');
    expect(items.get('local-1')).toBeDefined();
    expect(items.get('local-1')!.failure).toBeUndefined();
  });

  it('forgets uploaded parts when the server rejects the part list, so the next try re-sends them', async () => {
    const { deps, items } = fakes();
    deps.complete.mockRejectedValueOnce(new ApiError(400, 'UPLOAD_INCOMPLETE', 'missing parts'));

    await expect(uploadRecording(saved(), deps)).rejects.toThrow('missing parts');
    expect(items.get('local-1')).toMatchObject({ recordingId: 'rec-1', etags: {} });
  });
});
