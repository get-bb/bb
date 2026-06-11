import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import type { DiffFileEntry } from "@bb/server-contract";
import { GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD } from "./gitDiffPanelHelpers";

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
 * Initial collapsed default for a card the store hasn't seen yet, mirroring the
 * pre-virtualization `shouldCollapseGitDiffFileByDefault` policy: many-file
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
const DIFF_CARD_HEADER_HEIGHT_PX = 40;
const DIFF_CARD_LINE_HEIGHT_PX = 18;
const DIFF_CARD_BODY_PADDING_PX = 16;
const DIFF_CARD_MAX_ESTIMATED_LINES = 80;

export function estimateCardHeight(entry: DiffFileEntry): number {
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
