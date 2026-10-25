/**
 * Recordings waiting to upload, kept in IndexedDB so a network/API outage, a closed tab or a crash
 * never loses one (SPEC §2.3). Each item also records upload progress, so uploads resume.
 */
export interface LocalRecording {
  localId: string;
  userId: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  createdAt: string;
  /** Set once the API has accepted the upload. */
  recordingId?: string;
  partSize?: number;
  /** ETags of parts already uploaded, by part number. */
  etags: Record<number, string>;
  /** Set when retrying won't help (e.g. storage quota full); the blob stays for download. */
  failure?: string;
}

export interface LocalRecordingStore {
  put(item: LocalRecording): Promise<void>;
  delete(localId: string): Promise<void>;
  listForUser(userId: string): Promise<LocalRecording[]>;
}

const DB_NAME = 'music-composer';
const STORE = 'pending-recordings';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result
        .createObjectStore(STORE, { keyPath: 'localId' })
        .createIndex('userId', 'userId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

const changeListeners = new Set<() => void>();
const notify = () => changeListeners.forEach((listener) => listener());

/** Called after any change, so the UI can re-read the queue. */
export function onLocalRecordingsChange(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

export const indexedDbStore: LocalRecordingStore = {
  async put(item) {
    await run('readwrite', (s) => s.put(item));
    notify();
  },
  async delete(localId) {
    await run('readwrite', (s) => s.delete(localId));
    notify();
  },
  async listForUser(userId) {
    const items = await run('readonly', (s) => s.index('userId').getAll(userId));
    return (items as LocalRecording[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};
