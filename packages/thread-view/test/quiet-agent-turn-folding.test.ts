import type { TimelineRow, TimelineTurnRow } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT } from "../src/accepted-client-request-context.js";
import {
  buildThreadTimelineTurnDetailsFromEvents,
  buildTimelineRowTitle,
} from "../src/index.js";
import {
  createTimelineEventFactory,
  decodeThreadEventRow,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

type TimelineFixtureEvent = Parameters<
  typeof renderTimelineFixture
>[0]["events"][number];

type Factory = ReturnType<typeof createTimelineEventFactory>;

function silentCompletion(
  event: Factory,
  turnId: string,
): TimelineFixtureEvent {
  const completed = event.turnCompleted({ turnId });
  return { ...completed, data: { ...completed.data, silent: true } };
}

function command(event: Factory, turnId: string, name: string) {
  return [
    event.commandStarted({ turnId, itemId: `${name}-item`, command: name }),
    event.commandCompleted({
      turnId,
      itemId: `${name}-item`,
      command: name,
      exitCode: 0,
      status: "completed",
    }),
  ];
}

function userTurn(event: Factory, turnId: string, reply: string) {
  const request = event.clientTurnRequested({ text: `ask ${turnId}` });
  return [
    request,
    event.turnStarted({ turnId }),
    event.inputAccepted({ turnId, clientRequestId: request.data.requestId }),
    ...command(event, turnId, `prompted-${turnId}`),
    event.assistantCompleted({
      turnId,
      itemId: `${turnId}-reply`,
      text: reply,
    }),
    event.turnCompleted({ turnId }),
  ];
}

function quietFragment(event: Factory, turnId: string, withFlag = true) {
  return [
    event.turnStarted({ turnId }),
    ...command(event, turnId, `step-${turnId}`),
    withFlag
      ? silentCompletion(event, turnId)
      : event.turnCompleted({ turnId }),
  ];
}

function replyFragment(event: Factory, turnId: string, reply: string) {
  return [
    event.turnStarted({ turnId }),
    ...command(event, turnId, `step-${turnId}`),
    event.assistantCompleted({
      turnId,
      itemId: `${turnId}-reply`,
      text: reply,
    }),
    event.turnCompleted({ turnId }),
  ];
}

function render(
  events: TimelineFixtureEvent[],
  threadStatus: "idle" | "active" = "idle",
) {
  return renderTimelineFixture({
    events,
    projectionOptions: { threadStatus, turnMessageDetail: "summary" },
  });
}

function titleOf(row: TimelineTurnRow): string {
  return buildTimelineRowTitle(
    { ...row, children: null },
    { summaryStyle: "bundle", workStyle: "default" },
  ).plain;
}

function texts(rows: readonly TimelineRow[]): string[] {
  return rows.flatMap((row) =>
    row.kind === "conversation" && row.role === "assistant" ? [row.text] : [],
  );
}

function backgroundRunAfterOnePrompt(withFlags = true): TimelineFixtureEvent[] {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  const quiet = (turnId: string) => quietFragment(event, turnId, withFlags);
  return [
    ...userTurn(event, "t1", "Three helpers are transcribing."),
    ...quiet("t2"),
    ...quiet("t3"),
    ...replyFragment(event, "t4", "The first run lost its results."),
    ...Array.from({ length: 12 }, (_, index) => quiet(`t${index + 5}`)).flat(),
    ...replyFragment(event, "t17", "I've read all 93 screenshots."),
  ];
}

describe("quiet agent-started turns in the timeline", () => {
  it("shows one background run after a prompt as 3 work rows instead of 17", () => {
    const { turnRows, rows } = render(backgroundRunAfterOnePrompt());

    expect(turnRows.map((row) => row.turnId)).toEqual(["t1", "t2", "t5"]);
    expect(turnRows.map((row) => row.quietTurnCount)).toEqual([
      undefined,
      2,
      12,
    ]);
    expect(turnRows.map((row) => row.summaryCount)).toEqual([1, 3, 13]);
    expect(texts(rows)).toEqual([
      "Three helpers are transcribing.",
      "The first run lost its results.",
      "I've read all 93 screenshots.",
    ]);
  });

  it("claims no duration for a row that holds folded fragments", () => {
    const { turnRows } = render(backgroundRunAfterOnePrompt());

    expect(titleOf(turnRows[0]!)).toMatch(/^Worked for /);
    expect(titleOf(turnRows[1]!)).toBe("Worked");
    expect(titleOf(turnRows[2]!)).toBe("Worked");
  });

  it("leaves turns without the silent flag (recorded before it existed) as they were", () => {
    const { turnRows } = render(backgroundRunAfterOnePrompt(false));

    expect(turnRows).toHaveLength(17);
    expect(turnRows.every((row) => row.quietTurnCount === undefined)).toBe(
      true,
    );
  });

  it("keeps trailing quiet fragments as one collapsed Worked row with all their steps", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const { turnRows } = render([
      ...userTurn(event, "t1", "Started."),
      ...quietFragment(event, "t2"),
      ...quietFragment(event, "t3"),
      ...quietFragment(event, "t4"),
    ]);

    expect(turnRows.map((row) => row.turnId)).toEqual(["t1", "t2"]);
    expect(turnRows[1]).toMatchObject({
      quietTurnCount: 3,
      summaryCount: 3,
      status: "completed",
    });
    expect(
      (turnRows[1]!.children ?? []).map((row) =>
        row.kind === "work" && row.workKind === "command" ? row.command : null,
      ),
    ).toEqual(["step-t2", "step-t3", "step-t4"]);
    expect(titleOf(turnRows[1]!)).toBe("Worked");
  });

  it("never folds across a user prompt", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const { turnRows, rows } = render([
      ...userTurn(event, "t1", "Started."),
      ...quietFragment(event, "t2"),
      ...userTurn(event, "t3", "Answering your question."),
    ]);

    expect(turnRows.map((row) => [row.turnId, row.quietTurnCount])).toEqual([
      ["t1", undefined],
      ["t2", 1],
      ["t3", undefined],
    ]);
    expect(texts(rows)).toEqual(["Started.", "Answering your question."]);
  });

  it("does not fold into an agent turn when a user request arrived in between", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const { turnRows } = render([
      ...userTurn(event, "t1", "Started."),
      ...quietFragment(event, "t2"),
      event.clientTurnRequested({ text: "queued while the agent works" }),
      ...replyFragment(event, "t3", "Background result."),
    ]);

    expect(turnRows.map((row) => [row.turnId, row.quietTurnCount])).toEqual([
      ["t1", undefined],
      ["t2", 1],
      ["t3", undefined],
    ]);
  });

  it("does not treat a flagged turn as quiet when it shows agent text", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const { turnRows, rows } = render([
      ...userTurn(event, "t1", "Started."),
      event.turnStarted({ turnId: "t2" }),
      ...command(event, "t2", "step-t2"),
      event.assistantCompleted({
        turnId: "t2",
        itemId: "t2-reply",
        text: "Done.",
      }),
      silentCompletion(event, "t2"),
    ]);

    expect(turnRows.map((row) => row.quietTurnCount)).toEqual([
      undefined,
      undefined,
    ]);
    expect(texts(rows)).toContain("Done.");
  });

  it("does not fold a failed step, a failed turn or an approval", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const failedTurn = (turnId: string): TimelineFixtureEvent => {
      const completed = event.turnCompleted({ turnId, status: "failed" });
      return { ...completed, data: { ...completed.data, silent: true } };
    };
    const { turnRows } = render([
      ...userTurn(event, "t1", "Started."),
      event.turnStarted({ turnId: "t2" }),
      event.commandStarted({ turnId: "t2", itemId: "bad", command: "false" }),
      event.commandCompleted({
        turnId: "t2",
        itemId: "bad",
        command: "false",
        exitCode: 1,
        status: "failed",
      }),
      silentCompletion(event, "t2"),
      event.turnStarted({ turnId: "t3" }),
      ...command(event, "t3", "step-t3"),
      failedTurn("t3"),
      event.turnStarted({ turnId: "t4" }),
      ...command(event, "t4", "step-t4"),
      event.permissionGrantLifecycle({ turnId: "t4", status: "resolved" }),
      silentCompletion(event, "t4"),
    ]);

    expect(turnRows.map((row) => [row.turnId, row.quietTurnCount])).toEqual([
      ["t1", undefined],
      ["t2", undefined],
      ["t3", undefined],
      ["t4", undefined],
    ]);
  });

  it("keeps one row identity while a background run streams in", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const prompt = userTurn(event, "t1", "Started.");
    const first = quietFragment(event, "t2");
    const secondStart = [event.turnStarted({ turnId: "t3" })];
    const secondSteps = command(event, "t3", "step-t3");
    const secondEnd = [silentCompletion(event, "t3")];
    const replyRun = replyFragment(event, "t4", "Background result.");

    const afterFirst = render([...prompt, ...first], "active");
    const whileSecondRuns = render(
      [...prompt, ...first, ...secondStart, ...secondSteps],
      "active",
    );
    const afterSecond = render(
      [...prompt, ...first, ...secondStart, ...secondSteps, ...secondEnd],
      "active",
    );
    const afterReply = render([
      ...prompt,
      ...first,
      ...secondStart,
      ...secondSteps,
      ...secondEnd,
      ...replyRun,
    ]);

    const quietRowId = afterFirst.turnRows[1]!.id;
    expect(afterFirst.turnRows[1]!.quietTurnCount).toBe(1);
    expect(whileSecondRuns.turnRows.map((row) => row.id)).toEqual([
      afterFirst.turnRows[0]!.id,
    ]);
    expect(
      whileSecondRuns.rows.filter(
        (row) => row.kind === "work" && row.turnId === "t2",
      ),
    ).toHaveLength(2);
    expect(afterSecond.turnRows[1]).toMatchObject({
      id: quietRowId,
      quietTurnCount: 2,
    });
    expect(afterReply.turnRows[1]).toMatchObject({
      id: quietRowId,
      quietTurnCount: 2,
    });
    expect(texts(afterReply.rows)).toContain("Background result.");
  });

  it("expands a folded row to every step it holds", () => {
    const events = backgroundRunAfterOnePrompt();
    const folded = render(events).turnRows[2]!;
    const details = buildThreadTimelineTurnDetailsFromEvents({
      events: events.map((row) => decodeThreadEventRow(row)),
      options: {
        completedTurnDisplay: "collapse",
        includeDiagnosticOperations: false,
        sourceSeqStart: folded.sourceSeqStart,
        summarizeShellCommands: true,
        threadName: "",
        threadStatus: "idle",
        turnId: folded.turnId,
        workspaceRoot: null,
      },
    });

    expect(details.kind).toBe("matched");
    const commands =
      details.kind === "matched"
        ? details.rows.filter((row) => row.kind === "work")
        : [];
    expect(commands).toHaveLength(13);
  });
});

void EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT;
