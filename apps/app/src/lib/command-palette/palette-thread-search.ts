import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { fuzzyMatchText } from "@bb/fuzzy-match";
import type {
  ThreadSearchHighlightRange,
  ThreadSearchMatch,
  ThreadSearchResponse,
} from "@bb/server-contract";
import type { PromptDraftState } from "@bb/client-core";
import { formatRelativeTime } from "@/lib/relative-time";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export interface PaletteNewThreadDraft {
  id: string;
  draft: PromptDraftState;
  title: string;
  lastEditedAt: number | null;
  destination: {
    projectId: string;
    sectionId: string | null;
  };
}

export const PALETTE_THREAD_SEARCH_SCOPES = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "draft", label: "Drafts" },
  { id: "archived", label: "Archived" },
] as const;

export type PaletteThreadSearchScope =
  (typeof PALETTE_THREAD_SEARCH_SCOPES)[number]["id"];
export type PaletteThreadLifecycle = "active" | "draft" | "archived";

export interface PaletteThreadSearchRow {
  id: string;
  lifecycle: PaletteThreadLifecycle;
  primaryText: string;
  highlightRanges: readonly ThreadSearchHighlightRange[];
  metadataText: string;
  projectId: string;
  threadId: string | null;
  draftSlotId: string | null;
  messageSeq: number | null;
}

interface BuildPaletteThreadSearchRowsArgs {
  drafts: readonly PaletteNewThreadDraft[];
  now: number;
  projectNamesById: ReadonlyMap<string, string>;
  query: string;
  recentArchivedThreads: readonly ThreadListEntry[];
  recentThreads: readonly ThreadListEntry[];
  scope: PaletteThreadSearchScope;
  searchResponse: ThreadSearchResponse | undefined;
  searchResultsAreCurrent: boolean;
}

export interface PaletteThreadSearchRowsResult {
  draftMatchCount: number;
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
    draftSlotId: null,
    messageSeq: snippetMatch?.sourceSeq ?? null,
  };
}

function draftHighlightRanges(
  text: string,
  positions: readonly number[],
): ThreadSearchHighlightRange[] {
  const offsets = [0];
  for (const character of text) {
    offsets.push((offsets.at(-1) ?? 0) + character.length);
  }
  const ranges: ThreadSearchHighlightRange[] = [];
  for (const position of [...positions].sort((left, right) => left - right)) {
    const start = offsets[position];
    const end = offsets[position + 1];
    if (start === undefined || end === undefined) continue;
    const prior = ranges.at(-1);
    if (prior !== undefined && prior.end === start) {
      prior.end = end;
    } else {
      ranges.push({ start, end });
    }
  }
  return ranges;
}

function includesLifecycle(
  scope: PaletteThreadSearchScope,
  lifecycle: PaletteThreadLifecycle,
): boolean {
  return scope === "all" || scope === lifecycle;
}

export function buildPaletteThreadSearchRows({
  drafts,
  now,
  projectNamesById,
  query,
  recentArchivedThreads,
  recentThreads,
  scope,
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

  const draftMatches =
    isRecent || isSearchable
      ? fuzzyMatchText({
          items: drafts,
          query: trimmedQuery,
          getText: (draft) => draft.title,
          limit: drafts.length,
        })
      : [];
  const draftRows = draftMatches.map(({ item, positions }) => ({
    id: `draft:${item.id}`,
    lifecycle: "draft" as const,
    primaryText: item.title,
    highlightRanges: draftHighlightRanges(item.title, positions),
    metadataText: metadataText([
      projectMetadata(item.destination.projectId, projectNamesById),
      item.lastEditedAt === null
        ? null
        : formatRelativeTime({ timestamp: item.lastEditedAt, now }),
    ]),
    projectId: item.destination.projectId,
    threadId: null,
    draftSlotId: item.id,
    messageSeq: null,
  }));
  const archivedRows = isRecent
    ? recentArchivedThreads
        .slice(0, RECENT_THREAD_LIMIT)
        .map((thread) =>
          serverRow(thread, [], "archived", projectNamesById, now),
        )
    : isSearchable && searchResultsAreCurrent
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
    draftMatchCount: draftMatches.length,
    isRecent,
    rows: [
      ...(includesLifecycle(scope, "active") ? activeRows : []),
      ...(includesLifecycle(scope, "draft") ? draftRows : []),
      ...(includesLifecycle(scope, "archived") ? archivedRows : []),
    ],
  };
}
