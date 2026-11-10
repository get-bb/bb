import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getThread } from "@bb/db";
import type { Thread } from "@bb/domain";
import {
  isThreadTimelineDelta,
  timelineRowChildren,
  type TimelineRow,
} from "@bb/server-contract";
import { createThreadTimelineWindows } from "../../../src/services/threads/thread-timeline-windows.js";
import { timelineRowsJsonBytes } from "../../../src/services/threads/timeline-content-pagination.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import {
  appendRows,
  withTestThread,
} from "../../helpers/timeline-cache-fixture.js";

let harness: TestAppHarness;

beforeAll(async () => {
  harness = await createTestAppHarness();
});

afterAll(async () => {
  await harness.cleanup();
});

function message(id: string, text: string) {
  return {
    type: "item/completed" as const,
    turnId: "turn-1",
    itemId: id,
    itemKind: "agentMessage" as const,
    data: { item: { type: "agentMessage", id, text } },
  };
}

function command(id: string, output: string) {
  return {
    type: "item/completed" as const,
    turnId: "turn-1",
    itemId: id,
    itemKind: "commandExecution" as const,
    data: {
      item: {
        type: "commandExecution",
        id,
        command: `printf '${output}'`,
        cwd: "/repo",
        approvalStatus: null,
        status: "completed",
        exitCode: 0,
        aggregatedOutput: output,
      },
    },
  };
}

function hasNestedRows(rows: readonly TimelineRow[]): boolean {
  return rows.some((row) => (timelineRowChildren(row)?.length ?? 0) > 0);
}

describe("timeline content pagination byte accounting", () => {
  it("counts nested rows exactly as their serialized UTF-8 bytes", () => {
    withTestThread((testThread) => {
      const { db, thread } = testThread;
      appendRows(testThread, [
        { type: "turn/started", turnId: "turn-1" },
        command("command-1", "naïve — ✓ 日本語 🚀"),
        command("command-2", 'quote " and \\ backslash'),
        message("message-1", "Done ✅"),
        {
          type: "turn/completed",
          turnId: "turn-1",
          data: { status: "completed" },
        },
      ]);
      const response = createThreadTimelineWindows({
        ...harness.deps,
        db,
      }).read(
        { ...(getThread(db, thread.id) as Thread), status: "idle" },
        {
          deferContent: false,
          includeNestedRows: true,
          page: { kind: "latest", segmentLimit: 20 },
        },
        undefined,
      );
      if (isThreadTimelineDelta(response)) throw new Error("expected rows");
      expect(hasNestedRows(response.rows)).toBe(true);
      for (const rows of [[], response.rows, response.rows.slice(0, 1)]) {
        expect(timelineRowsJsonBytes(rows)).toBe(
          Buffer.byteLength(JSON.stringify(rows)),
        );
      }
    });
  });
});
