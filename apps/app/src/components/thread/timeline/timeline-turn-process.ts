// bb-fork(windows): per-turn process timings so timeline messages can show how
// long the turn that produced them ran.
import { createContext } from "react";
import type { TimelineRow } from "@bb/server-contract";

export interface TimelineTurnProcessTiming {
  completedAt: number | null;
  live: boolean;
  startedAt: number;
}

export type TimelineTurnProcessTimings = ReadonlyMap<
  string,
  TimelineTurnProcessTiming
>;

export const EMPTY_TIMELINE_TURN_PROCESS_TIMINGS: TimelineTurnProcessTimings =
  new Map();

export const TimelineTurnProcessContext =
  createContext<TimelineTurnProcessTimings>(
    EMPTY_TIMELINE_TURN_PROCESS_TIMINGS,
  );

export function buildTimelineTurnProcessTimings(
  rows: readonly TimelineRow[],
): TimelineTurnProcessTimings {
  const timings = new Map<string, TimelineTurnProcessTiming>();
  const visit = (candidateRows: readonly TimelineRow[]): void => {
    for (const row of candidateRows) {
      if (row.kind === "turn") {
        timings.set(row.turnId, {
          completedAt: row.completedAt,
          live: row.status === "pending",
          startedAt: row.startedAt,
        });
        if (row.children !== null) {
          visit(row.children);
        }
        continue;
      }
      if (row.kind === "work" && row.workKind === "delegation") {
        visit(row.childRows);
      }
    }
  };
  visit(rows);
  return timings;
}

export function findTimelineTurnProcessTiming(
  timings: TimelineTurnProcessTimings,
  turnId: string | null,
): TimelineTurnProcessTiming | null {
  if (turnId === null) {
    return null;
  }
  return timings.get(turnId) ?? null;
}
