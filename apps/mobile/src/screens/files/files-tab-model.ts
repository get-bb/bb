import type {
  FileSearchSection,
  StorageEntry,
  ThreadRecentFile,
} from "@/data/files";
import { THREAD_RECENT_ITEMS_VISIBLE_LIMIT } from "@/data/files/recent-files";

/**
 * The Files tab's flat row model (one FlatList): search results grouped by
 * source while a query is typed; otherwise the recent files and the thread
 * storage browser. Pure and vitest-tested.
 */
export type FilesTabRow =
  | { kind: "section"; key: string; title: string; note?: string }
  | {
      kind: "search-result";
      key: string;
      source: FileSearchSection["source"];
      path: string;
      positions: number[];
    }
  | { kind: "recent"; key: string; item: ThreadRecentFile }
  | { kind: "recent-toggle"; key: string; expanded: boolean; hidden: number }
  | { kind: "storage-breadcrumbs"; key: string; directoryPath: string }
  | { kind: "storage-entry"; key: string; entry: StorageEntry }
  | { kind: "storage-state"; key: string; state: "loading" | "error" | "empty" }
  | {
      kind: "search-state";
      key: string;
      state: "loading" | "error" | "empty" | "unavailable" | "hint";
    };

interface BuildFilesTabRowsArgs {
  hasQuery: boolean;
  search: {
    sections: readonly FileSearchSection[];
    isLoading: boolean;
    isError: boolean;
    isUnavailable: boolean;
  };
  recent: {
    items: readonly ThreadRecentFile[];
    expanded: boolean;
  };
  /** Null when the surface has no thread (root compose): no storage section. */
  storage: {
    directoryPath: string;
    entries: readonly StorageEntry[];
    loaded: boolean;
    isLoading: boolean;
    isError: boolean;
  } | null;
}

export function buildFilesTabRows({
  hasQuery,
  search,
  recent,
  storage,
}: BuildFilesTabRowsArgs): FilesTabRow[] {
  const rows: FilesTabRow[] = [];
  if (hasQuery) {
    if (search.isUnavailable) {
      rows.push({
        kind: "search-state",
        key: "search:unavailable",
        state: "unavailable",
      });
      return rows;
    }
    for (const section of search.sections) {
      rows.push({
        kind: "section",
        key: `section:${section.source}`,
        title: section.title,
        note: section.truncated ? "Showing the best matches" : undefined,
      });
      for (const result of section.results) {
        rows.push({
          kind: "search-result",
          key: `result:${section.source}:${result.path}`,
          source: section.source,
          path: result.path,
          positions: result.positions,
        });
      }
    }
    if (search.sections.length === 0) {
      rows.push({
        kind: "search-state",
        key: "search:state",
        state: search.isLoading
          ? "loading"
          : search.isError
            ? "error"
            : "empty",
      });
    }
    return rows;
  }

  if (recent.items.length > 0) {
    rows.push({ kind: "section", key: "section:recent", title: "Recent" });
    const visible = recent.expanded
      ? recent.items
      : recent.items.slice(0, THREAD_RECENT_ITEMS_VISIBLE_LIMIT);
    for (const item of visible) {
      rows.push({
        kind: "recent",
        key: `recent:${item.source}:${item.path}`,
        item,
      });
    }
    const hidden = recent.items.length - THREAD_RECENT_ITEMS_VISIBLE_LIMIT;
    if (hidden > 0) {
      rows.push({
        kind: "recent-toggle",
        key: "recent:toggle",
        expanded: recent.expanded,
        hidden,
      });
    }
  }

  if (storage === null) {
    if (rows.length === 0) {
      rows.push({ kind: "search-state", key: "search:hint", state: "hint" });
    }
    return rows;
  }
  rows.push({
    kind: "section",
    key: "section:storage",
    title: "Thread storage",
  });
  rows.push({
    kind: "storage-breadcrumbs",
    key: "storage:crumbs",
    directoryPath: storage.directoryPath,
  });
  if (!storage.loaded) {
    rows.push({
      kind: "storage-state",
      key: "storage:state",
      state: storage.isLoading
        ? "loading"
        : storage.isError
          ? "error"
          : "empty",
    });
    return rows;
  }
  if (storage.entries.length === 0) {
    rows.push({ kind: "storage-state", key: "storage:state", state: "empty" });
    return rows;
  }
  for (const entry of storage.entries) {
    rows.push({
      kind: "storage-entry",
      key: `storage:${entry.kind}:${entry.path}`,
      entry,
    });
  }
  return rows;
}
