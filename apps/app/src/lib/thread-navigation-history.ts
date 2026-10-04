import { atom } from "jotai";

export const THREAD_NAVIGATION_HISTORY_LIMIT = 50;

export interface ThreadNavigationEntry {
  projectId: string;
  threadId: string;
}

export interface ThreadNavigationHistory {
  entries: readonly ThreadNavigationEntry[];
  index: number;
}

export type ThreadNavigationOffset = -1 | 1;

export const EMPTY_THREAD_NAVIGATION_HISTORY: ThreadNavigationHistory = {
  entries: [],
  index: -1,
};

export const threadNavigationHistoryAtom = atom<ThreadNavigationHistory>(
  EMPTY_THREAD_NAVIGATION_HISTORY,
);

export function recordThreadVisit(
  history: ThreadNavigationHistory,
  entry: ThreadNavigationEntry,
): ThreadNavigationHistory {
  const current = history.entries[history.index];
  if (current?.threadId === entry.threadId) {
    if (current.projectId === entry.projectId) return history;
    const entries = history.entries.map((item, index) =>
      index === history.index ? entry : item,
    );
    return { entries, index: history.index };
  }
  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(
    -THREAD_NAVIGATION_HISTORY_LIMIT,
  );
  return { entries, index: entries.length - 1 };
}

interface ThreadNavigationStepOptions {
  currentThreadId: string | undefined;
  isAvailable: (entry: ThreadNavigationEntry) => boolean;
}

export function stepThreadNavigationHistory(
  history: ThreadNavigationHistory,
  offset: ThreadNavigationOffset,
  { currentThreadId, isAvailable }: ThreadNavigationStepOptions,
): { history: ThreadNavigationHistory; entry: ThreadNavigationEntry } | null {
  const firstIndex =
    currentThreadId === undefined && offset === -1
      ? history.index
      : history.index + offset;
  for (
    let index = firstIndex;
    index >= 0 && index < history.entries.length;
    index += offset
  ) {
    const entry = history.entries[index];
    if (entry === undefined || entry.threadId === currentThreadId) continue;
    if (!isAvailable(entry)) continue;
    return { history: { entries: history.entries, index }, entry };
  }
  return null;
}

export function removeThreadNavigationEntries(
  history: ThreadNavigationHistory,
  shouldRemove: (entry: ThreadNavigationEntry) => boolean,
): ThreadNavigationHistory {
  const kept: ThreadNavigationEntry[] = [];
  let index = -1;
  history.entries.forEach((entry, entryIndex) => {
    if (shouldRemove(entry)) return;
    const previous = kept[kept.length - 1];
    if (previous?.threadId === entry.threadId) {
      if (entryIndex <= history.index) index = kept.length - 1;
      return;
    }
    kept.push(entry);
    if (entryIndex <= history.index) index = kept.length - 1;
  });
  if (kept.length === history.entries.length) return history;
  return { entries: kept, index: kept.length === 0 ? -1 : Math.max(index, 0) };
}
