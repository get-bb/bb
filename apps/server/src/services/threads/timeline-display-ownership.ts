import type { StoredEventRow } from "@bb/db";
import type { ThreadEventType } from "@bb/domain";
import { timelineRowChildren, type TimelineRow } from "@bb/server-contract";
import type { TimelineTurnBlock } from "./timeline-context-order.js";

export const TURN_GROUPED_THREAD_EVENT_TYPES: ReadonlySet<ThreadEventType> =
  new Set([
    "provider/warning",
    "provider/modelFallback",
    "system/interaction/lifecycle",
    "system/permissionGrant/lifecycle",
    "system/userQuestion/lifecycle",
  ]);

export interface TimelineSequenceRange {
  beforeSequence: number;
  sequenceStart: number;
}

interface TimelineDisplayOwnershipArgs {
  boundarySequence: number | null;
  lastAcceptanceSequences: ReadonlyMap<string, number>;
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
  crossingTurnId: string | null;
  suffixStartPosition: number | null;
  orderedBetween(
    position: number,
    beforePosition: number,
    standaloneSequences: readonly number[],
  ): boolean;
  changedThroughSequences(rows: readonly TimelineRow[]): Map<string, number>;
  ownershipSequences(rows: readonly TimelineRow[]): Map<string, number>;
  runningTurnAt(sequence: number): string | null;
}

function lastLoadedSequences(
  rows: readonly StoredEventRow[],
  turnIds: ReadonlySet<string>,
): Map<string, number[]> {
  const sequences = new Map<string, number[]>();
  if (turnIds.size === 0) return sequences;
  for (const row of rows) {
    if (
      row.turnId === null ||
      row.parentToolCallId !== null ||
      !turnIds.has(row.turnId)
    ) {
      continue;
    }
    const turn = sequences.get(row.turnId) ?? [];
    turn.push(row.sequence);
    sequences.set(row.turnId, turn);
  }
  return sequences;
}

const blocksByStartedSequence = new WeakMap<
  readonly TimelineTurnBlock[],
  { blocks: readonly TimelineTurnBlock[]; openTurnIds: ReadonlySet<string> }
>();

function startedOrder(turnBlocks: readonly TimelineTurnBlock[]): {
  blocks: readonly TimelineTurnBlock[];
  openTurnIds: ReadonlySet<string>;
} {
  let order = blocksByStartedSequence.get(turnBlocks);
  if (order === undefined) {
    order = {
      blocks: [...turnBlocks].sort(
        (left, right) => left.startedSequence - right.startedSequence,
      ),
      openTurnIds: new Set(
        turnBlocks.flatMap((block) =>
          block.completionSequence === null ? [block.turnId] : [],
        ),
      ),
    };
    blocksByStartedSequence.set(turnBlocks, order);
  }
  return order;
}

interface LastChangeSequences {
  items: Map<string, number>;
  turns: Map<string, number>;
  lateChangingItemsByTurn: Map<string, { itemId: string; sequence: number }[]>;
}

const LATE_CHANGING_ITEM_KINDS: ReadonlySet<string> = new Set([
  "backgroundTask",
  "delegation",
  "toolCall",
]);

function lastChangeSequences(
  rows: readonly StoredEventRow[],
): LastChangeSequences {
  const items = new Map<string, number>();
  const lateChangingItemsByTurn = new Map<
    string,
    { itemId: string; sequence: number }[]
  >();
  const turns = new Map<string, number>();
  const bump = (key: string, sequence: number) => {
    if ((items.get(key) ?? -Infinity) < sequence) items.set(key, sequence);
  };
  for (const row of rows) {
    if (
      row.turnId !== null &&
      row.parentToolCallId === null &&
      (turns.get(row.turnId) ?? -Infinity) < row.sequence
    ) {
      turns.set(row.turnId, row.sequence);
    }
    if (row.parentToolCallId !== null) bump(row.parentToolCallId, row.sequence);
    if (
      row.itemId === null ||
      row.itemKind === null ||
      !LATE_CHANGING_ITEM_KINDS.has(row.itemKind)
    ) {
      continue;
    }
    bump(row.itemId, row.sequence);
    if (
      row.type === "item/started" &&
      row.turnId !== null &&
      row.parentToolCallId === null
    ) {
      const turnItems = lateChangingItemsByTurn.get(row.turnId) ?? [];
      turnItems.push({ itemId: row.itemId, sequence: row.sequence });
      lateChangingItemsByTurn.set(row.turnId, turnItems);
    }
  }
  return { items, lateChangingItemsByTurn, turns };
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

export function createTimelineDisplayOwnership(
  args: TimelineDisplayOwnershipArgs,
): TimelineDisplayOwnership {
  const boundary = args.boundarySequence ?? Infinity;
  const loaded = lastLoadedSequences(
    args.loadedRows,
    startedOrder(args.turnBlocks).openTurnIds,
  );
  const lastSequenceBelow = (block: TimelineTurnBlock, below: number) => {
    let last =
      block.lastContextSequence < below
        ? block.lastContextSequence
        : block.sequenceStart;
    for (const sequence of loaded.get(block.turnId) ?? []) {
      if (sequence < below && sequence > last) last = sequence;
    }
    return Math.min(last, args.maxSeq);
  };
  const blockEnd = (block: TimelineTurnBlock): number =>
    block.completionSequence === null
      ? lastSequenceBelow(block, Infinity)
      : Math.min(
          Math.max(block.completionSequence, block.lastContextSequence),
          args.maxSeq,
        );
  const candidates = sortedCandidateBlocks(args.turnBlocks, boundary);
  const crossingIndex = candidates.findIndex(
    (block) => blockEnd(block) >= boundary,
  );
  const crossing = crossingIndex === -1 ? null : candidates[crossingIndex]!;
  if (crossing !== null && !loaded.has(crossing.turnId)) {
    for (const [turnId, sequences] of lastLoadedSequences(
      args.loadedRows,
      new Set([crossing.turnId]),
    )) {
      loaded.set(turnId, sequences);
    }
  }
  const prefixBlocks =
    crossingIndex === -1 ? candidates : candidates.slice(0, crossingIndex);
  const prefixEnds: number[] = [];
  let runningEnd = -Infinity;
  for (const block of prefixBlocks) {
    runningEnd = Math.max(runningEnd, blockEnd(block));
    prefixEnds.push(runningEnd);
  }
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
          lastSequenceBelow(crossing, boundary),
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
  const blockStarts = new Map(
    args.turnBlocks.map((block) => [block.turnId, block.startedSequence]),
  );
  const runningTurnAt = (sequence: number): string | null => {
    const { blocks } = startedOrder(args.turnBlocks);
    let low = 0;
    let high = blocks.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (blocks[middle]!.startedSequence < sequence) low = middle + 1;
      else high = middle;
    }
    for (let index = low - 1; index >= 0; index -= 1) {
      const block = blocks[index]!;
      if (
        block.completionSequence === null ||
        block.completionSequence >= sequence
      ) {
        return block.turnId;
      }
    }
    return null;
  };
  let lastChanges: LastChangeSequences | null = null;
  const completions = new Map(
    args.turnBlocks.map((block) => [block.turnId, block.completionSequence]),
  );
  const suffixOwnedBy = (windowStart: number, windowEnd: number) =>
    crossing !== null &&
    windowStart > crossing.startedSequence &&
    suffixFloor >= windowStart &&
    suffixFloor < windowEnd;

  return {
    orderedBetween(position, beforePosition, standalone) {
      const blocks = startedOrder(args.turnBlocks).blocks;
      let runningEnd =
        crossing === null ? -Infinity : lastSequenceBelow(crossing, boundary);
      let next = 0;
      for (const block of blocks) {
        if (block.startedSequence <= position) continue;
        if (block.startedSequence >= beforePosition) break;
        while (
          next < standalone.length &&
          standalone[next]! < block.startedSequence
        ) {
          if (standalone[next]! < runningEnd) return false;
          runningEnd = Math.max(runningEnd, standalone[next]!);
          next += 1;
        }
        if (block.sequenceStart < runningEnd) return false;
        runningEnd = Math.max(runningEnd, blockEnd(block));
      }
      for (; next < standalone.length; next += 1) {
        if (standalone[next]! < runningEnd) return false;
        runningEnd = Math.max(runningEnd, standalone[next]!);
      }
      return true;
    },
    crossingTurnId: crossing?.turnId ?? null,
    suffixStartPosition:
      crossing?.startedSequence ?? (boundary === Infinity ? null : boundary),
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
    ownershipSequences(rows) {
      const sequences = new Map<string, number>();
      let displayedMax = -Infinity;
      for (const row of rows) {
        const entryStart =
          row.turnId === null
            ? row.sourceSeqStart
            : (blockStarts.get(row.turnId) ?? row.sourceSeqStart);
        displayedMax = Math.max(displayedMax, row.sourceSeqStart);
        sequences.set(
          row.id,
          Math.max(displayedMax, floorOf(entryStart, row.sourceSeqStart)),
        );
      }
      return sequences;
    },
    changedThroughSequences(rows) {
      lastChanges ??= lastChangeSequences(args.loadedRows);
      const changes = lastChanges;
      const sequences = new Map<string, number>();
      const visit = (row: TimelineRow): number => {
        const children = timelineRowChildren(row);
        let through = row.sourceSeqEnd;
        for (const child of children ?? []) {
          through = Math.max(through, visit(child));
        }
        if (row.kind === "turn" && row.turnId !== null) {
          through = Math.max(
            through,
            completions.get(row.turnId) ?? -Infinity,
            args.lastAcceptanceSequences.get(row.turnId) ?? -Infinity,
            changes.turns.get(row.turnId) ?? -Infinity,
          );
          if (children === null) {
            for (const item of changes.lateChangingItemsByTurn.get(
              row.turnId,
            ) ?? []) {
              if (
                item.sequence >= row.sourceSeqStart &&
                item.sequence <= row.sourceSeqEnd
              ) {
                through = Math.max(
                  through,
                  changes.items.get(item.itemId) ?? -Infinity,
                );
              }
            }
          }
        }
        const itemId =
          row.kind !== "work"
            ? null
            : row.workKind === "workflow"
              ? row.itemId
              : row.workKind === "delegation"
                ? row.callId
                : null;
        if (itemId !== null) {
          through = Math.max(through, changes.items.get(itemId) ?? -Infinity);
        }
        sequences.set(row.id, through);
        return through;
      };
      for (const row of rows) visit(row);
      return sequences;
    },
    runningTurnAt,
  };
}
