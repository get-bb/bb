import type { ThreadEventRow } from "@bb/domain";
import { turnScope } from "@bb/domain";
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

function answeredUserQuestionEvent(seq: number): ThreadEventRow {
  return {
    id: `evt-user-question-${seq}`,
    threadId: "thread-1",
    seq,
    createdAt: seq,
    scope: turnScope("turn-1"),
    type: "system/userQuestion/lifecycle",
    data: {
      interactionId: "pint_question_1",
      providerId: "claude-code",
      providerRequestId: "request-question-1",
      status: "resolved",
      resolution: {
        kind: "user_answer",
        answers: {
          "question-1": { selected: ["all"] },
        },
      },
      statusReason: null,
      payload: {
        kind: "user_question",
        questions: [
          {
            id: "question-1",
            prompt: "Which changes should I include?",
            shortLabel: "Scope",
            multiSelect: false,
            options: [
              { value: "all", label: "All of them" },
              { value: "none", label: "None" },
            ],
            allowFreeText: false,
          },
        ],
      },
    },
  } as ThreadEventRow;
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
      requestId: "creq_steersteer" as never,
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
        answeredUserQuestionEvent(6),
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
