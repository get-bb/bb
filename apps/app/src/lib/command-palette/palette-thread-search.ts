import {
  PERSONAL_PROJECT_ID,
  type ThreadListEntry,
} from "@bb/domain";
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
  projectHighlightRanges: readonly ThreadSearchMatch["highlightRanges"][number][];
  relativeTime: string;
  projectId: string;
  threadId: string;
  thread: ThreadListEntry;
  messageSeq: number | null;
}

interface BuildPaletteThreadSearchRowsArgs {
  lifecycles: readonly ThreadArchiveFilter[];
  now: number;
  projectNamesById: ReadonlyMap<string, string>;
  query: string;
  recentThreads: readonly ThreadListEntry[];
  searchResponse: ThreadSearchResponse | undefined;
  searchResultsAreCurrent: boolean;
}

export interface PaletteThreadSearchRowsResult {
  isRecent: boolean;
  rows: PaletteThreadSearchRow[];
}

type HighlightRange = PaletteThreadSearchRow["highlightRanges"][number];

const RECENT_THREAD_LIMIT = 20;
const LOCAL_ROWS_BEFORE_SERVER_ROWS = 3;

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
    projectHighlightRanges: [],
    relativeTime: formatRelativeTime({ timestamp: thread.updatedAt, now }),
    projectId: thread.projectId,
    threadId: thread.id,
    thread,
    messageSeq: snippetMatch?.sourceSeq ?? null,
  };
}

function positionsToRanges(positions: readonly number[]): HighlightRange[] {
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

function projectNameMatch(name: string, query: string): HighlightRange | null {
  const needle = query.toLowerCase();
  const haystack = name.toLowerCase();
  if (haystack.startsWith(needle)) return { start: 0, end: needle.length };
  for (const word of haystack.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (word[0].startsWith(needle)) {
      return { start: word.index, end: word.index + needle.length };
    }
  }
  return null;
}

function localMatchRows(
  threads: readonly ThreadListEntry[],
  query: string,
  projectNamesById: ReadonlyMap<string, string>,
  now: number,
): PaletteThreadSearchRow[] {
  const titleRows = fuzzyMatchText({
    items: threads,
    query,
    getText: getThreadDisplayTitle,
    limit: threads.length,
  })
    .sort(
      (left, right) =>
        right.score - left.score || right.item.updatedAt - left.item.updatedAt,
    )
    .map((match) => ({
      ...serverRow(match.item, [], "active", projectNamesById, now),
      highlightRanges: positionsToRanges(match.positions),
    }));
  const titleMatchIds = new Set(titleRows.map((row) => row.threadId));
  const projectRows = threads
    .filter((thread) => !titleMatchIds.has(thread.id))
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .flatMap((thread) => {
      const match = projectNameMatch(
        projectNamesById.get(thread.projectId) ?? "",
        query,
      );
      if (match === null) return [];
      const row = serverRow(thread, [], "active", projectNamesById, now);
      return [
        {
          ...row,
          projectHighlightRanges: row.projectName === null ? [] : [match],
        },
      ];
    });
  return [...titleRows, ...projectRows].slice(0, PALETTE_RESULT_LIMIT);
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
  lifecycles,
  now,
  projectNamesById,
  query,
  recentThreads,
  searchResponse,
  searchResultsAreCurrent,
}: BuildPaletteThreadSearchRowsArgs): PaletteThreadSearchRowsResult {
  const trimmedQuery = query.trim();
  const isRecent = trimmedQuery.length === 0;
  const isSearchable = trimmedQuery.length >= 2;
  const threadsFor = (lifecycle: ThreadArchiveFilter) =>
    recentThreads.filter((thread) =>
      lifecycle === "archived"
        ? thread.archivedAt !== null
        : thread.archivedAt === null,
    );
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
    if (isRecent) {
      return threadsFor(lifecycle)
        .sort((left, right) =>
          lifecycle === "archived"
            ? (right.archivedAt ?? 0) - (left.archivedAt ?? 0)
            : right.updatedAt - left.updatedAt,
        )
        .slice(0, RECENT_THREAD_LIMIT)
        .map((thread) =>
          serverRow(thread, [], lifecycle, projectNamesById, now),
        );
    }
    if (lifecycle === "archived") return serverRowsFor(lifecycle);
    return mergeActiveRows(
      localMatchRows(
        threadsFor(lifecycle),
        trimmedQuery,
        projectNamesById,
        now,
      ),
      serverRowsFor(lifecycle),
    );
  };
  return {
    isRecent,
    rows: normalizeThreadLifecycleFilter(lifecycles).flatMap(rowsFor),
  };
}
