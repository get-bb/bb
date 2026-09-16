import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import { createJsonSessionStorage } from "./browser-storage";

export const THREAD_NAVIGATION_HISTORY_LIMIT = 50;
const THREAD_NAVIGATION_HISTORY_STORAGE_KEY = "bb.thread.navigationHistory";

const threadNavigationEntrySchema = z
  .object({
    projectId: z.string().min(1),
    threadId: z.string().min(1),
  })
  .strict();

export type ThreadNavigationEntry = z.infer<typeof threadNavigationEntrySchema>;

export interface ThreadNavigationHistory {
  entries: readonly ThreadNavigationEntry[];
  index: number;
}

const threadNavigationHistorySchema = z
  .object({
    entries: z
      .array(threadNavigationEntrySchema)
      .max(THREAD_NAVIGATION_HISTORY_LIMIT),
    index: z.number().int(),
  })
  .strict()
  .refine(
    (history) => history.index >= -1 && history.index < history.entries.length,
  );

export const EMPTY_THREAD_NAVIGATION_HISTORY: ThreadNavigationHistory = {
  entries: [],
  index: -1,
};

export function isThreadNavigationHistory(
  value: unknown,
): value is ThreadNavigationHistory {
  return threadNavigationHistorySchema.safeParse(value).success;
}

export const threadNavigationHistoryAtom =
  atomWithStorage<ThreadNavigationHistory>(
    THREAD_NAVIGATION_HISTORY_STORAGE_KEY,
    EMPTY_THREAD_NAVIGATION_HISTORY,
    createJsonSessionStorage<ThreadNavigationHistory>(
      isThreadNavigationHistory,
    ),
    { getOnInit: true },
  );

export function getCurrentThreadNavigationEntry(
  history: ThreadNavigationHistory,
): ThreadNavigationEntry | null {
  return history.entries[history.index] ?? null;
}

export function recordThreadVisit(
  history: ThreadNavigationHistory,
  entry: ThreadNavigationEntry,
): ThreadNavigationHistory {
  const current = getCurrentThreadNavigationEntry(history);
  if (current?.threadId === entry.threadId) {
    return history;
  }
  const entries = [...history.entries.slice(0, history.index + 1), entry].slice(
    -THREAD_NAVIGATION_HISTORY_LIMIT,
  );
  return { entries, index: entries.length - 1 };
}

export function stepThreadNavigationHistory(
  history: ThreadNavigationHistory,
  offset: -1 | 1,
): { history: ThreadNavigationHistory; entry: ThreadNavigationEntry } | null {
  const index = history.index + offset;
  const entry = history.entries[index];
  if (!entry) {
    return null;
  }
  return { history: { entries: history.entries, index }, entry };
}
