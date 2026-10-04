import type { ThreadListEntry } from "@bb/domain";
import { fuzzyMatchText } from "@bb/fuzzy-match";
import type { ThreadSearchResponse } from "@bb/server-contract";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import type { PalettePlace } from "./palette-places";
import { PALETTE_RESULT_LIMIT } from "./palette-ranking";
import {
  LOCAL_ROWS_BEFORE_SERVER_ROWS,
  paletteThreadRow,
  positionsToRanges,
  withServerMatch,
  type HighlightRange,
  type PaletteThreadSearchRow,
} from "./palette-thread-search";
import type { PaletteVisit } from "./palette-visits";

export type PaletteGoToItem =
  | { type: "thread"; row: PaletteThreadSearchRow }
  | {
      type: "place";
      place: PalettePlace;
      highlightRanges: readonly HighlightRange[];
    };

type GoToCandidate =
  | { type: "thread"; thread: ThreadListEntry }
  | { type: "place"; place: PalettePlace };

interface BuildPaletteGoToResultsArgs {
  activeThreads: readonly ThreadListEntry[];
  now: number;
  places: readonly PalettePlace[];
  projectNamesById: ReadonlyMap<string, string>;
  query: string;
  searchResponse: ThreadSearchResponse | undefined;
  searchResultsAreCurrent: boolean;
  visits: readonly PaletteVisit[];
}

const UNVISITED_RANK = Number.MAX_SAFE_INTEGER;

function candidateTitle(candidate: GoToCandidate): string {
  return candidate.type === "thread"
    ? getThreadDisplayTitle(candidate.thread)
    : candidate.place.title;
}

function candidateUpdatedAt(candidate: GoToCandidate): number {
  return candidate.type === "thread" ? candidate.thread.updatedAt : 0;
}

export function buildPaletteGoToResults({
  activeThreads,
  now,
  places,
  projectNamesById,
  query,
  searchResponse,
  searchResultsAreCurrent,
  visits,
}: BuildPaletteGoToResultsArgs): PaletteGoToItem[] {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) return [];
  const visitRanks = new Map<string, number>();
  visits.forEach((visit, index) => {
    const key = `${visit.kind}\u0000${visit.id}`;
    if (!visitRanks.has(key)) visitRanks.set(key, index);
  });
  const visitRankOf = (candidate: GoToCandidate) =>
    visitRanks.get(
      candidate.type === "thread"
        ? `thread\u0000${candidate.thread.id}`
        : `${candidate.place.kind}\u0000${candidate.place.id}`,
    ) ?? UNVISITED_RANK;
  const candidates: GoToCandidate[] = [
    ...activeThreads
      .filter((thread) => thread.archivedAt === null)
      .map((thread) => ({ type: "thread" as const, thread })),
    ...places.map((place) => ({ type: "place" as const, place })),
  ];
  const local = fuzzyMatchText({
    items: candidates,
    query: trimmedQuery,
    getText: candidateTitle,
    limit: candidates.length,
  })
    .sort(
      (left, right) =>
        right.score - left.score ||
        visitRankOf(left.item) - visitRankOf(right.item) ||
        candidateUpdatedAt(right.item) - candidateUpdatedAt(left.item),
    )
    .slice(0, PALETTE_RESULT_LIMIT)
    .map((match): PaletteGoToItem => {
      const highlightRanges = positionsToRanges(match.positions);
      return match.item.type === "thread"
        ? {
            type: "thread",
            row: {
              ...paletteThreadRow(
                match.item.thread,
                [],
                "active",
                projectNamesById,
                now,
              ),
              highlightRanges,
            },
          }
        : { type: "place", place: match.item.place, highlightRanges };
    });
  const serverRows =
    trimmedQuery.length >= 2 && searchResultsAreCurrent
      ? (["active", "archived"] as const).flatMap((lifecycle) =>
          (searchResponse?.[lifecycle]?.results ?? []).map((result) =>
            paletteThreadRow(
              result.thread,
              result.matches,
              lifecycle,
              projectNamesById,
              now,
            ),
          ),
        )
      : [];
  const serverRowsByThreadId = new Map<string, PaletteThreadSearchRow>();
  for (const row of serverRows) {
    if (!serverRowsByThreadId.has(row.threadId)) {
      serverRowsByThreadId.set(row.threadId, row);
    }
  }
  const localThreadIds = new Set(
    local.flatMap((item) => (item.type === "thread" ? [item.row.threadId] : [])),
  );
  const merged = local.map(
    (item): PaletteGoToItem =>
      item.type === "thread"
        ? {
            type: "thread",
            row: withServerMatch(
              item.row,
              serverRowsByThreadId.get(item.row.threadId),
            ),
          }
        : item,
  );
  const serverOnly = [...serverRowsByThreadId.values()]
    .filter((row) => !localThreadIds.has(row.threadId))
    .map((row): PaletteGoToItem => ({ type: "thread", row }));
  return [
    ...merged.slice(0, LOCAL_ROWS_BEFORE_SERVER_ROWS),
    ...serverOnly,
    ...merged.slice(LOCAL_ROWS_BEFORE_SERVER_ROWS),
  ];
}
