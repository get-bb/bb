import { useCallback, useSyncExternalStore } from "react";
import {
  createRecentFilesStore,
  type RecentFileSource,
  type RecentFilesStore,
  type ThreadRecentFile,
} from "./recent-files";
import { createRecentFilesStorage } from "./recent-files-storage";

let defaultStore: RecentFilesStore | null = null;

/** App-wide recent-files store (client-local, not per server profile). */
function getRecentFilesStore(): RecentFilesStore {
  defaultStore ??= createRecentFilesStore(createRecentFilesStorage());
  return defaultStore;
}

export interface ThreadRecentFiles {
  items: readonly ThreadRecentFile[];
  record: (source: RecentFileSource, path: string) => void;
}

const NO_ITEMS: readonly ThreadRecentFile[] = Object.freeze([]);

/**
 * The thread's recently opened files, newest first, live across screens.
 * A null thread (the root-compose panel) has no recents and records nothing.
 */
export function useThreadRecentFiles(
  threadId: string | null,
): ThreadRecentFiles {
  const store = getRecentFilesStore();
  const items = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        threadId === null
          ? () => undefined
          : store.subscribe(threadId, listener),
      [store, threadId],
    ),
    () => (threadId === null ? NO_ITEMS : store.read(threadId)),
  );
  const record = useCallback(
    (source: RecentFileSource, path: string) => {
      if (threadId !== null) store.record(threadId, { source, path });
    },
    [store, threadId],
  );
  return { items, record };
}
