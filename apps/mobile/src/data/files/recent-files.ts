import { z } from "zod";

/**
 * Recently opened files per thread, persisted under the web app's
 * `bb.thread.recentItems-<threadId>-1` key and JSON shape
 * (apps/app/src/components/secondary-panel/threadRecentItems.ts) so a
 * recent list written here reads the same as one written by the web.
 * Storage is injected (MMKV in the app, a Map in tests); the store is the
 * in-process source of truth and notifies subscribers.
 */

const THREAD_RECENT_ITEMS_STORAGE_PREFIX = "bb.thread.recentItems";
const THREAD_RECENT_ITEMS_STORAGE_VERSION = 1;
/** How many recent items we persist per thread before dropping the oldest. */
const THREAD_RECENT_ITEMS_MAX_STORED = 24;
/** How many recent rows the Files tab shows before "Show more". */
export const THREAD_RECENT_ITEMS_VISIBLE_LIMIT = 6;

export type RecentFileSource = "workspace" | "thread-storage";

export interface ThreadRecentFile {
  source: RecentFileSource;
  path: string;
  openedAt: number;
}

const recentItemSchema = z
  .object({
    source: z.enum(["workspace", "thread-storage"]),
    path: z.string().min(1),
    openedAt: z.number().int().nonnegative(),
  })
  .strict();
const recentItemsSchema = z.array(recentItemSchema);

const EMPTY: readonly ThreadRecentFile[] = Object.freeze([]);

export interface RecentFilesStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function threadRecentFilesStorageKey(threadId: string): string {
  return `${THREAD_RECENT_ITEMS_STORAGE_PREFIX}-${encodeURIComponent(threadId)}-${THREAD_RECENT_ITEMS_STORAGE_VERSION}`;
}

/**
 * Prepends an opened file: dedupes by source+path so reopening moves it to
 * the front with a fresh timestamp, then caps the list.
 */
export function recordRecentFile(
  items: readonly ThreadRecentFile[],
  item: ThreadRecentFile,
  limit = THREAD_RECENT_ITEMS_MAX_STORED,
): ThreadRecentFile[] {
  const withoutExisting = items.filter(
    (existing) =>
      existing.source !== item.source || existing.path !== item.path,
  );
  return [item, ...withoutExisting].slice(0, limit);
}

export function parseRecentFiles(raw: string | undefined): ThreadRecentFile[] {
  if (raw === undefined) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const result = recentItemsSchema.safeParse(parsed);
  return result.success
    ? result.data.slice(0, THREAD_RECENT_ITEMS_MAX_STORED)
    : [];
}

export interface RecentFilesStore {
  read(threadId: string): readonly ThreadRecentFile[];
  record(threadId: string, item: Omit<ThreadRecentFile, "openedAt">): void;
  clear(threadId: string): void;
  subscribe(threadId: string, listener: () => void): () => void;
}

export function createRecentFilesStore(
  storage: RecentFilesStorage,
  options: { now?: () => number } = {},
): RecentFilesStore {
  const now = options.now ?? (() => Date.now());
  const cache = new Map<string, readonly ThreadRecentFile[]>();
  const listeners = new Map<string, Set<() => void>>();

  function notify(threadId: string): void {
    for (const listener of listeners.get(threadId) ?? []) listener();
  }

  function read(threadId: string): readonly ThreadRecentFile[] {
    const cached = cache.get(threadId);
    if (cached) return cached;
    const items = parseRecentFiles(
      storage.getString(threadRecentFilesStorageKey(threadId)),
    );
    const frozen = items.length === 0 ? EMPTY : items;
    cache.set(threadId, frozen);
    return frozen;
  }

  return {
    read,
    record(threadId, item) {
      const next = recordRecentFile(read(threadId), {
        ...item,
        openedAt: now(),
      });
      cache.set(threadId, next);
      storage.set(threadRecentFilesStorageKey(threadId), JSON.stringify(next));
      notify(threadId);
    },
    clear(threadId) {
      cache.set(threadId, EMPTY);
      storage.remove(threadRecentFilesStorageKey(threadId));
      notify(threadId);
    },
    subscribe(threadId, listener) {
      let set = listeners.get(threadId);
      if (!set) {
        set = new Set();
        listeners.set(threadId, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(threadId);
      };
    },
  };
}
