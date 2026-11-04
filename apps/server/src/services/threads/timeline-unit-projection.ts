import {
  compactThreadTimelineSummaryEvents,
  projectThreadTimelineUnit,
  type ThreadEventWithMeta,
  type ThreadTimelineUnitProjection,
} from "@bb/thread-view";
import type { CompletedTurnDisplay, Thread } from "@bb/domain";
import {
  isBackgroundTaskStartRow,
  isDetachedBackgroundTaskRow,
  type TimelineUnitEvent,
} from "./timeline-units.js";

export interface TimelineUnitSurface {
  completedTurnDisplay: CompletedTurnDisplay;
  includeDiagnosticOperations: boolean;
  includeNestedRows: boolean;
  providerDisplayName?: string;
  summarizeShellCommands: boolean;
  threadInterruptedAt: number | null;
  threadName: string;
  threadStatus: Thread["status"];
  workspaceRoot: string | null;
}

export interface RetainedOutputTruncation {
  originalLength: number;
  truncatedAt: number;
}

export interface TimelineUnitRows {
  projection: ThreadTimelineUnitProjection;
  retainedOutputs: Array<[string, RetainedOutputTruncation | null]>;
}

export interface TimelineUnitBackgroundTasks {
  foreignSeqs: Set<number>;
  ownedItemIds: string[];
}

export function unownedTimelineUnitBackgroundTaskItemIds(
  events: readonly TimelineUnitEvent[],
  progressedItemIds: ReadonlySet<string>,
): string[] {
  const started = new Set<string>();
  const unowned = new Set<string>();
  for (const { row } of events) {
    if (isBackgroundTaskStartRow(row)) started.add(row.itemId);
    else if (
      isDetachedBackgroundTaskRow(row, progressedItemIds) &&
      !started.has(row.itemId)
    ) {
      unowned.add(row.itemId);
    }
  }
  return [...unowned];
}

export function assignTimelineUnitBackgroundTasks(
  events: readonly TimelineUnitEvent[],
  progressedItemIds: ReadonlySet<string>,
  itemIdsStartedBefore: ReadonlySet<string>,
): TimelineUnitBackgroundTasks {
  const owned = new Set<string>();
  const foreignSeqs = new Set<number>();
  for (const { row } of events) {
    if (isBackgroundTaskStartRow(row)) {
      owned.add(row.itemId);
    } else if (isDetachedBackgroundTaskRow(row, progressedItemIds)) {
      if (!owned.has(row.itemId) && itemIdsStartedBefore.has(row.itemId)) {
        foreignSeqs.add(row.sequence);
      } else {
        owned.add(row.itemId);
      }
    }
  }
  return { foreignSeqs, ownedItemIds: [...owned] };
}

export function projectableTimelineEvents(
  events: readonly TimelineUnitEvent[],
): TimelineUnitEvent[] {
  const latestStateIndex = new Map<string, number>();
  const startedTurnIds = new Set<string>();
  events.forEach((unit, index) => {
    if (unit.row.type === "turn/started" && unit.row.turnId !== null) {
      startedTurnIds.add(unit.row.turnId);
    }
    if (
      unit.row.itemKind === "backgroundTask" &&
      unit.row.itemId !== null &&
      (unit.row.type === "item/backgroundTask/progress" ||
        unit.row.type === "item/backgroundTask/completed")
    ) {
      latestStateIndex.set(unit.row.itemId, index);
    }
  });
  return events.filter(
    (unit, index) =>
      (unit.row.turnId === null || startedTurnIds.has(unit.row.turnId)) &&
      (unit.row.type !== "item/backgroundTask/progress" ||
        unit.row.itemId === null ||
        latestStateIndex.get(unit.row.itemId) === index),
  );
}

export function timelineUnitEventWithMeta({
  event,
  row,
}: TimelineUnitEvent): ThreadEventWithMeta {
  return {
    event,
    meta: { createdAt: row.createdAt, id: row.id, seq: row.sequence },
  };
}

function retainedOutputsOf(
  events: readonly TimelineUnitEvent[],
): TimelineUnitRows["retainedOutputs"] {
  const outputs: TimelineUnitRows["retainedOutputs"] = [];
  for (const { event } of events) {
    if (event.type !== "item/completed") continue;
    const item = event.item;
    if (item.type !== "commandExecution" && item.type !== "toolCall") continue;
    const truncation =
      item.type === "commandExecution"
        ? item.truncation?.aggregatedOutput
        : item.truncation?.result;
    outputs.push([
      item.id,
      truncation === undefined
        ? null
        : {
            originalLength: truncation.originalLength,
            truncatedAt: truncation.truncatedAt,
          },
    ]);
  }
  return outputs;
}

export function projectTimelineUnitRows(
  projectable: readonly TimelineUnitEvent[],
  surface: TimelineUnitSurface,
  foreignBackgroundTaskSeqs: ReadonlySet<number>,
): TimelineUnitRows {
  return {
    projection: projectThreadTimelineUnit({
      acceptedClientRequestContext: {
        acceptedClientRequestEvents: [],
        rejectedClientRequestEvents: [],
      },
      events: compactThreadTimelineSummaryEvents(
        projectable.map(timelineUnitEventWithMeta),
      ),
      foreignBackgroundTaskSeqs,
      options: surface,
      threadInterruptedAt: surface.threadInterruptedAt,
    }),
    retainedOutputs: retainedOutputsOf(projectable),
  };
}
