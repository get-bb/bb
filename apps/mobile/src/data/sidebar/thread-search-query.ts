import type { ThreadListEntry } from "@bb/domain";
import {
  compareStandardThreads,
  isSidebarProjectThread,
} from "@bb/client-core";

export const THREAD_SEARCH_DEBOUNCE_MS = 150;
export const THREAD_SEARCH_LIMIT_PER_GROUP = 20;
export const THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS = 2;

function countNonWhitespaceChars(value: string): number {
  return value.replace(/\s/g, "").length;
}

/** The server requires two non-whitespace characters (`query.trim().min(2)`). */
export function hasThreadSearchableQuery(value: string): boolean {
  return (
    countNonWhitespaceChars(value) >= THREAD_SEARCH_MIN_NON_WHITESPACE_CHARS
  );
}

/**
 * The most recently active visible threads for the home/search screens:
 * running threads first (by creation), then attention recency — the same
 * order the sidebar uses for its rows.
 */
export function selectRecentThreads(
  threads: readonly ThreadListEntry[],
  limit: number,
): ThreadListEntry[] {
  return threads
    .filter(isSidebarProjectThread)
    .sort(compareStandardThreads)
    .slice(0, Math.max(0, limit));
}
