import { describe, expect, it } from "vitest";
import type {
  ThreadRewindBranchHistoryResponse,
  TimelineRow,
} from "@bb/server-contract";
import { computeTimelineRewindBoundaries } from "./rewind-boundaries.js";

function row(
  id: string,
  sourceSeqStart: number,
  sourceSeqEnd: number,
): TimelineRow {
  return {
    id,
    threadId: "thr_1",
    turnId: null,
    sourceSeqStart,
    sourceSeqEnd,
    startedAt: sourceSeqEnd,
    createdAt: sourceSeqEnd,
    kind: "system",
    systemKind: "operation",
    operationKind: "generic",
    title: "row",
    detail: null,
    status: "completed",
    completedAt: sourceSeqEnd,
  };
}

function history(
  overrides: Partial<ThreadRewindBranchHistoryResponse> = {},
): ThreadRewindBranchHistoryResponse {
  return {
    activeBranchId: "br_active",
    branches: [
      {
        id: "br_root",
        threadId: "thr_1",
        parentBranchId: null,
        cutoffSequence: 0,
        creationReason: "thread-start",
        lifecycle: "available",
        cleanupStatus: "not-needed",
        createdAt: 1,
        activatedAt: 1,
        deactivatedAt: 10,
        updatedAt: 10,
        active: false,
      },
      {
        id: "br_rewind",
        threadId: "thr_1",
        parentBranchId: "br_root",
        cutoffSequence: 8,
        creationReason: "rewind",
        lifecycle: "active",
        cleanupStatus: "not-needed",
        createdAt: 10,
        activatedAt: 10,
        deactivatedAt: null,
        updatedAt: 10,
        active: true,
      },
    ],
    ...overrides,
  };
}

describe("computeTimelineRewindBoundaries", () => {
  it("places a marker before the first row after a rewind cutoff", () => {
    const rows = [
      row("r1", 0, 3),
      row("r2", 4, 7),
      row("r3", 8, 12),
      row("r4", 13, 20),
    ];

    expect(
      computeTimelineRewindBoundaries({ history: history(), rows }),
    ).toEqual([
      { beforeRowIndex: 3, branchId: "br_rewind", cutoffSequence: 8 },
    ]);
  });

  it("marks the active branch too when it is itself a rewind branch", () => {
    const rows = [
      row("r1", 0, 3),
      row("r2", 4, 7),
      row("r3", 8, 11),
      row("r4", 12, 15),
    ];

    expect(
      computeTimelineRewindBoundaries({
        history: history({
          activeBranchId: "br_rewind",
          branches: [
            ...history().branches.map((branch) =>
              branch.id === "br_rewind" ? { ...branch, active: true } : branch,
            ),
          ],
        }),
        rows,
      }),
    ).toEqual([
      { beforeRowIndex: 3, branchId: "br_rewind", cutoffSequence: 8 },
    ]);
  });

  it("returns no markers without history or rows entirely inside one branch", () => {
    expect(
      computeTimelineRewindBoundaries({ history: undefined, rows: [] }),
    ).toEqual([]);
    expect(
      computeTimelineRewindBoundaries({
        history: history(),
        rows: [row("r1", 0, 3)],
      }),
    ).toEqual([]);
  });

  it("marks every rewind branch that has rows after its cutoff", () => {
    const rows = [
      row("r1", 0, 3),
      row("r2", 4, 7),
      row("r3", 8, 11),
      row("r4", 12, 15),
      row("r5", 16, 20),
    ];
    const multi = history({
      activeBranchId: "br_second_rewind",
      branches: [
        ...history().branches,
        {
          id: "br_second_rewind",
          threadId: "thr_1",
          parentBranchId: "br_rewind",
          cutoffSequence: 12,
          creationReason: "rewind",
          lifecycle: "active",
          cleanupStatus: "not-needed",
          createdAt: 21,
          activatedAt: 21,
          deactivatedAt: null,
          updatedAt: 21,
          active: true,
        },
      ],
    });

    expect(computeTimelineRewindBoundaries({ history: multi, rows })).toEqual([
      { beforeRowIndex: 3, branchId: "br_rewind", cutoffSequence: 8 },
      { beforeRowIndex: 4, branchId: "br_second_rewind", cutoffSequence: 12 },
    ]);
  });
});
