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

const cardStatesByIdentity = new Map<
  string,
  ReadonlyMap<string, DiffFileCardUiState>
>();
const EMPTY_CARD_STATES: ReadonlyMap<string, DiffFileCardUiState> = new Map();
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

export function writeDiffFileCardStates(
  diffIdentity: string,
  updates: readonly (readonly [path: string, state: DiffFileCardUiState])[],
): void {
  if (updates.length === 0) return;
  const states = new Map(cardStatesByIdentity.get(diffIdentity));
  for (const [path, state] of updates) {
    states.set(path, state);
  }
  cardStatesByIdentity.set(diffIdentity, states);
  notify();
}

export function useDiffFileCardStates(
  diffIdentity: string,
): ReadonlyMap<string, DiffFileCardUiState> {
  return useSyncExternalStore(
    subscribe,
    () => cardStatesByIdentity.get(diffIdentity) ?? EMPTY_CARD_STATES,
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

export const DIFF_CARD_HEADER_HEIGHT_PX = 33;
const DIFF_CARD_LINE_HEIGHT_PX = 18;
const DIFF_CARD_BODY_PADDING_PX = 17;
const DIFF_CARD_NOTICE_HEIGHT_PX = 41;

export function estimateCardBodyHeight(entry: DiffFileEntry): number {
  if (entry.loadMode !== "auto") {
    return DIFF_CARD_NOTICE_HEIGHT_PX;
  }
  const changedLines = entry.additions + entry.deletions;
  if (changedLines === 0) {
    return 0;
  }
  return DIFF_CARD_BODY_PADDING_PX + changedLines * DIFF_CARD_LINE_HEIGHT_PX;
}

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
  return DIFF_CARD_HEADER_HEIGHT_PX + estimateCardBodyHeight(entry);
}
