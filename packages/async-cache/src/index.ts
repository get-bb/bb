export interface AsyncTtlMemo<TKey, TValue> {
  clear(): void;
  invalidateWhere(predicate: (key: TKey) => boolean): void;
  run(
    key: TKey,
    task: () => Promise<TValue>,
    refresh?: boolean,
  ): Promise<TValue>;
}

interface CreateAsyncTtlMemoOptions<TValue> {
  ttlMs: number | ((value: TValue) => number);
  now?: () => number;
  maxEntries?: number;
  staleWhileRevalidate?: boolean;
}

interface MemoEntry<TValue> {
  expiresAt: number;
  value: TValue;
}

export function createAsyncTtlMemo<TKey, TValue>({
  ttlMs,
  now = () => Date.now(),
  maxEntries = Number.POSITIVE_INFINITY,
  staleWhileRevalidate = false,
}: CreateAsyncTtlMemoOptions<TValue>): AsyncTtlMemo<TKey, TValue> {
  const settledByKey = new Map<TKey, MemoEntry<TValue>>();
  const pendingByKey = new Map<TKey, Promise<TValue>>();
  const entryLimit = Math.max(1, maxEntries);

  function pruneExpired(currentTime: number): void {
    for (const [key, entry] of settledByKey) {
      if (entry.expiresAt <= currentTime) {
        settledByKey.delete(key);
      }
    }
  }

  function start(key: TKey, task: () => Promise<TValue>): Promise<TValue> {
    const started = new Promise<TValue>((resolve) => resolve(task()))
      .then((value) => {
        if (pendingByKey.get(key) !== started) return value;
        const ttl = typeof ttlMs === "function" ? ttlMs(value) : ttlMs;
        if (ttl <= 0) {
          settledByKey.delete(key);
          return value;
        }
        const settledAt = now();
        if (!staleWhileRevalidate) pruneExpired(settledAt);
        settledByKey.delete(key);
        while (settledByKey.size >= entryLimit) {
          const oldest = settledByKey.keys().next();
          if (oldest.done) break;
          settledByKey.delete(oldest.value);
        }
        settledByKey.set(key, { value, expiresAt: settledAt + ttl });
        return value;
      })
      .finally(() => {
        if (pendingByKey.get(key) === started) {
          pendingByKey.delete(key);
        }
      });
    pendingByKey.set(key, started);
    return started;
  }

  return {
    clear() {
      settledByKey.clear();
      pendingByKey.clear();
    },
    invalidateWhere(predicate) {
      for (const key of settledByKey.keys()) {
        if (predicate(key)) settledByKey.delete(key);
      }
      for (const key of pendingByKey.keys()) {
        if (predicate(key)) pendingByKey.delete(key);
      }
    },
    run(key, task, refresh = false) {
      const settled = settledByKey.get(key);
      if (!refresh && settled !== undefined) {
        if (settled.expiresAt > now()) return Promise.resolve(settled.value);
        if (staleWhileRevalidate) {
          if (!pendingByKey.has(key)) start(key, task).catch(() => undefined);
          return Promise.resolve(settled.value);
        }
      }
      const pending = pendingByKey.get(key);
      if (pending !== undefined) return pending;
      settledByKey.delete(key);
      return start(key, task);
    },
  };
}
