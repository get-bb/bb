import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import {
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
  type ThreadListIndicatorKind,
} from "@bb/client-core";
import { fuzzyMatchText } from "@bb/fuzzy-match";
import type {
  ThreadSearchMatch,
  ThreadSearchResponse,
} from "@bb/server-contract";
import { formatRelativeTime } from "@/lib/relative-time";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  normalizeThreadLifecycleFilter,
  type ThreadArchiveFilter,
} from "@/lib/thread-lifecycle-filter";
import { PALETTE_RESULT_LIMIT } from "./palette-ranking";

export interface PaletteThreadSearchRow {
  id: string;
  lifecycle: ThreadArchiveFilter;
  primaryText: string;
  highlightRanges: readonly ThreadSearchMatch["highlightRanges"][number][];
  secondaryTitle: string | null;
  projectName: string | null;
  relativeTime: string;
  projectId: string;
  threadId: string;
  thread: ThreadListEntry;
  messageSeq: number | null;
}

interface BuildPaletteThreadSearchRowsArgs {
  currentThreadId: string | null;
  lifecycles: readonly ThreadArchiveFilter[];
  now: number;
  projectNamesById: ReadonlyMap<string, string>;
  query: string;
  recentThreads: readonly ThreadListEntry[];
  searchResponse: ThreadSearchResponse | undefined;
  searchResultsAreCurrent: boolean;
  visitedThreadIds: readonly string[];
}

export interface PaletteThreadSearchRowsResult {
  isRecent: boolean;
  previousThreadId: string | null;
  rows: PaletteThreadSearchRow[];
}

export type HighlightRange = PaletteThreadSearchRow["highlightRanges"][number];

const RECENT_THREAD_LIMIT = 20;
const NEEDS_YOU_LIMIT = 3;
const LOCAL_ROWS_BEFORE_SERVER_ROWS = 3;
const UNVISITED_RANK = Number.MAX_SAFE_INTEGER;
const NEEDS_YOU_INDICATORS: ReadonlySet<ThreadListIndicatorKind> =
  new Set<ThreadListIndicatorKind>([
    "waiting-for-input",
    "unread-error",
    "unread-success",
  ]);

function isTitleMatch(match: ThreadSearchMatch): boolean {
  return match.sourceKind === "title" || match.sourceKind === "title_fallback";
}

function projectMetadata(
  projectId: string,
  projectNamesById: ReadonlyMap<string, string>,
): string | null {
  return projectId === PERSONAL_PROJECT_ID
    ? null
    : (projectNamesById.get(projectId) ?? null);
}

function serverRow(
  thread: ThreadListEntry,
  matches: readonly ThreadSearchMatch[],
  lifecycle: ThreadArchiveFilter,
  projectNamesById: ReadonlyMap<string, string>,
  now: number,
): PaletteThreadSearchRow {
  const title = getThreadDisplayTitle(thread);
  const titleMatch = matches.find(
    (match) => isTitleMatch(match) && match.text === title,
  );
  const snippetMatch = matches.find((match) => !isTitleMatch(match));
  const primaryMatch = snippetMatch ?? titleMatch;
  return {
    id: `${lifecycle}:${thread.id}`,
    lifecycle,
    primaryText: primaryMatch?.text ?? title,
    highlightRanges: primaryMatch?.highlightRanges ?? [],
    secondaryTitle: snippetMatch === undefined ? null : title,
    projectName: projectMetadata(thread.projectId, projectNamesById),
    relativeTime: formatRelativeTime({ timestamp: thread.updatedAt, now }),
    projectId: thread.projectId,
    threadId: thread.id,
    thread,
    messageSeq: snippetMatch?.sourceSeq ?? null,
  };
}

export function positionsToRanges(
  positions: readonly number[],
): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  for (const position of [...new Set(positions)].sort((a, b) => a - b)) {
    const last = ranges.at(-1);
    if (last !== undefined && last.end === position) {
      last.end = position + 1;
    } else {
      ranges.push({ start: position, end: position + 1 });
    }
  }
  return ranges;
}

function isNeedsYouThread(thread: ThreadListEntry): boolean {
  return NEEDS_YOU_INDICATORS.has(
    resolveThreadListIndicator(
      threadListIndicatorStateForThread(thread, false),
    ),
  );
}

function orderActiveRecents(
  threads: readonly ThreadListEntry[],
  visitRankOf: (thread: ThreadListEntry) => number,
  previousThreadId: string | null,
  currentThreadId: string | null,
): ThreadListEntry[] {
  const isAnchor = (thread: ThreadListEntry) =>
    thread.id === previousThreadId || thread.id === currentThreadId;
  const needsYou = threads
    .filter((thread) => !isAnchor(thread) && isNeedsYouThread(thread))
    .sort((left, right) => right.latestAttentionAt - left.latestAttentionAt)
    .slice(0, NEEDS_YOU_LIMIT);
  const needsYouIds = new Set(needsYou.map((thread) => thread.id));
  const previous = threads.find((thread) => thread.id === previousThreadId);
  const current = threads.find((thread) => thread.id === currentThreadId);
  const rest = threads
    .filter((thread) => !isAnchor(thread) && !needsYouIds.has(thread.id))
    .sort(
      (left, right) =>
        visitRankOf(left) - visitRankOf(right) ||
        right.updatedAt - left.updatedAt,
    );
  if (previous !== undefined) {
    return [
      ...needsYou,
      previous,
      ...(current === undefined ? [] : [current]),
      ...rest,
    ];
  }
  return [
    ...needsYou,
    ...rest.slice(0, 1),
    ...(current === undefined ? [] : [current]),
    ...rest.slice(1),
  ];
}

function orderArchivedRecents(
  threads: readonly ThreadListEntry[],
  visitRankOf: (thread: ThreadListEntry) => number,
  currentThreadId: string | null,
): ThreadListEntry[] {
  const ordered = threads
    .filter((thread) => thread.id !== currentThreadId)
    .sort(
      (left, right) =>
        visitRankOf(left) - visitRankOf(right) ||
        (right.archivedAt ?? 0) - (left.archivedAt ?? 0),
    );
  const current = threads.find((thread) => thread.id === currentThreadId);
  if (current !== undefined) ordered.splice(1, 0, current);
  return ordered;
}

function localTitleRows(
  threads: readonly ThreadListEntry[],
  query: string,
  visitRankOf: (thread: ThreadListEntry) => number,
  projectNamesById: ReadonlyMap<string, string>,
  now: number,
): PaletteThreadSearchRow[] {
  return fuzzyMatchText({
    items: threads,
    query,
    getText: getThreadDisplayTitle,
    limit: threads.length,
  })
    .sort(
      (left, right) =>
        right.score - left.score ||
        visitRankOf(left.item) - visitRankOf(right.item) ||
        right.item.updatedAt - left.item.updatedAt,
    )
    .slice(0, PALETTE_RESULT_LIMIT)
    .map((match) => ({
      ...serverRow(match.item, [], "active", projectNamesById, now),
      highlightRanges: positionsToRanges(match.positions),
    }));
}

function mergeActiveRows(
  localRows: readonly PaletteThreadSearchRow[],
  serverRows: readonly PaletteThreadSearchRow[],
): PaletteThreadSearchRow[] {
  const serverRowsById = new Map(serverRows.map((row) => [row.id, row]));
  const localIds = new Set(localRows.map((row) => row.id));
  const merged = localRows.map((row) => {
    const server = serverRowsById.get(row.id);
    if (server === undefined) return row;
    return server.secondaryTitle === null
      ? { ...row, messageSeq: server.messageSeq }
      : {
          ...row,
          primaryText: server.primaryText,
          highlightRanges: server.highlightRanges,
          secondaryTitle: server.secondaryTitle,
          messageSeq: server.messageSeq,
        };
  });
  return [
    ...merged.slice(0, LOCAL_ROWS_BEFORE_SERVER_ROWS),
    ...serverRows.filter((row) => !localIds.has(row.id)),
    ...merged.slice(LOCAL_ROWS_BEFORE_SERVER_ROWS),
  ];
}

export function buildPaletteThreadSearchRows({
  currentThreadId,
  lifecycles,
  now,
  projectNamesById,
  query,
  recentThreads,
  searchResponse,
  searchResultsAreCurrent,
  visitedThreadIds,
}: BuildPaletteThreadSearchRowsArgs): PaletteThreadSearchRowsResult {
  const trimmedQuery = query.trim();
  const isRecent = trimmedQuery.length === 0;
  const isSearchable = trimmedQuery.length >= 2;
  const selectedLifecycles = normalizeThreadLifecycleFilter(lifecycles);
  const threadsByLifecycle = (lifecycle: ThreadArchiveFilter) =>
    selectedLifecycles.includes(lifecycle)
      ? recentThreads.filter((thread) =>
          lifecycle === "archived"
            ? thread.archivedAt !== null
            : thread.archivedAt === null,
        )
      : [];
  const visitRanks = new Map(
    visitedThreadIds.map((threadId, index) => [threadId, index]),
  );
  const visitRankOf = (thread: ThreadListEntry) =>
    visitRanks.get(thread.id) ?? UNVISITED_RANK;
  const listedThreadIds = new Set(
    selectedLifecycles.flatMap((lifecycle) =>
      threadsByLifecycle(lifecycle).map((thread) => thread.id),
    ),
  );
  const previousThreadId =
    visitedThreadIds.find(
      (threadId) =>
        threadId !== currentThreadId && listedThreadIds.has(threadId),
    ) ?? null;
  const serverRowsFor = (lifecycle: ThreadArchiveFilter) =>
    isSearchable && searchResultsAreCurrent
      ? (searchResponse?.[lifecycle]?.results ?? []).map((result) =>
          serverRow(
            result.thread,
            result.matches,
            lifecycle,
            projectNamesById,
            now,
          ),
        )
      : [];
  const rowsFor = (lifecycle: ThreadArchiveFilter) => {
    const threads = threadsByLifecycle(lifecycle);
    if (isRecent) {
      return (
        lifecycle === "archived"
          ? orderArchivedRecents(threads, visitRankOf, currentThreadId)
          : orderActiveRecents(
              threads,
              visitRankOf,
              previousThreadId,
              currentThreadId,
            )
      )
        .slice(0, RECENT_THREAD_LIMIT)
        .map((thread) =>
          serverRow(thread, [], lifecycle, projectNamesById, now),
        );
    }
    if (lifecycle === "archived") return serverRowsFor(lifecycle);
    return mergeActiveRows(
      localTitleRows(threads, trimmedQuery, visitRankOf, projectNamesById, now),
      serverRowsFor(lifecycle),
    );
  };
  return {
    isRecent,
    previousThreadId: isRecent ? previousThreadId : null,
    rows: selectedLifecycles.flatMap(rowsFor),
  };
}
