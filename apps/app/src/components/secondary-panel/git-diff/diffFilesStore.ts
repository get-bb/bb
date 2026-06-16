import { useCallback, useMemo } from "react";
import { atom, useAtomValue } from "jotai";
import { useAtomCallback } from "jotai/utils";
import { atomFamily } from "jotai-family";
import type { DiffFileEntry } from "@bb/server-contract";
import type { GitDiffStats } from "../../git-diff/git-diff-parsing";
import { GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD } from "./gitDiffPanelHelpers";

/**
 * Toolbar change summary derived from the diff tab's table of contents. The TOC
 * already carries each file's `additions`/`deletions` (the same `--numstat` the
 * daemon's `shortstat` summarizes), so summing them — rather than re-parsing the
 * `shortstat` string — yields the exact insertion/deletion totals plus the file
 * count with no patch text in hand.
 */
export function summarizeDiffFileEntries(
  files: readonly DiffFileEntry[],
): GitDiffStats {
  let insertions = 0;
  let deletions = 0;
  for (const file of files) {
    insertions += file.additions;
    deletions += file.deletions;
  }
  return { filesCount: files.length, insertions, deletions };
}

/**
 * Per-card UI state held outside the virtualized rows so it survives the
 * unmount/remount a windowed list performs as cards scroll out of and back into
 * view. Only state the card itself owns lives here:
 *
 * - The file's **tier** is not stored — it is read from the TOC entry's
 *   `loadMode` (single source of truth).
 * - The file's **patch load state** is not stored — it comes from
 *   `useEnvironmentDiffPatches().getPatchState(path)`.
 */
export interface DiffFileCardUiState {
  collapsed: boolean;
}

/**
 * Initial collapsed default for a card the store hasn't seen yet: many-file
 * diffs (over {@link GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD}) and deleted files
 * open collapsed.
 */
export interface DiffFileCardInitialStateArgs {
  entry: DiffFileEntry;
  fileCount: number;
}

export function resolveDiffFileCardInitialState({
  entry,
  fileCount,
}: DiffFileCardInitialStateArgs): DiffFileCardUiState {
  const collapsed =
    fileCount > GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD ||
    entry.changeKind === "deleted";
  return { collapsed };
}

/**
 * Path-keyed UI state for the diff tab's file cards. `atomFamily` memoizes by
 * path, so repeated reads for the same file return a stable atom reference. The
 * atom seeds itself lazily on first read from the TOC entry + current file
 * count via {@link resolveDiffFileCardInitialState}; until the card is first
 * observed the family holds nothing for that path.
 *
 * Keyed by the same composite identity the patch hook uses (`environmentId` +
 * `target`) plus the file path, so switching diff target or environment yields
 * a fresh, independent state slice rather than leaking a previous diff's
 * collapse choices onto an unrelated file at the same path.
 */
export interface DiffFileCardStateKey {
  diffIdentity: string;
  path: string;
}

function diffFileCardStateKeyEquals(
  a: DiffFileCardStateKey,
  b: DiffFileCardStateKey,
): boolean {
  return a.diffIdentity === b.diffIdentity && a.path === b.path;
}

export const diffFileCardStateAtomFamily = atomFamily(
  (_key: DiffFileCardStateKey) => atom<DiffFileCardUiState | null>(null),
  diffFileCardStateKeyEquals,
);

export type DiffFileCardStateAtom = ReturnType<
  typeof diffFileCardStateAtomFamily
>;

/**
 * Resolve a card's current collapsed flag: the per-card atom value if the user
 * has touched it, otherwise the initial default. The single source of truth for
 * "is this file collapsed", shared by the rendered rows and the toolbar's
 * collapse-all derivation so both agree even for virtualized-away cards.
 */
export function resolveCardCollapsed(
  storedState: DiffFileCardUiState | null,
  entry: DiffFileEntry,
  fileCount: number,
): boolean {
  return (
    storedState?.collapsed ??
    resolveDiffFileCardInitialState({ entry, fileCount }).collapsed
  );
}

export interface DiffFilesCollapseControls {
  /** True when every current TOC file is collapsed (none are expanded). */
  areAllCollapsed: boolean;
  /** Collapse every file when any is expanded; otherwise expand every file. */
  toggleAllCollapsed: () => void;
  /** False when the TOC is empty (collapse-all has nothing to act on). */
  hasFiles: boolean;
}

/**
 * Toolbar-side collapse-all/expand-all bound to the per-card store. The
 * `areAllCollapsed` flag is derived through a read-only atom that subscribes to
 * every current TOC file's per-card atom (falling back to its initial default),
 * so the toolbar icon updates live as individual cards collapse/expand.
 * Toggling writes the new collapsed flag to every current path's atom, which
 * collapses/expands the rendered cards even when most are virtualized out of the
 * DOM — each row reads the same atom on (re)mount.
 */
export function useDiffFilesCollapseControls(
  diffIdentity: string,
  files: readonly DiffFileEntry[],
): DiffFilesCollapseControls {
  const areAllCollapsedAtom = useMemo(
    () =>
      atom((get) => {
        if (files.length === 0) {
          return false;
        }
        return files.every((entry) =>
          resolveCardCollapsed(
            get(diffFileCardStateAtomFamily({ diffIdentity, path: entry.path })),
            entry,
            files.length,
          ),
        );
      }),
    [diffIdentity, files],
  );
  const areAllCollapsed = useAtomValue(areAllCollapsedAtom);

  const setAllCollapsed = useAtomCallback(
    useCallback(
      (get, set, collapsed: boolean) => {
        for (const entry of files) {
          const stateAtom = diffFileCardStateAtomFamily({
            diffIdentity,
            path: entry.path,
          });
          const current = get(stateAtom);
          if (current?.collapsed === collapsed) {
            continue;
          }
          set(stateAtom, { ...(current ?? {}), collapsed });
        }
      },
      [diffIdentity, files],
    ),
  );

  const toggleAllCollapsed = useCallback(() => {
    setAllCollapsed(!areAllCollapsed);
  }, [areAllCollapsed, setAllCollapsed]);

  return {
    areAllCollapsed,
    toggleAllCollapsed,
    hasFiles: files.length > 0,
  };
}

/**
 * Drop every per-card UI atom whose key belongs to a now-stale diff identity.
 * Called when the active diff target/environment changes so a new diff starts
 * from clean collapse defaults instead of inheriting the previous diff's state.
 */
export function clearDiffFileCardStates(activeDiffIdentity: string): void {
  for (const key of diffFileCardStateAtomFamily.getParams()) {
    if (key.diffIdentity !== activeDiffIdentity) {
      diffFileCardStateAtomFamily.remove(key);
    }
  }
}

/**
 * Estimated rendered card height (px) used to seed the virtualizer's
 * `estimateSize` before a card mounts and reports its real height via
 * `measureElement`. Derived from the TOC entry's changed-line count (capped) so
 * the first paint is close enough to keep the scrollbar stable, with a header
 * floor for collapsed / zero-change rows.
 */
export const DIFF_CARD_HEADER_HEIGHT_PX = 40;
const DIFF_CARD_LINE_HEIGHT_PX = 18;
const DIFF_CARD_BODY_PADDING_PX = 16;
const DIFF_CARD_MAX_ESTIMATED_LINES = 80;

/**
 * A card's estimate must respect its resolved initial collapsed state. Large
 * diffs (over {@link GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD}) and deleted files
 * open collapsed — only the header row renders — so estimating the full
 * expanded body for them overshoots the total size by ~50-100x and yanks the
 * scrollbar. A collapsed card estimates to the header-row floor; the
 * virtualizer's `measureElement` still corrects the exact height on mount and
 * when the user toggles the card open.
 */
export interface EstimateCardHeightArgs {
  entry: DiffFileEntry;
  collapsed: boolean;
}

export function estimateCardHeight({
  entry,
  collapsed,
}: EstimateCardHeightArgs): number {
  if (collapsed) {
    return DIFF_CARD_HEADER_HEIGHT_PX;
  }
  const changedLines = entry.additions + entry.deletions;
  if (changedLines === 0) {
    return DIFF_CARD_HEADER_HEIGHT_PX;
  }
  const renderedLines = Math.min(changedLines, DIFF_CARD_MAX_ESTIMATED_LINES);
  return (
    DIFF_CARD_HEADER_HEIGHT_PX +
    DIFF_CARD_BODY_PADDING_PX +
    renderedLines * DIFF_CARD_LINE_HEIGHT_PX
  );
}
