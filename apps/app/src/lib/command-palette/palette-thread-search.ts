import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import {
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
  type ThreadListIndicatorKind,
} from "@bb/client-core";
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

const RECENT_THREAD_LIMIT = 20;
const NEEDS_YOU_LIMIT = 3;
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
      previous,
      ...needsYou,
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
    return serverRowsFor(lifecycle);
  };
  return {
    isRecent,
    previousThreadId: isRecent ? previousThreadId : null,
    rows: selectedLifecycles.flatMap(rowsFor),
  };
}
