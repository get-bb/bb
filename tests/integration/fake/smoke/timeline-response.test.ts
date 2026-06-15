import { describe, expect, it } from "vitest";
import type {
  ThreadTimelineFeedResponse,
  TimelineFeedRow,
} from "@bb/server-contract";
import {
  formatTimelineRowKindsForDiagnostics,
  timelineHasAssistantConversation,
} from "../../helpers/timeline-response.js";

const ASSISTANT_ROW = {
  kind: "conversation",
  key: "row_assistant",
  turnId: "turn_test",
  source: { start: 1, end: 1 },
  startedAt: 1,
  createdAt: 1,
  detail: null,
  role: "assistant",
  textPreview: { text: "Done", fullLength: 4, complete: true },
  attachments: null,
  turnRequest: null,
} satisfies TimelineFeedRow;

const USER_ROW = {
  kind: "conversation",
  key: "row_user",
  turnId: "turn_test",
  source: { start: 2, end: 2 },
  startedAt: 2,
  createdAt: 2,
  detail: null,
  role: "user",
  textPreview: { text: "Hello", fullLength: 5, complete: true },
  mentions: [],
  attachments: null,
  initiator: "user",
  senderThreadId: null,
  turnRequest: { kind: "message", status: "accepted" },
} satisfies TimelineFeedRow;

function makeTimelineResponse(
  rows: ThreadTimelineFeedResponse["rows"],
): ThreadTimelineFeedResponse {
  return {
    threadId: "thr_test",
    rows,
    activeThinking: null,
    pendingTodos: null,
    timelinePage: {
      kind: "latest",
      segmentLimit: 20,
      returnedSegmentCount: rows.length > 0 ? 1 : 0,
      hasOlderRows: false,
      olderCursor: null,
    },
  };
}

describe("timeline response helpers", () => {
  it("finds assistant conversation rows nested inside turn rows", () => {
    const timeline = makeTimelineResponse([
      {
        kind: "turn",
        key: "row_turn",
        turnId: "turn_test",
        source: { start: 1, end: 1 },
        startedAt: 1,
        createdAt: 1,
        detail: null,
        status: "completed",
        summaryCount: 1,
        completedAt: null,
        children: [ASSISTANT_ROW],
      },
    ]);

    expect(timelineHasAssistantConversation(timeline)).toBe(true);
    expect(formatTimelineRowKindsForDiagnostics(timeline)).toBe(
      "turn, conversation:assistant",
    );
  });

  it("finds assistant conversation rows nested inside delegations", () => {
    const timeline = makeTimelineResponse([
      {
        kind: "work",
        key: "row_delegation",
        turnId: "turn_test",
        source: { start: 1, end: 1 },
        startedAt: 1,
        createdAt: 1,
        detail: null,
        status: "completed",
        workKind: "delegation",
        callId: "call_test",
        toolName: "spawnAgent",
        subagentType: null,
        description: null,
        outputPreview: { text: "", fullLength: 0, complete: true },
        completedAt: null,
        childCount: 1,
        childRows: [ASSISTANT_ROW],
      },
    ]);

    expect(timelineHasAssistantConversation(timeline)).toBe(true);
    expect(formatTimelineRowKindsForDiagnostics(timeline)).toBe(
      "work:delegation, conversation:assistant",
    );
  });

  it("does not treat user conversation rows as assistant output", () => {
    const timeline = makeTimelineResponse([USER_ROW]);

    expect(timelineHasAssistantConversation(timeline)).toBe(false);
    expect(formatTimelineRowKindsForDiagnostics(timeline)).toBe(
      "conversation:user",
    );
  });
});
