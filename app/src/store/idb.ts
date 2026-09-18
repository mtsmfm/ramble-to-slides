/** Remembering the last project directory handle in IndexedDB. Failures are never fatal. */

const DB_NAME = "ramble-to-slides";
const DB_VERSION = 1;
const STORE = "handles";
const KEY = "last-project";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        let req: IDBRequest<T>;
        try {
          req = run(db.transaction(STORE, mode).objectStore(STORE));
        } catch {
          db.close();
          resolve(null);
          return;
        }
        req.onsuccess = () => {
          resolve(req.result ?? null);
          db.close();
        };
        req.onerror = () => {
          resolve(null);
          db.close();
        };
      }),
  );
}

export async function saveLastHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await tx("readwrite", (s) => s.put(handle, KEY) as IDBRequest<unknown>);
}

export async function loadLastHandle(): Promise<FileSystemDirectoryHandle | null> {
  const v = await tx<unknown>("readonly", (s) => s.get(KEY) as IDBRequest<unknown>);
  if (!v || typeof v !== "object") return null;
  const handle = v as FileSystemDirectoryHandle;
  return handle.kind === "directory" ? handle : null;
}

export async function clearLastHandle(): Promise<void> {
  await tx("readwrite", (s) => s.delete(KEY) as IDBRequest<unknown>);
}
