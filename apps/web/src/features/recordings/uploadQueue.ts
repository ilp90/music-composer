import { Recording, UploadTarget } from '@mc/shared';
import { api } from '../../lib/apiClient';
import { indexedDbStore, type LocalRecording } from './localStore';
import { uploadRecording, type UploaderDeps } from './uploader';

const deps: UploaderDeps = {
  store: indexedDbStore,
  createUpload: (body) => api.post('/recordings', body, UploadTarget),
  resumeUpload: (id) => api.post(`/recordings/${id}/upload-urls`, undefined, UploadTarget),
  complete: (id, parts) => api.post(`/recordings/${id}/complete`, { parts }, Recording),
  async putPart(url, body) {
    const res = await fetch(url, { method: 'PUT', body });
    if (!res.ok) throw new Error(`Part upload failed (${res.status})`);
    const etag = res.headers.get('etag');
    // Readable only if the bucket's CORS exposes ETag (local-init / CDK configure this).
    if (!etag) throw new Error('S3 did not expose the part ETag');
    return etag;
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const uploadedListeners = new Set<() => void>();

/** Called after each recording finishes uploading (e.g. to refresh the recordings list). */
export function onRecordingUploaded(listener: () => void): () => void {
  uploadedListeners.add(listener);
  return () => uploadedListeners.delete(listener);
}

let running: Promise<void> | null = null;

/**
 * Uploads the user's queued recordings, oldest first, one at a time. Single-flight: calls while a
 * run is in progress join it. A transient failure (offline, API down) ends the run; the next
 * trigger (app start, `online` event, new recording, periodic retry) picks up where it left off.
 */
export function processUploads(userId: string): Promise<void> {
  running ??= (async () => {
    const items = (await indexedDbStore.listForUser(userId)).filter((i) => !i.failure).reverse();
    for (const item of items) {
      try {
        if ((await uploadRecording(item, deps)) === 'done') {
          uploadedListeners.forEach((listener) => listener());
        }
      } catch {
        return; // likely offline; try again later
      }
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Saves a finished recording locally first, then starts uploading it. */
export async function saveRecording(
  userId: string,
  recording: { blob: Blob; mimeType: string; durationMs: number },
): Promise<void> {
  const item: LocalRecording = {
    localId: crypto.randomUUID(),
    userId,
    ...recording,
    createdAt: new Date().toISOString(),
    etags: {},
  };
  await indexedDbStore.put(item);
  void processUploads(userId);
}

export function discardLocalRecording(localId: string): Promise<void> {
  return indexedDbStore.delete(localId);
}

/** Clears a permanent failure so the recording is tried again (e.g. after freeing quota). */
export async function retryLocalRecording(item: LocalRecording): Promise<void> {
  const { failure: _failure, ...rest } = item;
  await indexedDbStore.put(rest);
  void processUploads(item.userId);
}
