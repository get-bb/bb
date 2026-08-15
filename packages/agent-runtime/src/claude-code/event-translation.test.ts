import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { turnScope } from "@bb/domain";
import type { ProviderRuntimeEvent } from "../runtime-json-rpc.js";
import { createClaudeEventTranslator } from "./event-translation.js";

/**
 * Rate-limit classification on the bridge-shared translator.
 *
 * The invariants below (#1408, c934ec40a) are pinned only by
 * claude-code/adapter.test.ts today, which is deleted when the legacy adapter
 * graduates. They live in this module, which both paths share, so they are
 * exercised here through the canonical construction the bridge uses
 * (per-session id prefix + synthesized item/started) rather than through the
 * adapter's process-lifetime translator.
 */

const THREAD_ID = "thr_claude_rate_limits";

// Mirrors createCanonicalSessionTranslator in claude-code/bridge/bridge.ts.
function createCanonicalTranslator() {
  const idPrefix = "bt0f1e2d3c-1-";
  return createClaudeEventTranslator({
    providerId: "claude-code",
    turnIdPrefix: idPrefix,
    itemIdPrefix: idPrefix,
    synthesizeItemStarted: true,
  });
}

const FIRST_TURN_ID = "bt0f1e2d3c-1-1";

function sdkMessage(message: Record<string, unknown>): ProviderRuntimeEvent {
  return {
    jsonrpc: "2.0",
    method: "sdk/message",
    params: { threadId: THREAD_ID, message },
  };
}

function providerErrors(events: readonly ThreadEvent[]) {
  return events.filter((event) => event.type === "provider/error");
}

describe("claude rate-limit classification (bridge-shared translator)", () => {
  // An automatic SDK retry is a transient rejection: it must be classified
  // rate-limit AND marked retrying, or the UI reports a dead turn while the
  // SDK is still working, and provider-retry recovery treats it as terminal.
  it("classifies an SDK rate-limit retry as a retrying rate-limit error", () => {
    const translator = createCanonicalTranslator();
    translator.translateClaudeEvent(
      sdkMessage({
        type: "assistant",
        message: { id: "assistant-1", content: [] },
      }),
      { threadId: THREAD_ID },
    );

    const events = translator.translateClaudeEvent(
      sdkMessage({
        type: "system",
        subtype: "api_retry",
        attempt: 2,
        max_retries: 5,
        retry_delay_ms: 1500,
        error_status: 429,
        error: "rate_limit",
      }),
      { threadId: THREAD_ID },
    );

    expect(providerErrors(events)).toEqual([
      expect.objectContaining({
        type: "provider/error",
        scope: turnScope(FIRST_TURN_ID),
        message: "Provider error",
        detail: "Claude Code API retry 2/5 after 1500ms: HTTP 429 rate_limit",
        willRetry: true,
        errorInfo: {
          category: "rate-limit",
          providerCode: "rate_limit",
          httpStatusCode: 429,
        },
      }),
    ]);
  });

  // #1408: Claude reports a hard subscription limit BEFORE its synthetic
  // assistant/result sequence. Emitting an error there and again on the result
  // produced two errors, the first outside the failed turn's range, so
  // recovery never saw the blocked window. The rejection is now deferred onto
  // the result: exactly one terminal error, inside the failed turn.
  it("defers a hard rejection into one terminal rate-limit error on the result", () => {
    const translator = createCanonicalTranslator();

    const rejection = translator.translateClaudeEvent(
      sdkMessage({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          resetsAt: 12_345,
        },
      }),
      { threadId: THREAD_ID },
    );

    expect(rejection.map((event) => event.type)).toEqual([
      "turn/started",
      "provider/rateLimits/updated",
    ]);
    expect(rejection).toContainEqual(
      expect.objectContaining({
        type: "provider/rateLimits/updated",
        rateLimits: expect.objectContaining({
          status: "blocked",
          kind: "subscription-window",
          reachedReason: "five_hour",
          windows: [
            expect.objectContaining({
              providerKey: "five_hour",
              resetsAtMs: 12_345_000,
            }),
          ],
        }),
      }),
    );
    expect(providerErrors(rejection)).toEqual([]);

    const result = translator.translateClaudeEvent(
      sdkMessage({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        api_error_status: 429,
        result:
          "You've hit your session limit · resets 1:50pm (America/Los_Angeles)",
        usage: {},
        modelUsage: {},
      }),
      { threadId: THREAD_ID },
    );

    expect(providerErrors(result)).toEqual([
      expect.objectContaining({
        type: "provider/error",
        scope: turnScope(FIRST_TURN_ID),
        detail: expect.stringContaining("You've hit your session limit"),
        errorInfo: {
          category: "rate-limit",
          providerCode: "error_during_execution",
          httpStatusCode: 429,
        },
      }),
    ]);
    expect(result).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope(FIRST_TURN_ID),
        status: "failed",
      }),
    );
  });

  // A rejection the provider then reverses must not be replayed onto whatever
  // result arrives next: that would classify an unrelated failure (or a clean
  // run that later fails for another reason) as rate-limited and schedule a
  // retry against a window that is no longer blocked.
  it("drops a pending rejection once the provider reports allowed again", () => {
    const translator = createCanonicalTranslator();

    translator.translateClaudeEvent(
      sdkMessage({
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          resetsAt: 12_345,
        },
      }),
      { threadId: THREAD_ID },
    );
    translator.translateClaudeEvent(
      sdkMessage({
        type: "rate_limit_event",
        rate_limit_info: { status: "allowed", rateLimitType: "five_hour" },
      }),
      { threadId: THREAD_ID },
    );

    const result = translator.translateClaudeEvent(
      sdkMessage({
        type: "result",
        subtype: "success",
        is_error: false,
        usage: {},
        modelUsage: {},
      }),
      { threadId: THREAD_ID },
    );

    expect(providerErrors(result)).toEqual([]);
    expect(result).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope(FIRST_TURN_ID),
        status: "completed",
      }),
    );
  });
});
