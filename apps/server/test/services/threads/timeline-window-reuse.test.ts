import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getThread, type DbConnection } from "@bb/db";
import type { Thread } from "@bb/domain";
import {
  isThreadTimelineDelta,
  type ThreadTimelineReadResponse,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import {
  createThreadTimelineWindows,
  type ThreadTimelineWindowRequest,
} from "../../../src/services/threads/thread-timeline-windows.js";
import { reuseUnchangedTimelineWindowParts } from "../../../src/services/threads/timeline-window-reuse.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import {
  appendRows,
  withTestThread,
  type RowSpec,
} from "../../helpers/timeline-cache-fixture.js";

const request: ThreadTimelineWindowRequest = {
  deferContent: true,
  includeNestedRows: false,
  page: { kind: "latest", segmentLimit: 20 },
};

let harness: TestAppHarness;

beforeAll(async () => {
  harness = await createTestAppHarness();
});

afterAll(async () => {
  await harness.cleanup();
});

function command(id: string, output: string): RowSpec[] {
  const item = {
    type: "commandExecution",
    id,
    command: `echo ${id}`,
    cwd: "/repo",
    approvalStatus: null,
  };
  return [
    {
      type: "item/started",
      turnId: "turn-1",
      itemId: id,
      itemKind: "commandExecution",
      data: { item: { ...item, status: "pending" } },
    },
    {
      type: "item/completed",
      turnId: "turn-1",
      itemId: id,
      itemKind: "commandExecution",
      data: {
        item: {
          ...item,
          status: "completed",
          exitCode: 0,
          aggregatedOutput: output,
        },
      },
    },
  ];
}

function full(response: ThreadTimelineReadResponse): ThreadTimelineResponse {
  if (isThreadTimelineDelta(response))
    throw new Error("expected a full window");
  return response;
}

function readLatest(db: DbConnection, threadId: string) {
  const thread = getThread(db, threadId) as Thread;
  return full(
    createThreadTimelineWindows({ ...harness.deps, db }).read(
      thread,
      request,
      undefined,
    ),
  );
}

describe("timeline window reuse", () => {
  it("keeps unchanged rows from the previous window and serializes like a fresh build", () => {
    withTestThread((testThread) => {
      const { coldDb, db, thread } = testThread;
      appendRows(testThread, [
        { type: "turn/started", turnId: "turn-1" },
        ...command("command-1", "one"),
        ...command("command-2", "two"),
      ]);
      const windows = createThreadTimelineWindows({ ...harness.deps, db });
      const read = () =>
        full(
          windows.read(getThread(db, thread.id) as Thread, request, undefined),
        );
      const first = read();
      appendRows(testThread, command("command-3", "three"));
      const second = read();

      expect(second.tag).not.toBe(first.tag);
      expect(JSON.stringify(second)).toBe(
        JSON.stringify(readLatest(coldDb, thread.id)),
      );
      const previousById = new Map(first.rows.map((row) => [row.id, row]));
      const kept = second.rows.filter(
        (row) => previousById.get(row.id) === row,
      );
      expect(kept.map((row) => row.id)).toEqual(
        first.rows
          .filter((row) =>
            second.rows.some(
              (next) =>
                next.id === row.id &&
                JSON.stringify(next) === JSON.stringify(row),
            ),
          )
          .map((row) => row.id),
      );
      expect(kept.length).toBeGreaterThan(0);
    });
  });

  it("reuses a row only when it serializes to the same JSON", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      appendRows(testThread, [
        { type: "turn/started", turnId: "turn-1" },
        ...command("command-1", "one"),
      ]);
      const previous = readLatest(db, thread.id);
      const row = previous.rows.find(
        (candidate): candidate is Extract<TimelineRow, { kind: "work" }> =>
          candidate.kind === "work",
      )!;
      const { id, ...rest } = row;
      const variants: { expected: "reused" | "kept"; row: TimelineRow }[] = [
        { expected: "reused", row: structuredClone(row) },
        { expected: "kept", row: { ...rest, id } },
        { expected: "kept", row: { ...row, startedAt: row.startedAt + 1 } },
      ];
      for (const { expected, row: next } of variants) {
        const reused = reuseUnchangedTimelineWindowParts(
          {
            ...previous,
            rows: previous.rows.map((candidate) =>
              candidate.id === row.id ? next : candidate,
            ),
          },
          previous,
        );
        const result = reused.rows.find((candidate) => candidate.id === row.id);
        expect(result).toBe(expected === "reused" ? row : next);
      }
    });
  });
});
