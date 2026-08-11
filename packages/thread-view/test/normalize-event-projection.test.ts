import { turnScope } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { normalizeEventProjection } from "../src/normalize-event-projection.js";
import type {
  EventProjection,
  EventProjectionAssistantTextMessage,
  EventProjectionDelegationMessage,
  EventProjectionGeneratedImageMessage,
} from "../src/event-projection-types.js";

const emptyState: EventProjection["state"] = {
  activeThinking: null,
  activeWorkflows: [],
  activeBackgroundCommands: [],
};

function messageBase(id: string, seq: number) {
  return {
    id,
    threadId: "thread-1",
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    createdAt: seq,
    startedAt: seq,
    scope: turnScope("turn-1"),
  };
}

describe("normalizeEventProjection", () => {
  it("keeps a hoisted generated image after earlier standalone output", () => {
    const delegation: EventProjectionDelegationMessage = {
      ...messageBase("delegation-message", 2),
      kind: "delegation",
      toolName: "Agent",
      callId: "delegation-call",
      output: "",
      completedAt: 2,
      status: "completed",
      childProjection: { entries: [], state: emptyState },
    };
    const assistant: EventProjectionAssistantTextMessage = {
      ...messageBase("assistant-message", 3),
      kind: "assistant-text",
      text: "Standalone output",
      status: "completed",
    };
    const image: EventProjectionGeneratedImageMessage = {
      ...messageBase("generated-image-message", 4),
      kind: "generated-image",
      parentToolCallId: "delegation-call",
      itemId: "generated-image-item",
      path: "/tmp/generated-image.png",
    };
    const projection: EventProjection = {
      state: emptyState,
      entries: [delegation, assistant, image].map((message) => ({
        kind: "projected-message" as const,
        message,
      })),
    };

    const normalized = normalizeEventProjection(projection);

    expect(
      normalized.entries.map((entry) =>
        entry.kind === "projected-message"
          ? entry.message.id
          : entry.turn.turnId,
      ),
    ).toEqual([
      "delegation-message",
      "assistant-message",
      "generated-image-message",
    ]);
    const normalizedImage = normalized.entries[2];
    expect(
      normalizedImage?.kind === "projected-message"
        ? normalizedImage.message.parentToolCallId
        : "unexpected turn",
    ).toBeUndefined();
    expect(image.parentToolCallId).toBe("delegation-call");
    const normalizedDelegation = normalized.entries[0];
    expect(
      normalizedDelegation?.kind === "projected-message" &&
        normalizedDelegation.message.kind === "delegation"
        ? normalizedDelegation.message.childProjection.entries
        : "unexpected message",
    ).toEqual([]);
  });
});
