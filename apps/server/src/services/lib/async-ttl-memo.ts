/**
 * An in-process memo for expensive async lookups: concurrent calls for one key
 * share the in-flight promise, and a settled success is served from memory
 * until it expires. Failures are never stored, so the next call retries.
 */
export interface AsyncTtlMemo<TKey, TValue> {
  clear(): void;
  run(key: TKey, task: () => Promise<TValue>): Promise<TValue>;
}

export interface CreateAsyncTtlMemoOptions {
  ttlMs: number;
  now?: () => number;
}

interface MemoEntry<TValue> {
  expiresAt: number;
  value: TValue;
}

export function createAsyncTtlMemo<TKey, TValue>({
  ttlMs,
  now = Date.now,
}: CreateAsyncTtlMemoOptions): AsyncTtlMemo<TKey, TValue> {
  const settledByKey = new Map<TKey, MemoEntry<TValue>>();
  const pendingByKey = new Map<TKey, Promise<TValue>>();

  function pruneExpired(currentTime: number): void {
    for (const [key, entry] of settledByKey) {
      if (entry.expiresAt <= currentTime) {
        settledByKey.delete(key);
      }
    }
  }

  return {
    clear() {
      settledByKey.clear();
      pendingByKey.clear();
    },
    run(key, task) {
      const currentTime = now();
      const settled = settledByKey.get(key);
      if (settled !== undefined) {
        if (settled.expiresAt > currentTime) {
          return Promise.resolve(settled.value);
        }
        settledByKey.delete(key);
      }
      const pending = pendingByKey.get(key);
      if (pending !== undefined) {
        return pending;
      }
      const started = task()
        .then((value) => {
          const settledAt = now();
          // Expired neighbours are swept here rather than on a timer so the map
          // stays bounded without keeping the process alive.
          pruneExpired(settledAt);
          settledByKey.set(key, { value, expiresAt: settledAt + ttlMs });
          return value;
        })
        .finally(() => {
          if (pendingByKey.get(key) === started) {
            pendingByKey.delete(key);
          }
        });
      pendingByKey.set(key, started);
      return started;
    },
  };
}
