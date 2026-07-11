import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  enqueue as enqueueItem,
  flush as flushOutbox,
  getSnapshot,
  subscribeCount,
  subscribeFlushed,
  type NewOutboxItem,
  type OutboxItem,
} from "./outbox.js";

export interface UseOutbox {
  /** Number of submissions still waiting to sync. */
  pending: number;
  /** All queued items (used to render per-record "pending sync" rows). */
  items: OutboxItem[];
  enqueue: (item: NewOutboxItem) => Promise<void>;
  flush: () => Promise<void>;
}

/**
 * Subscribes to the shared offline outbox. Pass `onFlushed` to reload visible data
 * after a successful flush (e.g. a page reloading its records once they sync). The
 * hook also attempts a flush on mount when online, covering the post-login case.
 */
export function useOutbox(onFlushed?: () => void): UseOutbox {
  const snapshot = useSyncExternalStore(subscribeCount, getSnapshot, getSnapshot);

  useEffect(() => {
    if (onFlushed === undefined) return;
    return subscribeFlushed(onFlushed);
  }, [onFlushed]);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine) void flushOutbox();
  }, []);

  const enqueue = useCallback((item: NewOutboxItem) => enqueueItem(item), []);
  const flush = useCallback(() => flushOutbox(), []);

  return { pending: snapshot.count, items: snapshot.items, enqueue, flush };
}
