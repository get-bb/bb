import type { ThreadEventRow } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";
import type { TimelineEventFactory } from "./timeline-test-harness.js";

function topLevelAssistantTexts(
  rows: ReturnType<typeof renderTimelineFixture>["rows"],
): string[] {
  return rows.flatMap((row) =>
    row.kind === "conversation" && row.role === "assistant" ? [row.text] : [],
  );
}

function renderTimeline(
  events: ThreadEventRow[],
  threadStatus: "active" | "idle",
) {
  return renderTimelineFixture({
    events,
    projectionOptions: {
      threadStatus,
      turnMessageDetail: "summary",
    },
  });
}

describe("completed turn user input visibility", () => {
  function buildSteerEvents(event: TimelineEventFactory, completed: boolean) {
    const request = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "Check my router setup",
    });
    const steer = event.clientTurnRequested({
      target: { kind: "steer", expectedTurnId: "turn-1" },
      source: "tell",
      text: "explore but do not apply changes",
    });
    const events: ThreadEventRow[] = [
      request,
      event.turnStarted(),
      event.inputAccepted({ clientRequestId: request.data.requestId }),
      event.assistantCompleted({ itemId: "a1", text: "Starting the audit." }),
      steer,
      event.inputAccepted({ clientRequestId: steer.data.requestId }),
      event.assistantCompleted({
        itemId: "a2",
        text: "Understood - read-only only.",
      }),
      event.commandCompleted({ itemId: "tool-1", command: "ssh router" }),
      event.assistantCompleted({ itemId: "a3", text: "Login works." }),
      event.assistantCompleted({
        itemId: "a4",
        text: "Audit complete. Nothing was changed.",
      }),
      event.assistantCompleted({ itemId: "a5", text: "Final runbook." }),
    ];
    if (completed) {
      events.push(event.turnCompleted());
    }
    return events;
  }

  it("keeps the direct reply and the segment-final message visible after a steered turn completes", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const runningTexts = topLevelAssistantTexts(
      renderTimeline(buildSteerEvents(event, false), "active").rows,
    );
    expect(runningTexts).toContain("Understood - read-only only.");
    expect(runningTexts).toContain("Audit complete. Nothing was changed.");

    const completedEvent = createTimelineEventFactory({ threadId: "thread-1" });
    const completedTexts = topLevelAssistantTexts(
      renderTimeline(buildSteerEvents(completedEvent, true), "idle").rows,
    );
    expect(completedTexts).toContain("Understood - read-only only.");
    expect(completedTexts).toContain("Audit complete. Nothing was changed.");
    expect(completedTexts).toContain("Final runbook.");
    expect(completedTexts).not.toContain("Login works.");
  });

  it("keeps interim messages of an unsteered turn folded after completion", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const request = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "Fix the bug",
    });
    const timeline = renderTimeline(
      [
        request,
        event.turnStarted(),
        event.inputAccepted({ clientRequestId: request.data.requestId }),
        event.assistantCompleted({ itemId: "a1", text: "Looking into it." }),
        event.commandCompleted({ itemId: "tool-1", command: "grep bug" }),
        event.assistantCompleted({ itemId: "a2", text: "Found the cause." }),
        event.assistantCompleted({ itemId: "a3", text: "Fixed and verified." }),
        event.turnCompleted(),
      ],
      "idle",
    );

    expect(topLevelAssistantTexts(timeline.rows)).toEqual([
      "Fixed and verified.",
    ]);
  });

  it("keeps interim messages folded when the turn starts from several grouped input rows", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const request = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "Fix the bug\n\nThen add a regression test",
      input: [
        {
          type: "text",
          text: "Fix the bug\n\nThen add a regression test",
          mentions: [],
        },
      ],
      inputGroups: [
        [{ type: "text", text: "Fix the bug", mentions: [] }],
        [{ type: "text", text: "Then add a regression test", mentions: [] }],
      ],
    });
    const timeline = renderTimeline(
      [
        request,
        event.turnStarted(),
        event.inputAccepted({ clientRequestId: request.data.requestId }),
        event.assistantCompleted({ itemId: "a1", text: "Looking into it." }),
        event.commandCompleted({ itemId: "tool-1", command: "grep bug" }),
        event.assistantCompleted({ itemId: "a2", text: "Found the cause." }),
        event.assistantCompleted({ itemId: "a3", text: "Fixed and verified." }),
        event.turnCompleted(),
      ],
      "idle",
    );

    const userTexts = timeline.rows.flatMap((row) =>
      row.kind === "conversation" && row.role === "user" ? [row.text] : [],
    );
    expect(userTexts).toEqual(["Fix the bug", "Then add a regression test"]);
    expect(topLevelAssistantTexts(timeline.rows)).toEqual([
      "Fixed and verified.",
    ]);
  });

  it("keeps the direct reply after an answered question that is the turn's first output", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const request = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "Audit the router",
    });
    const timeline = renderTimeline(
      [
        request,
        event.turnStarted(),
        event.inputAccepted({ clientRequestId: request.data.requestId }),
        event.userQuestionLifecycle(),
        event.userQuestionLifecycle({
          status: "resolved",
          resolution: {
            kind: "user_answer",
            answers: { "question-1": { selected: ["staging"] } },
          },
        }),
        event.assistantCompleted({ itemId: "a1", text: "Staging it is." }),
        event.commandCompleted({ itemId: "tool-1", command: "ssh router" }),
        event.assistantCompleted({ itemId: "a2", text: "Login works." }),
        event.assistantCompleted({ itemId: "a3", text: "Audit complete." }),
        event.assistantCompleted({ itemId: "a4", text: "Final runbook." }),
        event.turnCompleted(),
      ],
      "idle",
    );

    const texts = topLevelAssistantTexts(timeline.rows);
    expect(texts).toContain("Staging it is.");
    expect(texts).toContain("Audit complete.");
    expect(texts).toContain("Final runbook.");
    expect(texts).not.toContain("Login works.");
  });

  it("keeps interim messages folded around a rejected steer", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const request = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "Check my router setup",
    });
    const steer = event.clientTurnRequested({
      target: { kind: "steer", expectedTurnId: "turn-1" },
      source: "tell",
      text: "explore but do not apply changes",
    });
    const timeline = renderTimeline(
      [
        request,
        event.turnStarted(),
        event.inputAccepted({ clientRequestId: request.data.requestId }),
        event.assistantCompleted({ itemId: "a1", text: "Starting the audit." }),
        steer,
        event.clientTurnRejected({ requestId: steer.data.requestId }),
        event.assistantCompleted({ itemId: "a2", text: "Checking config." }),
        event.commandCompleted({ itemId: "tool-1", command: "ssh router" }),
        event.assistantCompleted({ itemId: "a3", text: "Login works." }),
        event.assistantCompleted({ itemId: "a4", text: "Audit complete." }),
        event.turnCompleted(),
      ],
      "idle",
    );

    const steerRow = timeline.rows.find(
      (row) =>
        row.kind === "conversation" &&
        row.role === "user" &&
        row.text === "explore but do not apply changes",
    );
    expect(steerRow).toMatchObject({
      turnRequest: { kind: "steer", status: "rejected" },
    });
    expect(topLevelAssistantTexts(timeline.rows)).toEqual(["Audit complete."]);
  });

  it("keeps an answered question and the report preceding it visible after the turn completes", () => {
    const event = createTimelineEventFactory({ threadId: "thread-1" });
    const request = event.clientTurnRequested({
      target: { kind: "new-turn" },
      text: "Audit the router",
    });
    const timeline = renderTimeline(
      [
        request,
        event.turnStarted(),
        event.inputAccepted({ clientRequestId: request.data.requestId }),
        event.commandCompleted({ itemId: "tool-1", command: "ssh router" }),
        event.assistantCompleted({
          itemId: "a1",
          text: "Audit complete. Which changes should I include?",
        }),
        event.userQuestionLifecycle(),
        event.userQuestionLifecycle({
          status: "resolved",
          resolution: {
            kind: "user_answer",
            answers: { "question-1": { selected: ["all"] } },
          },
        }),
        event.assistantCompleted({ itemId: "a2", text: "Final runbook." }),
        event.turnCompleted(),
      ],
      "idle",
    );

    const texts = topLevelAssistantTexts(timeline.rows);
    expect(texts).toContain("Audit complete. Which changes should I include?");
    expect(texts).toContain("Final runbook.");
    expect(
      timeline.rows.some(
        (row) => row.kind === "work" && row.workKind === "question",
      ),
    ).toBe(true);
  });
});
