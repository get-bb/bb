import type { DiffFileEntry } from "@bb/server-contract";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { diffCardStateStore, type DiffCardStateStore } from "./diff-card-state";

function useStoreVersion(store: DiffCardStateStore): number {
  return useSyncExternalStore(store.subscribe, store.version, store.version);
}

export interface DiffCardCollapseState {
  collapsed: boolean;
  toggle: () => void;
}

/** One card's collapse flag + toggle, live across the shared store. */
export function useDiffCardCollapsed(
  diffIdentity: string,
  entry: DiffFileEntry,
  fileCount: number,
  store: DiffCardStateStore = diffCardStateStore,
): DiffCardCollapseState {
  useStoreVersion(store);
  const args = useMemo(
    () => ({ entry: { changeKind: entry.changeKind }, fileCount }),
    [entry.changeKind, fileCount],
  );
  const collapsed = store.isCollapsed(diffIdentity, entry.path, args);
  const toggle = useCallback(
    () => store.toggle(diffIdentity, entry.path, args),
    [args, diffIdentity, entry.path, store],
  );
  return { collapsed, toggle };
}

export interface DiffCollapseAllControls {
  /** True when every current TOC file is collapsed. */
  areAllCollapsed: boolean;
  /** Collapse every file when any is expanded; otherwise expand every file. */
  toggleAll: () => void;
}

/** Header collapse-all / expand-all bound to the shared store. */
export function useDiffCollapseAll(
  diffIdentity: string,
  files: readonly DiffFileEntry[],
  store: DiffCardStateStore = diffCardStateStore,
): DiffCollapseAllControls {
  useStoreVersion(store);
  const areAllCollapsed =
    files.length > 0 &&
    files.every((entry) =>
      store.isCollapsed(diffIdentity, entry.path, {
        entry,
        fileCount: files.length,
      }),
    );
  const toggleAll = useCallback(() => {
    store.setAll(
      diffIdentity,
      files.map((entry) => entry.path),
      !areAllCollapsed,
    );
  }, [areAllCollapsed, diffIdentity, files, store]);
  return { areAllCollapsed, toggleAll };
}
