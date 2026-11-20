// IndexedDB persistence. Everything except media is mirrored in memory by Collection; this module only reads/writes.

const DB_NAME = 'flashcards';
const DB_VERSION = 1;
export const STORES = ['meta', 'decks', 'configs', 'notetypes', 'notes', 'cards', 'revlog', 'today', 'media'];

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (db.objectStoreNames.contains(s)) continue;
        if (s === 'meta' || s === 'today' || s === 'media') db.createObjectStore(s);
        else db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is open in another tab. Close other tabs and reload.'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}

export async function getAll(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function getAllWithKeys(store) {
  const db = await openDB();
  const tx = db.transaction(store);
  const os = tx.objectStore(store);
  const [keys, values] = await Promise.all([reqP(os.getAllKeys()), reqP(os.getAll())]);
  return keys.map((k, i) => [k, values[i]]);
}

export async function get(store, key) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(key));
}

export async function getKeys(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAllKeys());
}

/**
 * Applies a batch of writes in one transaction.
 * ops: [{store, put: value, key?}] or [{store, del: key}] or [{store, clear: true}]
 */
export async function write(ops) {
  if (!ops.length) return;
  const db = await openDB();
  const stores = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(stores, 'readwrite');
  for (const o of ops) {
    const os = tx.objectStore(o.store);
    if (o.clear) os.clear();
    else if ('del' in o) os.delete(o.del);
    else if (o.key !== undefined) os.put(o.put, o.key);
    else os.put(o.put);
  }
  return done(tx);
}

export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const s of STORES) tx.objectStore(s).clear();
  return done(tx);
}
