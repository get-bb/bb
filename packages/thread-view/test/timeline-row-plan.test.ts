import { describe, expect, it } from "vitest";
import type { ThreadEventRow } from "@bb/domain";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
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

describe("timeline row planning", () => {
  it("reads auxiliary plan state without projecting a historical turn", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const headStateEvents = fromRows([
      event.planStepsCompleted({
        seq: 2,
        turnId: "historical-turn",
        itemId: "old-plan",
        steps: [{ step: "Finish the work", status: "active" }],
      }),
    ]);
    const events = [
      event.turnStarted({ seq: 100, turnId: "current-turn" }),
      event.commandCompleted({ turnId: "current-turn", command: "echo done" }),
      event.assistantCompleted({ turnId: "current-turn", text: "Done" }),
      event.turnCompleted({ turnId: "current-turn" }),
    ];
    const current = timeline(events, false);
    const withHeadState = buildThreadTimelineFromEvents({
      acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
      contextWindowEvents: [],
      events: fromRows(events),
      headStateEvents,
      options: { ...options, threadStatus: "active", includeNestedRows: false },
    });
    expect(withHeadState.rows).toEqual(current.rows);
    expect(withHeadState.pendingTodos?.items.map((item) => item.text)).toEqual([
      "Finish the work",
    ]);
  });

  it("keeps collapsed summary metadata consistent with expanded output", () => {
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
    expect(collapsed.rows.map((row) => row.kind)).toEqual([
      "turn",
      "conversation",
    ]);
    const expanded = timeline(events, true);
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

  it("expands exactly the planned summary from a projection with multiple turns", () => {
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
    expect(timeline(events, false).rows).toEqual(
      expanded.rows.map((row) =>
        row.kind === "turn" ? { ...row, children: null } : row,
      ),
    );
    const details = buildThreadTimelineTurnDetailsFromEvents({
      events: fromRows(events),
      options: {
        ...options,
        turnId: "parent",
        sourceSeqStart: expected.sourceSeqStart,
        sourceSeqEnd: expected.sourceSeqEnd,
      },
    });
    expect(details).toEqual({ kind: "matched", rows: expected.children });
  });
});
