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
import type {
  PaletteThreadSort,
  PaletteThreadSortDirection,
} from "./palette-preferences";
import { PALETTE_RESULT_LIMIT } from "./palette-ranking";

export interface PaletteThreadSearchRow {
  id: string;
  lifecycle: ThreadArchiveFilter;
  primaryText: string;
  highlightRanges: readonly ThreadSearchMatch["highlightRanges"][number][];
  excerpt: {
    text: string;
    highlightRanges: readonly ThreadSearchMatch["highlightRanges"][number][];
  } | null;
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
  sort: PaletteThreadSort;
  sortDirection: PaletteThreadSortDirection;
}

export interface PaletteThreadSearchRowsResult {
  isRecent: boolean;
  rows: PaletteThreadSearchRow[];
}

type HighlightRange = PaletteThreadSearchRow["highlightRanges"][number];

const RECENT_THREAD_LIMIT = 20;

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

function sortDate(thread: ThreadListEntry, sort: PaletteThreadSort): number {
  return sort === "created" ? thread.createdAt : thread.updatedAt;
}

function compareByDate(
  left: ThreadListEntry,
  right: ThreadListEntry,
  sort: PaletteThreadSort,
  direction: PaletteThreadSortDirection,
): number {
  const difference = sortDate(right, sort) - sortDate(left, sort);
  return direction === "ascending" ? -difference : difference;
}

function sortRows(
  rows: readonly PaletteThreadSearchRow[],
  sort: PaletteThreadSort,
  direction: PaletteThreadSortDirection,
): PaletteThreadSearchRow[] {
  if (sort === "relevance") return [...rows];
  return [...rows].sort((left, right) =>
    compareByDate(left.thread, right.thread, sort, direction),
  );
}

function serverRow(
  thread: ThreadListEntry,
  matches: readonly ThreadSearchMatch[],
  lifecycle: ThreadArchiveFilter,
  projectNamesById: ReadonlyMap<string, string>,
  now: number,
  sort: PaletteThreadSort,
): PaletteThreadSearchRow {
  const title = getThreadDisplayTitle(thread);
  const titleMatch = matches.find(
    (match) => isTitleMatch(match) && match.text === title,
  );
  const snippetMatch = matches.find((match) => !isTitleMatch(match));
  return {
    id: `${lifecycle}:${thread.id}`,
    lifecycle,
    primaryText: title,
    highlightRanges: titleMatch?.highlightRanges ?? [],
    excerpt:
      snippetMatch === undefined
        ? null
        : {
            text: snippetMatch.text,
            highlightRanges: snippetMatch.highlightRanges,
          },
    projectName: projectMetadata(thread.projectId, projectNamesById),
    projectHighlightRanges: [],
    relativeTime: formatRelativeTime({ timestamp: sortDate(thread, sort), now }),
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
  sort: PaletteThreadSort,
): PaletteThreadSearchRow[] {
  const titleMatches = fuzzyMatchText({
    items: threads,
    query,
    getText: getThreadDisplayTitle,
    limit: threads.length,
  }).sort(
    (left, right) =>
      right.score - left.score || right.item.updatedAt - left.item.updatedAt,
  );
  const titleRows = titleMatches
    .slice(0, PALETTE_RESULT_LIMIT)
    .map((match) => ({
      ...serverRow(match.item, [], "active", projectNamesById, now, sort),
      highlightRanges: positionsToRanges(match.positions),
    }));
  const remaining = PALETTE_RESULT_LIMIT - titleRows.length;
  if (remaining <= 0) return titleRows;
  const projectMatches = new Map<string, HighlightRange>();
  for (const [projectId, name] of projectNamesById) {
    if (projectId === PERSONAL_PROJECT_ID) continue;
    const match = projectNameMatch(name, query);
    if (match !== null) projectMatches.set(projectId, match);
  }
  if (projectMatches.size === 0) return titleRows;
  const titleMatchIds = new Set(titleMatches.map((match) => match.item.id));
  const projectRows = threads
    .flatMap((thread) => {
      const match = titleMatchIds.has(thread.id)
        ? undefined
        : projectMatches.get(thread.projectId);
      return match === undefined ? [] : [{ thread, match }];
    })
    .sort((left, right) => right.thread.updatedAt - left.thread.updatedAt)
    .slice(0, remaining)
    .map(({ thread, match }) => ({
      ...serverRow(thread, [], "active", projectNamesById, now, sort),
      projectHighlightRanges: [match],
    }));
  return [...titleRows, ...projectRows];
}

const SEARCH_WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const LATIN_DIACRITIC_PATTERN = /[\u0300-\u036f]/gu;

function searchWords(text: string): string[] {
  return (
    text
      .normalize("NFD")
      .replace(LATIN_DIACRITIC_PATTERN, "")
      .toLowerCase()
      .match(SEARCH_WORD_PATTERN) ?? []
  );
}

function titleMatchesFirst(
  rows: readonly PaletteThreadSearchRow[],
  query: string,
): PaletteThreadSearchRow[] {
  const queryWords = searchWords(query);
  const titleMatches: PaletteThreadSearchRow[] = [];
  const otherMatches: PaletteThreadSearchRow[] = [];
  for (const row of rows) {
    const titleWords = searchWords(row.primaryText);
    const isTitleMatch =
      queryWords.length > 0 &&
      queryWords.every((queryWord) =>
        titleWords.some((titleWord) => titleWord.startsWith(queryWord)),
      );
    if (isTitleMatch) titleMatches.push(row);
    else otherMatches.push(row);
  }
  return [...titleMatches, ...otherMatches];
}

function mergeActiveRows(
  localRows: readonly PaletteThreadSearchRow[],
  serverRows: readonly PaletteThreadSearchRow[],
  query: string,
): PaletteThreadSearchRow[] {
  const serverRowsById = new Map(serverRows.map((row) => [row.id, row]));
  const localIds = new Set(localRows.map((row) => row.id));
  const merged = localRows.map((row) => {
    const server = serverRowsById.get(row.id);
    if (server === undefined) return row;
    return {
      ...row,
      highlightRanges:
        row.highlightRanges.length > 0
          ? row.highlightRanges
          : server.highlightRanges,
      excerpt: server.excerpt,
      messageSeq: server.messageSeq,
    };
  });
  return titleMatchesFirst(
    [...merged, ...serverRows.filter((row) => !localIds.has(row.id))],
    query,
  );
}

export function buildPaletteThreadSearchRows({
  lifecycles,
  now,
  projectNamesById,
  query,
  recentThreads,
  searchResponse,
  searchResultsAreCurrent,
  sort,
  sortDirection,
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
            sort,
          ),
        )
      : [];
  const rowsFor = (lifecycle: ThreadArchiveFilter) => {
    if (isRecent) {
      return threadsFor(lifecycle)
        .sort((left, right) =>
          sort !== "relevance"
            ? compareByDate(left, right, sort, sortDirection)
            : lifecycle === "archived"
              ? (right.archivedAt ?? 0) - (left.archivedAt ?? 0)
              : right.updatedAt - left.updatedAt,
        )
        .slice(0, RECENT_THREAD_LIMIT)
        .map((thread) =>
          serverRow(thread, [], lifecycle, projectNamesById, now, sort),
        );
    }
    if (lifecycle === "archived") {
      return sortRows(
        titleMatchesFirst(serverRowsFor(lifecycle), trimmedQuery),
        sort,
        sortDirection,
      );
    }
    return sortRows(
      mergeActiveRows(
        localMatchRows(
          threadsFor(lifecycle),
          trimmedQuery,
          projectNamesById,
          now,
          sort,
        ),
        serverRowsFor(lifecycle),
        trimmedQuery,
      ),
      sort,
      sortDirection,
    );
  };
  return {
    isRecent,
    rows: normalizeThreadLifecycleFilter(lifecycles).flatMap(rowsFor),
  };
}
