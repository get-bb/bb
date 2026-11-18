import type { StoredEventRow } from "@bb/db";
import type { TimelineRow } from "@bb/server-contract";
import type { TimelineTurnBlock } from "./timeline-context-order.js";

export interface TimelineSequenceRange {
  beforeSequence: number;
  sequenceStart: number;
}

interface TimelineDisplayOwnershipArgs {
  boundarySequence: number | null;
  loadedRows: readonly StoredEventRow[];
  maxSeq: number;
  turnBlocks: readonly TimelineTurnBlock[];
}

export interface TimelineDisplayOwnership {
  ownedThreadRowRanges(
    windowStart: number,
    windowEnd: number,
  ): TimelineSequenceRange[];
  ownedTurnIdsBefore(windowStart: number, windowEnd: number): string[];
  ownershipSequences(
    rows: readonly TimelineRow[],
    joinedTurnIdBySequence: ReadonlyMap<number, string>,
  ): Map<string, number>;
}

interface LoadedTurnSequences {
  last: number;
  lastBeforeBoundary: number;
}

function recordLoadedSequence(
  sequences: Map<string, LoadedTurnSequences>,
  turnId: string,
  sequence: number,
  boundary: number,
): void {
  let turn = sequences.get(turnId);
  if (turn === undefined) {
    turn = { last: -Infinity, lastBeforeBoundary: -Infinity };
    sequences.set(turnId, turn);
  }
  if (sequence > turn.last) turn.last = sequence;
  if (sequence < boundary && sequence > turn.lastBeforeBoundary) {
    turn.lastBeforeBoundary = sequence;
  }
}

function lastLoadedSequences(
  rows: readonly StoredEventRow[],
  turnStarts: ReadonlyMap<string, number>,
  boundary: number,
): Map<string, LoadedTurnSequences> {
  const sequences = new Map<string, LoadedTurnSequences>();
  if (turnStarts.size === 0) return sequences;
  const unresolved = new Map(turnStarts);
  let earliestUnresolvedStart = Math.min(...unresolved.values());
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    if (index < rows.length - 1 && row.sequence > rows[index + 1]!.sequence) {
      sequences.clear();
      for (const each of rows) {
        if (
          each.turnId !== null &&
          each.parentToolCallId === null &&
          turnStarts.has(each.turnId)
        ) {
          recordLoadedSequence(sequences, each.turnId, each.sequence, boundary);
        }
      }
      return sequences;
    }
    if (row.sequence < earliestUnresolvedStart) break;
    if (
      row.turnId === null ||
      row.parentToolCallId !== null ||
      !unresolved.has(row.turnId)
    ) {
      continue;
    }
    recordLoadedSequence(sequences, row.turnId, row.sequence, boundary);
    if (row.sequence < boundary) {
      unresolved.delete(row.turnId);
      earliestUnresolvedStart =
        unresolved.size === 0 ? Infinity : Math.min(...unresolved.values());
    }
  }
  return sequences;
}

const openTurnStartsByTurnBlocks = new WeakMap<
  readonly TimelineTurnBlock[],
  ReadonlyMap<string, number>
>();

function openTurnStarts(
  turnBlocks: readonly TimelineTurnBlock[],
): ReadonlyMap<string, number> {
  let starts = openTurnStartsByTurnBlocks.get(turnBlocks);
  if (starts === undefined) {
    starts = new Map(
      turnBlocks.flatMap((block) =>
        block.completionSequence === null
          ? [[block.turnId, block.sequenceStart] as const]
          : [],
      ),
    );
    openTurnStartsByTurnBlocks.set(turnBlocks, starts);
  }
  return starts;
}

const candidateBlocksByTurnBlocks = new WeakMap<
  readonly TimelineTurnBlock[],
  Map<number, readonly TimelineTurnBlock[]>
>();

function sortedCandidateBlocks(
  turnBlocks: readonly TimelineTurnBlock[],
  boundary: number,
): readonly TimelineTurnBlock[] {
  let byBoundary = candidateBlocksByTurnBlocks.get(turnBlocks);
  if (byBoundary === undefined) {
    byBoundary = new Map();
    candidateBlocksByTurnBlocks.set(turnBlocks, byBoundary);
  }
  let candidates = byBoundary.get(boundary);
  if (candidates === undefined) {
    candidates = turnBlocks
      .filter((block) => block.sequenceStart < boundary)
      .sort((left, right) => left.startedSequence - right.startedSequence);
    byBoundary.set(boundary, candidates);
  }
  return candidates;
}

const blockStartsByTurnBlocks = new WeakMap<
  readonly TimelineTurnBlock[],
  ReadonlyMap<string, number>
>();

function blockStartsByTurnId(
  turnBlocks: readonly TimelineTurnBlock[],
): ReadonlyMap<string, number> {
  let starts = blockStartsByTurnBlocks.get(turnBlocks);
  if (starts === undefined) {
    starts = new Map(
      turnBlocks.map((block) => [block.turnId, block.startedSequence]),
    );
    blockStartsByTurnBlocks.set(turnBlocks, starts);
  }
  return starts;
}

function crossingLastBeforeBoundary(
  rows: readonly StoredEventRow[],
  crossing: TimelineTurnBlock,
  boundary: number,
): number {
  let last = -Infinity;
  for (const row of rows) {
    if (
      row.sequence < boundary &&
      row.sequence > last &&
      row.turnId === crossing.turnId &&
      row.parentToolCallId === null
    ) {
      last = row.sequence;
    }
  }
  return last;
}

export function createTimelineDisplayOwnership(
  args: TimelineDisplayOwnershipArgs,
): TimelineDisplayOwnership {
  const boundary = args.boundarySequence ?? Infinity;
  const loaded = lastLoadedSequences(
    args.loadedRows,
    openTurnStarts(args.turnBlocks),
    boundary,
  );
  const lastSequenceBelow = (
    block: TimelineTurnBlock,
    below: number,
    loadedLast: number,
  ) =>
    Math.min(
      Math.max(
        block.lastContextSequence < below
          ? block.lastContextSequence
          : block.sequenceStart,
        loadedLast,
      ),
      args.maxSeq,
    );
  const blockEnd = (block: TimelineTurnBlock): number =>
    block.completionSequence === null
      ? lastSequenceBelow(
          block,
          Infinity,
          loaded.get(block.turnId)?.last ?? -Infinity,
        )
      : Math.min(
          Math.max(block.completionSequence, block.lastContextSequence),
          args.maxSeq,
        );
  const candidates = sortedCandidateBlocks(args.turnBlocks, boundary);
  const prefixEnds: number[] = [];
  let crossingIndex = -1;
  let runningEnd = -Infinity;
  for (let index = 0; index < candidates.length; index += 1) {
    const end = blockEnd(candidates[index]!);
    if (end >= boundary) {
      crossingIndex = index;
      break;
    }
    runningEnd = Math.max(runningEnd, end);
    prefixEnds.push(runningEnd);
  }
  const crossing = crossingIndex === -1 ? null : candidates[crossingIndex]!;
  if (crossing !== null && !loaded.has(crossing.turnId)) {
    const lastBeforeBoundary = crossingLastBeforeBoundary(
      args.loadedRows,
      crossing,
      boundary,
    );
    loaded.set(crossing.turnId, {
      last: lastBeforeBoundary,
      lastBeforeBoundary,
    });
  }
  const prefixBlocks =
    crossingIndex === -1 ? candidates : candidates.slice(0, crossingIndex);
  const prefixFloor = (sequence: number): number => {
    let low = 0;
    let high = prefixBlocks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (prefixBlocks[middle]!.startedSequence < sequence) low = middle + 1;
      else high = middle;
    }
    return low === 0 ? -Infinity : prefixEnds[low - 1]!;
  };
  const suffixFloor =
    crossing === null
      ? -Infinity
      : Math.max(
          prefixEnds.at(-1) ?? -Infinity,
          lastSequenceBelow(
            crossing,
            boundary,
            loaded.get(crossing.turnId)?.lastBeforeBoundary ?? -Infinity,
          ),
        );
  const prefixEnd = crossing?.startedSequence ?? boundary;
  const floorOf = (entryStart: number, sequence: number): number => {
    if (entryStart < prefixEnd) return prefixFloor(entryStart);
    if (
      crossing !== null &&
      entryStart === crossing.startedSequence &&
      sequence < boundary
    ) {
      return prefixFloor(entryStart);
    }
    return suffixFloor;
  };
  const firstPrefixBlockReaching = (sequence: number): number => {
    let low = 0;
    let high = prefixEnds.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (prefixEnds[middle]! < sequence) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  const blockStarts = blockStartsByTurnId(args.turnBlocks);
  const suffixOwnedBy = (windowStart: number, windowEnd: number) =>
    crossing !== null &&
    windowStart > crossing.startedSequence &&
    suffixFloor >= windowStart &&
    suffixFloor < windowEnd;

  const ownership: TimelineDisplayOwnership = {
    ownedThreadRowRanges(windowStart, windowEnd) {
      const ranges: TimelineSequenceRange[] = [];
      const first = firstPrefixBlockReaching(windowStart);
      if (first < prefixBlocks.length) {
        const pastEnd = firstPrefixBlockReaching(windowEnd);
        const beforeSequence = Math.min(
          windowStart,
          prefixEnd,
          pastEnd >= prefixBlocks.length
            ? Infinity
            : prefixBlocks[pastEnd]!.startedSequence + 1,
        );
        const sequenceStart = prefixBlocks[first]!.startedSequence + 1;
        if (sequenceStart < beforeSequence) {
          ranges.push({ sequenceStart, beforeSequence });
        }
      }
      if (suffixOwnedBy(windowStart, windowEnd)) {
        ranges.push({
          sequenceStart: crossing!.startedSequence + 1,
          beforeSequence: windowStart,
        });
      }
      return ranges;
    },
    ownedTurnIdsBefore(windowStart, windowEnd) {
      const owned = prefixBlocks.flatMap((block) => {
        if (block.startedSequence >= windowStart) return [];
        const floor = prefixFloor(block.startedSequence);
        return floor >= windowStart && floor < windowEnd ? [block.turnId] : [];
      });
      if (
        crossing !== null &&
        windowStart < boundary &&
        windowEnd > crossing.sequenceStart
      ) {
        owned.push(crossing.turnId);
      }
      if (suffixOwnedBy(windowStart, windowEnd)) {
        for (const block of args.turnBlocks) {
          if (
            block.startedSequence > crossing!.startedSequence &&
            block.sequenceStart < windowStart
          ) {
            owned.push(block.turnId);
          }
        }
      }
      return owned;
    },
    ownershipSequences(rows, joinedTurnIdBySequence) {
      const sequences = new Map<string, number>();
      let displayedMax = -Infinity;
      for (const row of rows) {
        const turnId =
          row.turnId ?? joinedTurnIdBySequence.get(row.sourceSeqStart) ?? null;
        const entryStart =
          turnId === null
            ? row.sourceSeqStart
            : (blockStarts.get(turnId) ?? row.sourceSeqStart);
        displayedMax = Math.max(displayedMax, row.sourceSeqStart);
        const owned = Math.max(
          displayedMax,
          floorOf(entryStart, row.sourceSeqStart),
        );
        if (owned !== row.sourceSeqStart) sequences.set(row.id, owned);
      }
      return sequences;
    },
  };
  return ownership;
}
