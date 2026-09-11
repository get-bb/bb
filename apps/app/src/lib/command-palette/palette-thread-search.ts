import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type {
  ThreadSearchHighlightRange,
  ThreadSearchMatch,
  ThreadSearchResponse,
} from "@bb/server-contract";
import { formatRelativeTime } from "@/lib/relative-time";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export type PaletteThreadLifecycle = "active" | "archived";

export interface PaletteThreadSearchRow {
  id: string;
  lifecycle: PaletteThreadLifecycle;
  primaryText: string;
  highlightRanges: readonly ThreadSearchHighlightRange[];
  metadataText: string;
  projectId: string;
  threadId: string;
  messageSeq: number | null;
}

interface BuildPaletteThreadSearchRowsArgs {
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

function metadataText(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" · ");
}

function serverRow(
  thread: ThreadListEntry,
  matches: readonly ThreadSearchMatch[],
  lifecycle: "active" | "archived",
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
    metadataText: metadataText([
      snippetMatch === undefined ? null : title,
      projectMetadata(thread.projectId, projectNamesById),
      formatRelativeTime({ timestamp: thread.updatedAt, now }),
    ]),
    projectId: thread.projectId,
    threadId: thread.id,
    messageSeq: snippetMatch?.sourceSeq ?? null,
  };
}

export function buildPaletteThreadSearchRows({
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
  const activeRows = isRecent
    ? recentThreads
        .slice(0, RECENT_THREAD_LIMIT)
        .map((thread) => serverRow(thread, [], "active", projectNamesById, now))
    : isSearchable && searchResultsAreCurrent
      ? (searchResponse?.active.results ?? []).map((result) =>
          serverRow(
            result.thread,
            result.matches,
            "active",
            projectNamesById,
            now,
          ),
        )
      : [];

  const archivedRows =
    isSearchable && searchResultsAreCurrent
      ? (searchResponse?.archived.results ?? []).map((result) =>
          serverRow(
            result.thread,
            result.matches,
            "archived",
            projectNamesById,
            now,
          ),
        )
      : [];

  return {
    isRecent,
    rows: [...activeRows, ...archivedRows],
  };
}
