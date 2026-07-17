import { describe, expect, it } from "vitest";
import { extractThreadTimelineModelFallback } from "../src/model-fallback-extraction.js";
import type { ThreadEventWithMeta } from "../src/group-event-projection-turns.js";

function event(
  sequence: number,
  value: ThreadEventWithMeta["event"],
): ThreadEventWithMeta {
  return {
    event: value,
    meta: { id: `event-${sequence}`, seq: sequence, createdAt: sequence * 10 },
  };
}

describe("extractThreadTimelineModelFallback", () => {
  it("returns the latest active fallback", () => {
    expect(
      extractThreadTimelineModelFallback([
        event(2, {
          type: "provider/modelFallback",
          threadId: "thread-1",
          providerThreadId: "session-1",
          scope: { kind: "turn", turnId: "turn-1" },
          originalModel: "claude-fable-5",
          fallbackModel: "claude-opus-4-8",
          reason: "refusal",
          message: "Switched to Opus.",
        }),
      ]),
    ).toEqual({
      sourceSeq: 2,
      detectedAt: 20,
      originalModel: "claude-fable-5",
      fallbackModel: "claude-opus-4-8",
      reason: "refusal",
      message: "Switched to Opus.",
    });
  });

  it("clears the fallback after a later explicit turn request", () => {
    expect(
      extractThreadTimelineModelFallback([
        event(2, {
          type: "provider/modelFallback",
          threadId: "thread-1",
          providerThreadId: "session-1",
          scope: { kind: "turn", turnId: "turn-1" },
          originalModel: "claude-fable-5",
          fallbackModel: "claude-opus-4-8",
          reason: "refusal",
          message: "Switched to Opus.",
        }),
        event(3, {
          type: "client/turn/requested",
          threadId: "thread-1",
          scope: { kind: "thread" },
          direction: "outbound",
          requestId: "req_test0001",
          source: "tell",
          initiator: "user",
          senderThreadId: null,
          input: [{ type: "text", text: "continue", mentions: [] }],
          target: { kind: "new-turn" },
          request: { method: "turn/start", params: {} },
          execution: {
            model: "claude-opus-4-8",
            serviceTier: "default",
            reasoningLevel: "medium",
            permissionMode: "full",
            source: "client/turn/requested",
          },
        }),
      ]),
    ).toBeNull();
  });

  it("recognizes fallback events already persisted as provider/unhandled", () => {
    expect(
      extractThreadTimelineModelFallback([
        event(7, {
          type: "provider/unhandled",
          threadId: "thread-1",
          providerThreadId: "session-1",
          providerId: "claude-code",
          rawType: "sdk/system",
          scope: { kind: "turn", turnId: "turn-1" },
          rawEvent: {
            jsonrpc: "2.0",
            method: "sdk/message",
            params: {
              threadId: "thread-1",
              message: {
                type: "system",
                subtype: "model_refusal_fallback",
                original_model: "claude-fable-5",
                fallback_model: "claude-opus-4-8",
                content: "Switched to Opus after a refusal.",
              },
            },
          },
        }),
      ]),
    ).toEqual({
      sourceSeq: 7,
      detectedAt: 70,
      originalModel: "claude-fable-5",
      fallbackModel: "claude-opus-4-8",
      reason: "refusal",
      message: "Switched to Opus after a refusal.",
    });
  });
});
