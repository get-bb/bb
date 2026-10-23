import { useCallback, useSyncExternalStore } from "react";
import type { GitDiffStats } from "@bb/shared-ui/git-diff/parsing";
import type { DiffFileEntry } from "../../contract.js";
import {
  GIT_DIFF_AUTO_COLLAPSE_FILE_THRESHOLD,
} from "./gitDiffPanelHelpers.js";

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

export interface DiffFileCardUiState {
  collapsed: boolean;
  viewedRevision: string | null;
}

interface DiffFileCardInitialStateArgs {
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
  return { collapsed, viewedRevision: null };
}

const cardStatesByIdentity = new Map<string, Map<string, DiffFileCardUiState>>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function readDiffFileCardState(
  diffIdentity: string,
  path: string,
): DiffFileCardUiState | null {
  return cardStatesByIdentity.get(diffIdentity)?.get(path) ?? null;
}

function storeDiffFileCardState(
  diffIdentity: string,
  path: string,
  state: DiffFileCardUiState,
): void {
  let states = cardStatesByIdentity.get(diffIdentity);
  if (states === undefined) {
    states = new Map();
    cardStatesByIdentity.set(diffIdentity, states);
  }
  states.set(path, state);
}

export function writeDiffFileCardStates(
  diffIdentity: string,
  updates: readonly (readonly [path: string, state: DiffFileCardUiState])[],
): void {
  if (updates.length === 0) return;
  for (const [path, state] of updates) {
    storeDiffFileCardState(diffIdentity, path, state);
  }
  notify();
}

export function useDiffFileCardState(
  diffIdentity: string,
  path: string,
): DiffFileCardUiState | null {
  return useSyncExternalStore(subscribe, () =>
    readDiffFileCardState(diffIdentity, path),
  );
}

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

interface DiffFilesCollapseControls {
  areAllCollapsed: boolean;
  toggleAllCollapsed: () => void;
  hasFiles: boolean;
}

export function useDiffFilesCollapseControls(
  diffIdentity: string,
  files: readonly DiffFileEntry[],
  fileCount: number,
): DiffFilesCollapseControls {
  const areAllCollapsed = useSyncExternalStore(
    subscribe,
    () =>
      files.length > 0 &&
      files.every((entry) =>
        resolveCardCollapsed(
          readDiffFileCardState(diffIdentity, entry.path),
          entry,
          fileCount,
        ),
      ),
  );

  const toggleAllCollapsed = useCallback(() => {
    const collapsed = !areAllCollapsed;
    const updates: [string, DiffFileCardUiState][] = [];
    for (const entry of files) {
      const current = readDiffFileCardState(diffIdentity, entry.path);
      if (current?.collapsed === collapsed) continue;
      updates.push([
        entry.path,
        {
          ...(current ?? resolveDiffFileCardInitialState({ entry, fileCount })),
          collapsed,
        },
      ]);
    }
    writeDiffFileCardStates(diffIdentity, updates);
  }, [areAllCollapsed, diffIdentity, fileCount, files]);

  return {
    areAllCollapsed,
    toggleAllCollapsed,
    hasFiles: files.length > 0,
  };
}

export function clearDiffFileCardStates(activeDiffIdentity: string): void {
  for (const diffIdentity of [...cardStatesByIdentity.keys()]) {
    if (diffIdentity !== activeDiffIdentity) {
      cardStatesByIdentity.delete(diffIdentity);
    }
  }
}

export const DIFF_CARD_HEADER_HEIGHT_PX = 40;
const DIFF_CARD_LINE_HEIGHT_PX = 18;
const DIFF_CARD_BODY_PADDING_PX = 16;
const DIFF_CARD_MAX_ESTIMATED_LINES = 80;

interface EstimateCardHeightArgs {
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
