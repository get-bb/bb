import { describe, expect, it } from "vitest";
import { extractThreadTimelineProviderAuthRequired } from "../src/provider-auth-extraction.js";
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

function providerError(
  category: "unauthorized" | "rate-limit",
  options: { willRetry?: boolean } = {},
): ThreadEventWithMeta["event"] {
  return {
    type: "provider/error",
    threadId: "thread-1",
    providerThreadId: "session-1",
    scope: { kind: "turn", turnId: "turn-1" },
    message: "Provider error",
    detail: "Failed to authenticate: OAuth session expired",
    ...(options.willRetry === undefined
      ? {}
      : { willRetry: options.willRetry }),
    errorInfo: {
      category,
      providerCode: "authentication_failed",
      httpStatusCode: null,
    },
  };
}

function turnRequested(): ThreadEventWithMeta["event"] {
  return {
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
  };
}

describe("extractThreadTimelineProviderAuthRequired", () => {
  it("reports the sequence of a terminal unauthorized provider error", () => {
    expect(
      extractThreadTimelineProviderAuthRequired([
        event(4, providerError("unauthorized")),
      ]),
    ).toEqual({ sourceSeq: 4 });
  });

  it("ignores provider errors of other categories", () => {
    expect(
      extractThreadTimelineProviderAuthRequired([
        event(4, providerError("rate-limit")),
      ]),
    ).toBeNull();
  });

  it("ignores an unauthorized error the provider will retry", () => {
    expect(
      extractThreadTimelineProviderAuthRequired([
        event(4, providerError("unauthorized", { willRetry: true })),
      ]),
    ).toBeNull();
  });

  it("clears once the user starts another turn", () => {
    expect(
      extractThreadTimelineProviderAuthRequired([
        event(4, providerError("unauthorized")),
        event(5, turnRequested()),
      ]),
    ).toBeNull();
  });

  it("reports again when the retried turn fails the same way", () => {
    expect(
      extractThreadTimelineProviderAuthRequired([
        event(4, providerError("unauthorized")),
        event(5, turnRequested()),
        event(6, providerError("unauthorized")),
      ]),
    ).toEqual({ sourceSeq: 6 });
  });
});
