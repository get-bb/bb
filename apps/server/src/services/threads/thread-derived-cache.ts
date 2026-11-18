export interface ThreadDerivedCacheBuild<T> {
  expiresAt: number | null;
  value: T;
}

export interface ThreadDerivedCacheByteBudget<T> {
  maxBytes: number;
  maxEntryBytes: number;
  measure(value: T): number;
}

export interface ThreadDerivedCacheOptions<T> {
  bytes: ThreadDerivedCacheByteBudget<T> | null;
  maxEntries: number;
}

export interface ThreadDerivedCacheRead<T> {
  build(previous: T | undefined): ThreadDerivedCacheBuild<T>;
  revision: string;
  slot: string;
  threadId: string;
}

export interface ThreadDerivedCache<T> {
  getOrBuild(read: ThreadDerivedCacheRead<T>): T;
  invalidateThread(threadId: string): void;
  readonly size: number;
}

interface Entry<T> {
  bytes: number;
  expiresAt: number | null;
  revision: string;
  threadId: string;
  value: T;
}

export function createThreadDerivedCache<T>(
  options: ThreadDerivedCacheOptions<T>,
): ThreadDerivedCache<T> {
  const budget = options.bytes;
  const maxEntryBytes =
    budget === null
      ? Infinity
      : Math.min(budget.maxEntryBytes, budget.maxBytes);
  const maxBytes = budget?.maxBytes ?? Infinity;
  const entries = new Map<string, Entry<T>>();
  let totalBytes = 0;

  function deleteEntry(slot: string): void {
    const entry = entries.get(slot);
    if (entry === undefined) {
      return;
    }
    entries.delete(slot);
    totalBytes -= entry.bytes;
  }

  function insert(slot: string, entry: Entry<T>): void {
    entries.set(slot, entry);
    totalBytes += entry.bytes;
  }

  return {
    getOrBuild({ build, revision, slot, threadId }) {
      const cached = entries.get(slot);
      if (cached !== undefined) {
        deleteEntry(slot);
        if (
          cached.revision === revision &&
          (cached.expiresAt === null || Date.now() < cached.expiresAt)
        ) {
          insert(slot, cached);
          return cached.value;
        }
      }
      const { expiresAt, value } = build(cached?.value);
      const bytes = budget === null ? 0 : budget.measure(value);
      if (bytes <= maxEntryBytes) {
        insert(slot, { bytes, expiresAt, revision, threadId, value });
        while (entries.size > options.maxEntries || totalBytes > maxBytes) {
          const oldest = entries.keys().next().value;
          if (oldest === undefined) {
            break;
          }
          deleteEntry(oldest);
        }
      }
      return value;
    },
    invalidateThread(threadId) {
      for (const [slot, entry] of entries) {
        if (entry.threadId === threadId) {
          deleteEntry(slot);
        }
      }
    },
    get size() {
      return entries.size;
    },
  };
}
