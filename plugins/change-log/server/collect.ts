import type { ChangeStatus } from "../shared/contract.js";
import type { TimelineRow } from "./timeline-types.js";

export interface CollectedChange {
  rowId: string;
  threadId: string;
  turnId: string | null;
  seqStart: number;
  seqEnd: number;
  createdAt: number;
  path: string;
  movePath: string | null;
  kind: string | null;
  diff: string | null;
  added: number;
  removed: number;
  status: ChangeStatus;
  approvalStatus: "waiting_for_approval" | "denied" | null;
  nestedThreadId: string | null;
}

export interface CollectedTurn {
  turnId: string;
  startedAt: number;
  completedAt: number | null;
  status: ChangeStatus;
}

export interface CollectedTimeline {
  changes: CollectedChange[];
  turns: CollectedTurn[];
}

function childRowsOf(row: TimelineRow): readonly TimelineRow[] {
  if (row.kind === "turn") {
    return row.children ?? [];
  }
  if (row.kind === "work" && row.workKind === "delegation") {
    return row.childRows;
  }
  return [];
}

export function collectTimelineChanges(
  rows: readonly TimelineRow[],
  rootThreadId: string,
): CollectedTimeline {
  const changes: CollectedChange[] = [];
  const turns: CollectedTurn[] = [];
  const seenChanges = new Set<string>();
  const seenTurns = new Set<string>();

  const visit = (row: TimelineRow): void => {
    if (row.kind === "turn") {
      if (!seenTurns.has(row.turnId)) {
        seenTurns.add(row.turnId);
        turns.push({
          turnId: row.turnId,
          startedAt: row.startedAt,
          completedAt: row.completedAt,
          status: row.status,
        });
      }
    } else if (row.kind === "work" && row.workKind === "file-change") {
      if (!seenChanges.has(row.id)) {
        seenChanges.add(row.id);
        changes.push({
          rowId: row.id,
          threadId: row.threadId,
          turnId: row.turnId,
          seqStart: row.sourceSeqStart,
          seqEnd: row.sourceSeqEnd,
          createdAt: row.createdAt,
          path: row.change.path,
          movePath: row.change.movePath,
          kind: row.change.kind,
          diff: row.change.diff,
          added: row.change.diffStats.added,
          removed: row.change.diffStats.removed,
          status: row.status,
          approvalStatus: row.approvalStatus,
          nestedThreadId: row.threadId === rootThreadId ? null : row.threadId,
        });
      }
    }

    for (const child of childRowsOf(row)) {
      visit(child);
    }
  };

  for (const row of rows) {
    visit(row);
  }

  changes.sort(
    (left, right) =>
      left.seqStart - right.seqStart || left.createdAt - right.createdAt,
  );
  turns.sort((left, right) => left.startedAt - right.startedAt);

  return { changes, turns };
}
