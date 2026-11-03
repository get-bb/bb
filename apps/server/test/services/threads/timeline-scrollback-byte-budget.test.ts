import { describe, expect, it } from "vitest";
import {
  mergeLoadedTimelineWithLatest,
  prependOlderTimelineRows,
  resolveLoadedTimelineSurfaceKey,
  type LoadedTimelineState,
} from "@bb/client-core";
import { getThread } from "@bb/db";
import {
  encodeClientTurnRequestIdNumber,
  threadScope,
  turnScope,
  type Thread,
} from "@bb/domain";
import type { TimelinePaginationCursor } from "@bb/server-contract";
import { buildThreadTimelineWithProfile } from "../../../src/services/threads/timeline.js";
import { timelineWindowTag } from "../../../src/services/threads/timeline-window-tag.js";
import { seedEvent, seedThreadFixture } from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const RESPONSE_BYTE_BUDGET = 6_000;

function seedRunningTurn(harness: TestAppHarness, commands: number) {
  const { environment, thread } = seedThreadFixture(harness, {
    thread: { providerId: "codex" },
  });
  let sequence = 0;
  const append = (
    type: Parameters<typeof seedEvent>[1]["type"],
    scope: ReturnType<typeof turnScope> | ReturnType<typeof threadScope>,
    data: Record<string, unknown>,
  ) => {
    sequence += 1;
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "p1",
      scope,
      sequence,
      type,
      data,
    });
  };
  const clientRequestId = encodeClientTurnRequestIdNumber({ value: 1 });
  append("client/turn/requested", threadScope(), {
    direction: "outbound",
    source: "tell",
    initiator: "user",
    request: { method: "turn/start", params: {} },
    requestId: clientRequestId,
    senderThreadId: null,
    input: [{ type: "text", text: "Run the checks", mentions: [] }],
    target: { kind: "thread-start" },
    execution: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      permissionMode: "full",
      source: "client/turn/requested",
    },
  });
  append("turn/started", turnScope("turn-1"), {});
  append("turn/input/accepted", turnScope("turn-1"), { clientRequestId });
  const appendCommand = (index: number) =>
    append("item/completed", turnScope("turn-1"), {
      item: {
        type: "commandExecution",
        id: `command-${index}`,
        command: `check ${index}`,
        cwd: "/tmp",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: `check ${index} passed\n`,
        exitCode: 0,
        durationMs: 1,
      },
    });
  for (let index = 0; index < commands; index += 1) appendCommand(index);
  return { appendCommand, threadId: thread.id };
}

function buildPage(
  harness: TestAppHarness,
  thread: Thread,
  cursor: TimelinePaginationCursor | null,
) {
  const window = buildThreadTimelineWithProfile(harness.db, thread, {
    completedTurnDisplay: "collapse",
    deferContent: true,
    eventBudget: 1_500,
    includeClearedContextHistory: false,
    includeDiagnosticOperations: false,
    maxInlineOutputChars: 32_000,
    maxSeq: 0,
    page:
      cursor === null
        ? { kind: "latest", segmentLimit: 20 }
        : { kind: "older", beforeCursor: cursor, segmentLimit: 20 },
    responseByteBudget: RESPONSE_BYTE_BUDGET,
    compactionOfferEnabled: false,
    summarizeShellCommands: true,
  }).response;
  return { ...window, tag: timelineWindowTag(window) };
}

function scrolledBackState(
  harness: TestAppHarness,
  thread: Thread,
): LoadedTimelineState {
  const latest = buildPage(harness, thread, null);
  let loaded: LoadedTimelineState = {
    historySnapshot: latest.timelinePage.historySnapshot,
    latestWindowEndSequence: latest.maxSeq,
    olderCursor: latest.timelinePage.olderCursor,
    rows: latest.rows,
    surfaceKey: resolveLoadedTimelineSurfaceKey(thread.id, latest),
  };
  const older = buildPage(harness, thread, loaded.olderCursor);
  loaded = {
    ...loaded,
    olderCursor: older.timelinePage.olderCursor,
    rows: prependOlderTimelineRows({
      loadedRows: loaded.rows,
      olderRows: older.rows,
    }),
  };
  return loaded;
}

describe("scrollback inside a running turn cut by the response byte budget", () => {
  it("reports no older-row updates once the window spends the budget", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedRunningTurn(harness, 40);
      const thread = getThread(harness.db, threadId)!;
      const latest = buildPage(harness, thread, null);

      expect(latest.timelinePage.olderCursor).not.toBeNull();
      expect(latest.timelinePage.olderRowUpdates).toBeUndefined();
      expect(latest.timelinePage.olderRowsSourceSeqEnd).not.toBeNull();
      expect(latest.timelinePage.olderRowsSourceSeqEnd!).toBeLessThanOrEqual(
        latest.maxSeq,
      );
    });
  });

  it("keeps the scrolled-back rows of the turn on a refetch with no new events", async () => {
    await withTestHarness(async (harness) => {
      const { threadId } = seedRunningTurn(harness, 40);
      const thread = getThread(harness.db, threadId)!;
      const loaded = scrolledBackState(harness, thread);
      const refetched = buildPage(harness, thread, null);
      expect(refetched.timelinePage.historySnapshot).toBe(
        loaded.historySnapshot,
      );

      const merged = mergeLoadedTimelineWithLatest({
        current: loaded,
        latestTimeline: refetched,
        surfaceKey: loaded.surfaceKey,
      });

      expect(merged.rows).toBe(loaded.rows);
      expect(merged.olderCursor).toEqual(loaded.olderCursor);
    });
  });

  it("keeps the scrolled-back rows of the turn when a new event arrives", async () => {
    await withTestHarness(async (harness) => {
      const { appendCommand, threadId } = seedRunningTurn(harness, 40);
      const thread = getThread(harness.db, threadId)!;
      const loaded = scrolledBackState(harness, thread);
      appendCommand(40);
      const streamed = buildPage(harness, thread, null);
      expect(streamed.timelinePage.historySnapshot).not.toBe(
        loaded.historySnapshot,
      );

      const merged = mergeLoadedTimelineWithLatest({
        current: loaded,
        latestTimeline: streamed,
        surfaceKey: loaded.surfaceKey,
      });

      const streamedIds = new Set(streamed.rows.map((row) => row.id));
      expect(merged.rows.map((row) => row.id)).toEqual([
        ...loaded.rows
          .map((row) => row.id)
          .filter((id) => !streamedIds.has(id)),
        ...streamed.rows.map((row) => row.id),
      ]);
      expect(merged.olderCursor).toEqual(loaded.olderCursor);
    });
  });
});
