import type { DiffFileEntry } from "@bb/server-contract";

/**
 * Per-card collapse state for the diff tab (mirror of
 * apps/app/src/components/secondary-panel/git-diff/diffFilesStore.ts), held
 * outside the list rows so it survives FlashList recycling and a close /
 * reopen of the panel. Keyed by the diff identity (environment + target +
 * merge-base sha) and the path so a target switch starts from fresh defaults
 * instead of inheriting a previous diff's choices at a shared path. Only the
 * collapse flag lives here: the tier comes from the TOC entry and the patch
 * state from `useEnvironmentDiffPatches`.
 */

/** Many-file diffs open collapsed by default. */
const DIFF_AUTO_COLLAPSE_FILE_THRESHOLD = 10;

export interface DiffCardInitialStateArgs {
  entry: Pick<DiffFileEntry, "changeKind">;
  fileCount: number;
}

/** Deleted files and every file of a many-file diff start collapsed. */
export function resolveDiffCardInitialCollapsed({
  entry,
  fileCount,
}: DiffCardInitialStateArgs): boolean {
  return (
    fileCount > DIFF_AUTO_COLLAPSE_FILE_THRESHOLD ||
    entry.changeKind === "deleted"
  );
}

type Listener = () => void;

export interface DiffCardStateStore {
  /** The stored flag, or the initial default when the card was never toggled. */
  isCollapsed(
    diffIdentity: string,
    path: string,
    args: DiffCardInitialStateArgs,
  ): boolean;
  toggle(
    diffIdentity: string,
    path: string,
    args: DiffCardInitialStateArgs,
  ): void;
  setAll(
    diffIdentity: string,
    paths: readonly string[],
    collapsed: boolean,
  ): void;
  /** Drop every slice except the active one (a target / environment switch). */
  retainOnly(diffIdentity: string): void;
  subscribe(listener: Listener): () => void;
  /** Monotonic version for `useSyncExternalStore` snapshots. */
  version(): number;
}

export function createDiffCardStateStore(): DiffCardStateStore {
  const slices = new Map<string, Map<string, boolean>>();
  const listeners = new Set<Listener>();
  let version = 0;
  const notify = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
  const slice = (diffIdentity: string) => {
    let current = slices.get(diffIdentity);
    if (current === undefined) {
      current = new Map();
      slices.set(diffIdentity, current);
    }
    return current;
  };
  return {
    isCollapsed(diffIdentity, path, args) {
      return (
        slices.get(diffIdentity)?.get(path) ??
        resolveDiffCardInitialCollapsed(args)
      );
    },
    toggle(diffIdentity, path, args) {
      const current = slice(diffIdentity);
      current.set(
        path,
        !(current.get(path) ?? resolveDiffCardInitialCollapsed(args)),
      );
      notify();
    },
    setAll(diffIdentity, paths, collapsed) {
      const current = slice(diffIdentity);
      let changed = false;
      for (const path of paths) {
        if (current.get(path) !== collapsed) {
          current.set(path, collapsed);
          changed = true;
        }
      }
      if (changed) notify();
    },
    retainOnly(diffIdentity) {
      let changed = false;
      for (const key of Array.from(slices.keys())) {
        if (key !== diffIdentity) {
          slices.delete(key);
          changed = true;
        }
      }
      if (changed) notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => version,
  };
}

/** The app-wide store (one per JS runtime; diff identities are globally unique). */
export const diffCardStateStore = createDiffCardStateStore();
