import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadEventRow } from "@bb/domain";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import { ExecutionOutput } from "../src/execution-output.js";
import {
  buildThreadTimelineFromEvents,
  buildThreadTimelineTurnDetailsFromEvents,
} from "../src/build-thread-timeline.js";
import {
  createTimelineEventFactory,
  fromRows,
} from "./timeline-test-harness.js";

const options = {
  completedTurnDisplay: "collapse",
  includeDiagnosticOperations: false,
  isLatestPage: true,
  threadStatus: "idle",
  threadName: "",
  workspaceRoot: null,
} as const;

function timeline(events: ThreadEventRow[], includeNestedRows: boolean) {
  return buildThreadTimelineFromEvents({
    acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [],
    events: fromRows(events),
    options: {
      ...options,
      includeNestedRows,
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe("timeline materialization", () => {
  it("does not reconstruct hidden tool output as a completed turn grows", () => {
    const read = vi.spyOn(ExecutionOutput.prototype, "read");
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events = [
      event.turnStarted(),
      event.commandStarted({ itemId: "command", command: "build" }),
      ...Array.from({ length: 10_000 }, () =>
        event.commandOutputDelta({
          itemId: "command",
          delta: "build output\n",
        }),
      ),
      event.commandCompleted({ itemId: "command", command: "build" }),
      event.assistantCompleted({ text: "Done" }),
      event.turnCompleted(),
    ];
    const collapsed = timeline(events, false);
    expect(read).not.toHaveBeenCalled();
    expect(collapsed.rows.map((row) => row.kind)).toEqual([
      "turn",
      "conversation",
    ]);
    const expanded = timeline(events, true);
    expect(read).toHaveBeenCalledTimes(1);
    expect(
      expanded.rows.map((row) =>
        row.kind === "turn" ? { ...row, children: null } : row,
      ),
    ).toEqual(collapsed.rows);
    const summary = expanded.rows[0];
    expect(summary?.kind === "turn" && summary.children?.[0]).toMatchObject({
      output: "build output\n".repeat(10_000),
    });
  });

  it("expands exactly the planned summary without reconstructing other turns", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events = [
      event.turnStarted({ turnId: "parent" }),
      event.delegationStarted({
        turnId: "parent",
        itemId: "delegate",
        childRef: "child-provider",
        label: "Review",
      }),
      event.turnStarted({ turnId: "child", parentToolCallId: "delegate" }),
      event.commandCompleted({
        turnId: "child",
        parentToolCallId: "delegate",
        itemId: "nested-command",
        command: "test",
        aggregatedOutput: "Passed",
      }),
      event.turnCompleted({ turnId: "child" }),
      event.delegationCompleted({
        turnId: "parent",
        itemId: "delegate",
        childRef: "child-provider",
        label: "Review",
        summary: "Reviewed",
      }),
      event.assistantCompleted({ turnId: "parent", text: "Ready" }),
      event.turnCompleted({ turnId: "parent" }),
      event.turnStarted({ turnId: "unrelated" }),
      event.commandCompleted({
        turnId: "unrelated",
        itemId: "other-command",
        command: "other",
        aggregatedOutput: "Other output",
      }),
      event.assistantCompleted({
        turnId: "unrelated",
        itemId: "other-answer",
        text: "Other answer",
      }),
      event.turnCompleted({ turnId: "unrelated" }),
    ];
    const expanded = timeline(events, true);
    const expected = expanded.rows.find(
      (row) => row.kind === "turn" && row.turnId === "parent",
    );
    if (expected?.kind !== "turn") throw new Error("Missing parent summary");
    const read = vi.spyOn(ExecutionOutput.prototype, "read");
    expect(timeline(events, false).rows).toEqual(
      expanded.rows.map((row) =>
        row.kind === "turn" ? { ...row, children: null } : row,
      ),
    );
    expect(read).not.toHaveBeenCalled();
    const details = buildThreadTimelineTurnDetailsFromEvents({
      events: fromRows(events),
      options: {
        ...options,
        sourceSeqStart: expected.sourceSeqStart,
        sourceSeqEnd: expected.sourceSeqEnd,
      },
    });
    expect(details).toEqual({ kind: "matched", rows: expected.children });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
