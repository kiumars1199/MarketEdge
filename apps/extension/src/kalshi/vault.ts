// Key vault: one Kalshi key in IndexedDB as a NON-extractable CryptoKey (docs/16 §3, docs/15 § Trading keys).
// The private key bytes can't be read back out, by us or by anyone who gets this extension's storage.
import type { KeyType } from "./sign";

export interface StoredKey { keyId: string; key: CryptoKey; type: KeyType; scopes: string[]; verifiedAt: number }

const DB = "kismet-vault";
const STORE = "keys";
const ID = "kalshi-demo";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  }).finally(() => db.close());
}

export const loadKey = () => tx<StoredKey | undefined>("readonly", (s) => s.get(ID));
export const saveKey = (k: StoredKey) => tx<unknown>("readwrite", (s) => s.put(k, ID));
export const deleteKey = () => tx<unknown>("readwrite", (s) => s.delete(ID));

/** "a952…608c": enough to recognise the key, nothing more. */
export const maskId = (id: string) => (id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : "••••");
