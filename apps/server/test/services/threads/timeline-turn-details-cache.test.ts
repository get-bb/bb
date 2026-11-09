import { afterEach, describe, expect, it, vi } from "vitest";
import { buildThreadTimelineTurnDetailsFromEvents } from "@bb/thread-view";
import { turnScope } from "@bb/domain";
import { getLatestThreadSequence, insertEvents, noopNotifier } from "@bb/db";
import type { TimelineRow } from "@bb/server-contract";
import { buildTimelineTurnSummaryDetails } from "../../../src/services/threads/timeline.js";
import {
  appendRows,
  PROVIDER_THREAD_ID,
  withTestThread,
  type RowSpec,
  type TestThread,
} from "../../helpers/timeline-cache-fixture.js";

vi.mock("@bb/thread-view", async (importOriginal) => {
  const original = await importOriginal<typeof import("@bb/thread-view")>();
  return {
    ...original,
    buildThreadTimelineTurnDetailsFromEvents: vi.fn(
      original.buildThreadTimelineTurnDetailsFromEvents,
    ),
  };
});

const TURN_ID = "turn-details";
const COMMAND_COUNT = 450;
const RETENTION_EXPIRES_AT = 2_000_000_000_000;

function command(index: number, truncated: boolean): RowSpec[] {
  const itemId = `command-${index}`;
  const item = {
    type: "commandExecution",
    id: itemId,
    command: `echo ${index}`,
    cwd: "/tmp/memo",
    approvalStatus: null,
  };
  return [
    {
      type: "item/started",
      turnId: TURN_ID,
      itemId,
      itemKind: "commandExecution",
      data: { item: { ...item, status: "pending" } },
    },
    {
      type: "item/completed",
      turnId: TURN_ID,
      itemId,
      itemKind: "commandExecution",
      data: {
        item: {
          ...item,
          status: "completed",
          exitCode: 0,
          aggregatedOutput: `output ${index}`,
          ...(truncated
            ? {
                truncation: {
                  aggregatedOutput: {
                    originalLength: 50_000,
                    retainedHeadLength: 10,
                    retainedTailLength: 10,
                    truncatedAt: RETENTION_EXPIRES_AT,
                  },
                },
              }
            : {}),
        },
      },
    },
  ];
}

function seedTurn(testThread: TestThread): { end: number; start: number } {
  const start = getLatestThreadSequence(testThread.db, {
    threadId: testThread.thread.id,
  });
  const end = appendRows(testThread, [
    { type: "turn/started", turnId: TURN_ID },
    ...Array.from({ length: COMMAND_COUNT }, (_, index) =>
      command(index, index === COMMAND_COUNT - 1),
    ).flat(),
    {
      type: "turn/completed",
      turnId: TURN_ID,
      data: { status: "completed" },
    },
  ]);
  return { end, start: start + 1 };
}

function walkDetails(
  db: TestThread["db"],
  testThread: TestThread,
  range: { end: number; start: number },
) {
  const pages: ReturnType<typeof buildTimelineTurnSummaryDetails>[] = [];
  let beforeCursor: string | undefined;
  do {
    const page = buildTimelineTurnSummaryDetails(db, testThread.thread, {
      beforeCursor,
      completedTurnDisplay: "collapse",
      deferContent: true,
      includeDiagnosticOperations: false,
      itemId: null,
      sourceSeqEnd: range.end,
      sourceSeqStart: range.start,
      summarizeShellCommands: false,
      turnId: TURN_ID,
    });
    pages.push(page);
    beforeCursor = page.olderCursor ?? undefined;
  } while (beforeCursor !== undefined);
  return pages;
}

function countProjections(run: () => void): number {
  const projection = vi.mocked(buildThreadTimelineTurnDetailsFromEvents);
  const before = projection.mock.calls.length;
  run();
  return projection.mock.calls.length - before;
}

function findCommand(
  pages: ReturnType<typeof buildTimelineTurnSummaryDetails>[],
  callId: string,
): TimelineRow | undefined {
  const visit = (rows: readonly TimelineRow[]): TimelineRow | undefined => {
    for (const row of rows) {
      if (
        row.kind === "work" &&
        row.workKind === "command" &&
        row.callId === callId
      )
        return row;
      if (row.kind === "turn" && row.children !== null) {
        const nested = visit(row.children);
        if (nested !== undefined) return nested;
      }
    }
    return undefined;
  };
  for (const page of pages) {
    const found = visit(page.rows);
    if (found !== undefined) return found;
  }
  return undefined;
}

describe("turn summary details paging", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("projects a turn once for all of its pages and for a repeat expand", () => {
    withTestThread((testThread) => {
      const range = seedTurn(testThread);
      const fresh = walkDetails(testThread.coldDb, testThread, range);
      expect(fresh.length).toBeGreaterThan(2);

      let firstPageProjections = 0;
      let laterPageProjections = 0;
      const walked: ReturnType<typeof buildTimelineTurnSummaryDetails>[] = [];
      let beforeCursor: string | undefined;
      do {
        const count = countProjections(() => {
          const page = buildTimelineTurnSummaryDetails(
            testThread.db,
            testThread.thread,
            {
              beforeCursor,
              completedTurnDisplay: "collapse",
              deferContent: true,
              includeDiagnosticOperations: false,
              itemId: null,
              sourceSeqEnd: range.end,
              sourceSeqStart: range.start,
              summarizeShellCommands: false,
              turnId: TURN_ID,
            },
          );
          walked.push(page);
          beforeCursor = page.olderCursor ?? undefined;
        });
        if (walked.length === 1) firstPageProjections = count;
        else laterPageProjections += count;
      } while (beforeCursor !== undefined);

      expect(walked).toEqual(fresh);
      expect(firstPageProjections).toBe(1);
      expect(laterPageProjections).toBe(0);
      expect(
        countProjections(() => {
          expect(walkDetails(testThread.db, testThread, range)).toEqual(fresh);
        }),
      ).toBe(0);
    });
  });

  it("rebuilds after a gap-fill rewrites history below the latest sequence", () => {
    withTestThread((testThread) => {
      const range = seedTurn(testThread);
      const gapSequence = range.start + 2;
      testThread.db.$client
        .prepare("DELETE FROM events WHERE thread_id = ? AND sequence = ?")
        .run(testThread.thread.id, gapSequence);
      expect(
        findCommand(walkDetails(testThread.db, testThread, range), "command-0"),
      ).not.toMatchObject({ status: "completed" });
      const [, completed] = command(0, false);
      insertEvents(testThread.db, noopNotifier, [
        {
          createdAt: 1_800_000_000_000 + gapSequence * 1_000,
          data: JSON.stringify(completed!.data),
          itemId: "command-0",
          itemKind: "commandExecution",
          parentToolCallId: null,
          providerThreadId: PROVIDER_THREAD_ID,
          scope: turnScope(TURN_ID),
          sequence: gapSequence,
          threadId: testThread.thread.id,
          type: "item/completed",
        },
      ]);
      expect(
        getLatestThreadSequence(testThread.db, {
          threadId: testThread.thread.id,
        }),
      ).toBe(range.end);
      const refilled = walkDetails(testThread.db, testThread, range);
      expect(findCommand(refilled, "command-0")).toMatchObject({
        status: "completed",
      });
      expect(refilled).toEqual(
        walkDetails(testThread.coldDb, testThread, range),
      );
    });
  });

  it("drops cached retained-output previews once their retention expires", () => {
    withTestThread((testThread) => {
      const range = seedTurn(testThread);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(RETENTION_EXPIRES_AT - 1_000);
      const before = findCommand(
        walkDetails(testThread.db, testThread, range),
        `command-${COMMAND_COUNT - 1}`,
      );
      expect(before).toMatchObject({
        outputPreview: { experimental_fullOutputAvailability: "detail-limit" },
      });
      vi.setSystemTime(RETENTION_EXPIRES_AT + 1_000);
      const after = findCommand(
        walkDetails(testThread.db, testThread, range),
        `command-${COMMAND_COUNT - 1}`,
      );
      expect(after).toMatchObject({
        outputPreview: {
          experimental_fullOutputAvailability: "retention-expired",
        },
      });
      expect(walkDetails(testThread.db, testThread, range)).toEqual(
        walkDetails(testThread.coldDb, testThread, range),
      );
    });
  });
});
