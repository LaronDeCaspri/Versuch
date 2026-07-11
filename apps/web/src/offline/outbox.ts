import { api, ApiError } from "../api/client.js";
import type { FileUploadResult, RecordPayload } from "../api/types.js";

/**
 * Offline outbox: an IndexedDB-backed queue of record submissions that could not
 * reach the server (no signal in the plant room). Each item carries the raw
 * certificate File so the whole submission survives a reload. A module-level store
 * exposes a synchronous snapshot for React's useSyncExternalStore and drives the
 * pending badges; flushing is guarded so concurrent triggers cannot race.
 */

const DB_NAME = "cmp-outbox";
const STORE = "pending";
const DB_VERSION = 1;

interface OutboxItemBase {
  /** IndexedDB auto-increment key; absent until stored. */
  id: number;
  dutyId: string;
  payload: RecordPayload;
  /** Raw certificate blob, uploaded at flush time to obtain a certificateId. */
  certificate?: File;
  createdAt: number;
}

export type OutboxItem =
  | (OutboxItemBase & { kind: "submit" })
  | (OutboxItemBase & { kind: "supersede"; recordId: string });

/** Shape passed to enqueue(), before an id is assigned. */
export type NewOutboxItem =
  | { kind: "submit"; dutyId: string; payload: RecordPayload; certificate?: File }
  | { kind: "supersede"; dutyId: string; recordId: string; payload: RecordPayload; certificate?: File };

// --- Typed Promise wrappers over the IndexedDB callback API ------------------

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise !== null) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open outbox database"));
  });
  return dbPromise;
}

async function addItem(item: NewOutboxItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    // The store assigns `id`; strip any absent optional so the record stays clean.
    const stored =
      item.certificate === undefined
        ? { ...item, createdAt: Date.now() }
        : { ...item, certificate: item.certificate, createdAt: Date.now() };
    tx.objectStore(STORE).add(stored);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to enqueue"));
    tx.onabort = () => reject(tx.error ?? new Error("Enqueue aborted"));
  });
}

async function getAllItems(): Promise<OutboxItem[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const rows = await promisify<OutboxItem[]>(tx.objectStore(STORE).getAll() as IDBRequest<OutboxItem[]>);
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

async function deleteItem(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Failed to remove outbox item"));
    tx.onabort = () => reject(tx.error ?? new Error("Remove aborted"));
  });
}

// --- Reactive store ----------------------------------------------------------

export interface OutboxSnapshot {
  count: number;
  items: OutboxItem[];
}

const EMPTY: OutboxSnapshot = { count: 0, items: [] };
let snapshot: OutboxSnapshot = EMPTY;
const countListeners = new Set<() => void>();
const flushedListeners = new Set<() => void>();

function notifyCount(): void {
  for (const listener of countListeners) listener();
}

function notifyFlushed(): void {
  for (const listener of flushedListeners) listener();
}

async function refreshSnapshot(): Promise<void> {
  const items = await getAllItems();
  snapshot = { count: items.length, items };
  notifyCount();
}

export function subscribeCount(listener: () => void): () => void {
  countListeners.add(listener);
  return () => {
    countListeners.delete(listener);
  };
}

/** Notified after a flush that changed server state, so views can reload. */
export function subscribeFlushed(listener: () => void): () => void {
  flushedListeners.add(listener);
  return () => {
    flushedListeners.delete(listener);
  };
}

export function getSnapshot(): OutboxSnapshot {
  return snapshot;
}

export async function enqueue(item: NewOutboxItem): Promise<void> {
  await addItem(item);
  await refreshSnapshot();
}

// --- Flushing ----------------------------------------------------------------

let flushing = false;

/**
 * Sends every queued item: upload its certificate (if any) to get a certificateId,
 * then POST the record or supersede. Successful items are removed; failures stay
 * queued for the next attempt. Guarded so overlapping triggers (online event +
 * mount) cannot double-send.
 */
export async function flush(): Promise<void> {
  if (flushing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  flushing = true;
  let changed = false;
  try {
    const items = await getAllItems();
    for (const item of items) {
      try {
        let certificateId: string | undefined;
        if (item.certificate !== undefined) {
          const uploaded = await api.upload<FileUploadResult>("/files", item.certificate);
          certificateId = uploaded.id;
        }
        const body: RecordPayload & { certificateId?: string } =
          certificateId === undefined ? { ...item.payload } : { ...item.payload, certificateId };
        if (item.kind === "supersede") {
          await api.post(`/records/${item.recordId}/supersede`, body);
        } else {
          await api.post(`/asset-duties/${item.dutyId}/records`, body);
        }
        await deleteItem(item.id);
        changed = true;
      } catch (err) {
        // A network error (offline again) means the rest will fail too; stop and
        // retry the whole queue later. A server ApiError leaves the item queued
        // per spec, so move on to the next item.
        if (!(err instanceof ApiError)) break;
      }
    }
  } finally {
    flushing = false;
  }
  if (changed) {
    await refreshSnapshot();
    notifyFlushed();
  }
}

// --- Auto-flush wiring (runs once at module load) ----------------------------

if (typeof window !== "undefined") {
  void refreshSnapshot();
  window.addEventListener("online", () => {
    void flush();
  });
  if (navigator.onLine) void flush();
}
