import { describe, expect, it } from "vitest";
import { turnScope, type PromptTextMention } from "@bb/domain";
import {
  createTimelineEventFactory,
  type TimelineEventFactory,
} from "./timeline-test-harness.js";
import { decodeThreadEventRow } from "../src/event-decode.js";
import type { BuildEventProjectionMessagesOptions } from "../src/event-projection-types.js";
import type { AcceptedClientRequest } from "../src/accepted-client-request-context.js";
import {
  parsePromptInput,
  parseAcceptedSteerFromClientRequest,
  parsePendingSteerFromClientRequest,
  parseUserFromClientRequest,
} from "../src/user-message-parsing.js";

type ClientTurnRequestedEventRow = ReturnType<
  TimelineEventFactory["clientTurnRequested"]
>;

interface AcceptedClientRequestFixtureArgs {
  turnId?: string;
}

const AGENT_STEER_TEXT = "Please account for the restart";
const SENDER_THREAD_ID = "thr_sender";

const standardProjectionOptions: BuildEventProjectionMessagesOptions = {
  threadStatus: "active",
};

function agentSteerRequest(): ClientTurnRequestedEventRow {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  return event.clientTurnRequested({
    initiator: "agent",
    senderThreadId: SENDER_THREAD_ID,
    target: { kind: "auto", expectedTurnId: "turn-1" },
    text: AGENT_STEER_TEXT,
  });
}

function systemSteerRequest(): ClientTurnRequestedEventRow {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  return event.clientTurnRequested({
    initiator: "system",
    senderThreadId: null,
    target: { kind: "auto", expectedTurnId: "turn-1" },
    text: "[bb system] Mid-turn nudge",
  });
}

function systemMessageRequest(): ClientTurnRequestedEventRow {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  return event.clientTurnRequested({
    initiator: "system",
    senderThreadId: null,
    target: { kind: "new-turn" },
    text: "[bb system] Maintenance notice.",
  });
}

function userMessageRequest(): ClientTurnRequestedEventRow {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  return event.clientTurnRequested({
    initiator: "user",
    target: { kind: "new-turn" },
    text: "Hello",
  });
}

function userSteerRequest(): ClientTurnRequestedEventRow {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  return event.clientTurnRequested({
    initiator: "user",
    target: { kind: "auto", expectedTurnId: "turn-1" },
    text: "Mid-turn steer",
  });
}

function userSteerRequestWithoutExpectedTurn(): ClientTurnRequestedEventRow {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  return event.clientTurnRequested({
    initiator: "user",
    target: { kind: "steer", expectedTurnId: null },
    text: "Fallback message",
  });
}

function acceptedClientRequest(
  args: AcceptedClientRequestFixtureArgs = {},
): AcceptedClientRequest {
  return {
    meta: {
      id: "event-accepted",
      seq: 2,
      createdAt: 2,
    },
    turnId: args.turnId ?? "turn-1",
  };
}

describe("user message parsing", () => {
  it("omits agent-only prompt input parts from timeline text and attachments", () => {
    const parsed = parsePromptInput([
      {
        type: "text",
        text: "[bb system]\n\nHidden agent-only context:\n\nsecret",
        mentions: [],
        visibility: "agent-only",
      },
      { type: "text", text: "Visible request", mentions: [] },
      {
        type: "localFile",
        path: "/tmp/hidden.md",
        visibility: "agent-only",
      },
      { type: "localFile", path: "/tmp/visible.md" },
    ]);

    expect(parsed).toEqual({
      text: "Visible request",
      mentions: [],
      webImages: 0,
      localImages: 0,
      localFiles: 1,
      imageUrls: [],
      localImagePaths: [],
      localFilePaths: ["/tmp/visible.md"],
    });
  });

  it("hides prompt input rows that only contain agent-only parts", () => {
    const parsed = parsePromptInput([
      {
        type: "text",
        text: "[bb system]\n\nHidden agent-only context was removed.",
        mentions: [],
        visibility: "agent-only",
      },
    ]);

    expect(parsed).toBeNull();
  });

  it("populates initiator, senderThreadId, and turnRequest for user-initiated messages", () => {
    const { event, meta } = decodeThreadEventRow(userMessageRequest());

    const message = parseUserFromClientRequest({
      decoded: event,
      meta,
      options: standardProjectionOptions,
    });

    expect(message).toMatchObject({
      kind: "user",
      initiator: "user",
      senderThreadId: null,
      turnRequest: { kind: "message", status: "pending" },
      text: "Hello",
    });
  });

  it("populates initiator, senderThreadId, and turnRequest for agent-initiated messages", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const agentText = "[bb message from thread:thr_sender]\n\nHi";
    const row = factory.clientTurnRequested({
      initiator: "agent",
      senderThreadId: SENDER_THREAD_ID,
      target: { kind: "new-turn" },
      text: agentText,
    });
    const { event, meta } = decodeThreadEventRow(row);

    const message = parseUserFromClientRequest({
      decoded: event,
      meta,
      options: standardProjectionOptions,
    });

    expect(message).toMatchObject({
      kind: "user",
      initiator: "agent",
      senderThreadId: SENDER_THREAD_ID,
      turnRequest: { kind: "message", status: "pending" },
      // Text passes through unchanged — the renderer mutes the `[bb …]`
      // prefix at display time; the projection never slices.
      text: agentText,
    });
  });

  it("populates initiator for system-initiated messages with a turnRequest", () => {
    const { event, meta } = decodeThreadEventRow(systemMessageRequest());

    const message = parseUserFromClientRequest({
      decoded: event,
      meta,
      options: standardProjectionOptions,
    });

    expect(message).toMatchObject({
      kind: "user",
      initiator: "system",
      senderThreadId: null,
      turnRequest: { kind: "message", status: "pending" },
    });
  });

  it("preserves mentions for system-initiated messages", () => {
    const factory = createTimelineEventFactory({ threadId: "thread-1" });
    const mentionText = "@thread:thr_child";
    const text = `[bb system]\n\n${mentionText} needs help.\nIt is blocked on a pending interaction.\n\nReview the blocker. If you can resolve it from existing context, reply to the thread with guidance. Otherwise, ask the user for the missing decision.`;
    const mentionStart = "[bb system]\n\n".length;
    const mention: PromptTextMention = {
      start: mentionStart,
      end: mentionStart + mentionText.length,
      resource: {
        kind: "thread",
        label: "Backend cleanup",
        projectId: "proj_alpha",
        threadId: "thr_child",
      },
    };
    const row = factory.clientTurnRequested({
      initiator: "system",
      senderThreadId: null,
      target: { kind: "new-turn" },
      text,
      input: [{ type: "text", text, mentions: [mention] }],
    });
    const { event, meta } = decodeThreadEventRow(row);

    const message = parseUserFromClientRequest({
      decoded: event,
      meta,
      options: standardProjectionOptions,
    });

    expect(message).toMatchObject({
      kind: "user",
      initiator: "system",
      senderThreadId: null,
      text,
      turnRequest: { kind: "message", status: "pending" },
    });
    expect(message?.mentions).toEqual([mention]);
  });

  it("treats steers as steer requests regardless of initiator", () => {
    for (const row of [
      userSteerRequest(),
      agentSteerRequest(),
      systemSteerRequest(),
    ]) {
      const { event, meta } = decodeThreadEventRow(row);
      if (event.type !== "client/turn/requested") {
        throw new Error("Expected client/turn/requested event");
      }
      const expectedText = event.input
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      const accepted = acceptedClientRequest();

      expect(
        parsePendingSteerFromClientRequest({
          acceptedClientRequest: undefined,
          decoded: event,
          meta,
          options: standardProjectionOptions,
        }),
      ).toMatchObject({
        kind: "user",
        turnRequest: { kind: "steer", status: "pending" },
        // Pending steers anchor at the request's own meta — there is no
        // accept event yet to route to.
        text: expectedText,
        sourceSeqStart: meta.seq,
      });
      expect(
        parseAcceptedSteerFromClientRequest({
          acceptedClientRequest: accepted,
          decoded: event,
          meta,
          options: standardProjectionOptions,
        }),
      ).toMatchObject({
        kind: "user",
        turnRequest: { kind: "steer", status: "accepted" },
        // Accepted steers anchor at the accept event's seq, not the request's,
        // so they land at the right point in the timeline once accepted.
        text: expectedText,
        sourceSeqStart: accepted.meta.seq,
      });
      // Steers flow through the steer-specific parsers — parseUser short-circuits.
      expect(
        parseUserFromClientRequest({
          decoded: event,
          meta,
          options: standardProjectionOptions,
        }),
      ).toBeNull();
    }
  });

  it("renders a steer accepted by a different turn as a message", () => {
    const { event, meta } = decodeThreadEventRow(userSteerRequest());
    const accepted = acceptedClientRequest({ turnId: "turn-2" });

    expect(
      parseAcceptedSteerFromClientRequest({
        acceptedClientRequest: accepted,
        decoded: event,
        meta,
        options: standardProjectionOptions,
      }),
    ).toBeNull();

    expect(
      parseUserFromClientRequest({
        acceptedClientRequest: accepted,
        decoded: event,
        meta,
        options: standardProjectionOptions,
      }),
    ).toMatchObject({
      kind: "user",
      scope: turnScope("turn-2"),
      sourceSeqStart: meta.seq,
      text: "Mid-turn steer",
      turnRequest: { kind: "message", status: "accepted" },
    });
  });

  it("renders an explicit steer without an expected turn as a message", () => {
    const { event, meta } = decodeThreadEventRow(
      userSteerRequestWithoutExpectedTurn(),
    );

    expect(
      parsePendingSteerFromClientRequest({
        acceptedClientRequest: undefined,
        decoded: event,
        meta,
        options: standardProjectionOptions,
      }),
    ).toBeNull();

    expect(
      parseUserFromClientRequest({
        decoded: event,
        meta,
        options: standardProjectionOptions,
      }),
    ).toMatchObject({
      kind: "user",
      text: "Fallback message",
      turnRequest: { kind: "message", status: "pending" },
    });
  });

  it("renders system-originated turns as user messages", () => {
    const { event, meta } = decodeThreadEventRow(systemMessageRequest());

    expect(
      parseUserFromClientRequest({
        decoded: event,
        meta,
        options: standardProjectionOptions,
      }),
    ).toMatchObject({
      initiator: "system",
      kind: "user",
      text: "[bb system] Maintenance notice.",
      turnRequest: { kind: "message", status: "pending" },
    });
  });
});
