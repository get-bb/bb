import { describe, expect, it } from "vitest";
import type { ThreadEventRow } from "@bb/domain";
import {
  buildThreadTimelineFromEvents,
  resumeEventProjectionFold,
  startThreadTimelineProjectionFold,
  type ThreadEventWithMeta,
} from "../src/index.js";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import {
  createTimelineEventFactory,
  fromRows,
  renderTimelineFixture,
  workRowsOfKind,
} from "./timeline-test-harness.js";

function commandOutputs(
  events: ThreadEventRow[],
  threadStatus: "active" | "idle",
): string[] {
  const rendered = renderTimelineFixture({
    events,
    projectionOptions: { threadStatus, turnMessageDetail: "full" },
  });
  return workRowsOfKind(rendered.rows, "command").map((row) => row.output);
}

describe("item rows", () => {
  it("shows running command output a line at a time until the turn stops", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const running = [
      event.turnStarted({ turnId: "turn-1" }),
      event.commandStarted({ command: "pnpm test", itemId: "cmd-1" }),
      event.commandOutputDelta({ itemId: "cmd-1", delta: "first line\npart" }),
    ];

    expect(commandOutputs(running, "active")).toEqual(["first line\n"]);
    expect(
      commandOutputs(
        [
          ...running,
          event.commandOutputDelta({ itemId: "cmd-1", delta: "ial" }),
        ],
        "active",
      ),
    ).toEqual(["first line\n"]);
    expect(
      commandOutputs(
        [
          ...running,
          event.systemThreadInterrupted({}),
          event.turnStarted({ turnId: "turn-2" }),
        ],
        "active",
      ),
    ).toEqual(["first line\npart"]);
    expect(commandOutputs(running, "idle")).toEqual(["first line\npart"]);
  });

  it("replaces running command output on a reset", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events = [
      event.turnStarted({ turnId: "turn-1" }),
      event.commandStarted({ command: "watch", itemId: "cmd-1" }),
      event.commandOutputDelta({ itemId: "cmd-1", delta: "before\n" }),
      event.commandOutputDelta({
        itemId: "cmd-1",
        delta: "after\n",
        reset: true,
      }),
      event.commandCompleted({
        command: "watch",
        itemId: "cmd-1",
        exitCode: 0,
      }),
    ];

    expect(commandOutputs(events, "idle")).toEqual(["after\n"]);
  });

  it("adds output that arrives after a command finished to its row", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events = [
      event.turnStarted({ turnId: "turn-1" }),
      event.commandStarted({ command: "make", itemId: "cmd-1" }),
      event.commandCompleted({
        command: "make",
        itemId: "cmd-1",
        aggregatedOutput: "built\n",
        exitCode: 0,
      }),
      event.commandOutputDelta({ itemId: "cmd-1", delta: "late\n" }),
    ];

    expect(commandOutputs(events, "idle")).toEqual(["built\nlate\n"]);
  });

  it("keeps an answer stopped mid-stream as it was streamed", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const rendered = renderTimelineFixture({
      events: [
        event.turnStarted({ turnId: "turn-1" }),
        event.assistantDelta({ itemId: "answer-1", delta: "Half an" }),
        event.systemThreadInterrupted({}),
        event.assistantDelta({ itemId: "answer-1", delta: " answer" }),
        event.assistantCompleted({
          itemId: "answer-1",
          text: "Half an answer",
        }),
      ],
      projectionOptions: { threadStatus: "idle", turnMessageDetail: "full" },
    });

    expect(
      rendered.messages.flatMap((message) =>
        message.kind === "assistant-text" ? [message.text] : [],
      ),
    ).toEqual(["Half an"]);
  });
});

describe("item rows across pushes", () => {
  const options = {
    completedTurnDisplay: "collapse",
    includeDiagnosticOperations: false,
    includeNestedRows: true,
    isLatestPage: true,
    omitSettledDelegationChildRows: false,
    summarizeShellCommands: true,
    threadName: "",
    threadStatus: "active",
    workspaceRoot: null,
  } as const;

  function build(
    events: ThreadEventWithMeta[],
    fold?: ReturnType<typeof startThreadTimelineProjectionFold>,
  ) {
    return buildThreadTimelineFromEvents({
      acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
      contextWindowEvents: [],
      events,
      fold,
      options,
    });
  }

  it("matches a full build after every event through a stop, a subagent and late completions", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const events = fromRows([
      event.turnStarted({ turnId: "turn-1" }),
      event.reasoningStarted({ itemId: "reasoning-1", turnId: "turn-1" }),
      event.reasoningDelta({
        itemId: "reasoning-1",
        delta: "Plan\n",
        turnId: "turn-1",
      }),
      event.delegationStarted({
        itemId: "task-1",
        childRef: "child-1",
        label: "Review",
        turnId: "turn-1",
      }),
      event.turnStarted({ turnId: "child-turn", parentToolCallId: "task-1" }),
      event.assistantDelta({
        itemId: "child-answer",
        delta: "Looks ",
        turnId: "child-turn",
      }),
      event.commandStarted({
        command: "pnpm lint",
        itemId: "cmd-1",
        turnId: "turn-1",
      }),
      event.commandOutputDelta({
        itemId: "cmd-1",
        delta: "checking\nfi",
        turnId: "turn-1",
      }),
      event.assistantDelta({
        itemId: "answer-1",
        delta: "Working on",
        turnId: "turn-1",
      }),
      event.systemThreadInterrupted({}),
      event.assistantDelta({
        itemId: "answer-1",
        delta: " it",
        turnId: "turn-1",
      }),
      event.reasoningCompleted({
        itemId: "reasoning-1",
        text: "Plan",
        turnId: "turn-1",
      }),
      event.commandCompleted({
        command: "pnpm lint",
        itemId: "cmd-1",
        aggregatedOutput: "checking\nfine\n",
        exitCode: 0,
        turnId: "turn-1",
      }),
      event.assistantCompleted({
        itemId: "child-answer",
        text: "Looks good",
        turnId: "child-turn",
      }),
      event.delegationCompleted({
        itemId: "task-1",
        childRef: "child-1",
        label: "Review",
        summary: "Looks good",
        turnId: "turn-1",
      }),
      event.turnCompleted({ status: "interrupted", turnId: "turn-1" }),
    ]);

    const lastTurnStarted = events
      .map((entry) => entry.event.type)
      .lastIndexOf("turn/started");
    const fold = startThreadTimelineProjectionFold({
      acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
      events: events.slice(0, lastTurnStarted + 1),
      options,
    });
    for (let end = lastTurnStarted + 2; end <= events.length; end += 1) {
      expect(resumeEventProjectionFold(fold, events.slice(end - 1, end))).toBe(
        true,
      );
      expect(build(events.slice(0, end), fold), `after ${end} events`).toEqual(
        build(events.slice(0, end)),
      );
    }
  });
});
