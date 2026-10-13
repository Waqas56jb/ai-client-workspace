/**
 * Minimal IndexedDB blob store for files uploaded in demo mode.
 *
 * Browser-held files are temporary: they can be evicted by the browser, are not
 * shared across devices, and disappear when site data is cleared. The UI always
 * handles a missing blob gracefully. Permanent storage arrives with Supabase Storage.
 */
const DB_NAME = 'studioflow-demo-files';
const STORE = 'blobs';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        const req = fn(store);
        t.oncomplete = () => resolve(req?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export const blobStore = {
  put: (id, blob) => tx('readwrite', (s) => s.put(blob, id)),
  get: (id) => tx('readonly', (s) => s.get(id)).catch(() => undefined),
  remove: (id) => tx('readwrite', (s) => s.delete(id)).catch(() => undefined),
  clear: () => tx('readwrite', (s) => s.clear()).catch(() => undefined),
  async totalSize() {
    try {
      const all = await tx('readonly', (s) => s.getAll());
      return (all || []).reduce((sum, b) => sum + (b?.size || 0), 0);
    } catch {
      return 0;
    }
  },
};
