import { describe, expect, it } from "vitest";
import {
  createClaudeDeltaHarness,
  TURN_1,
  TURN_2,
  turnScope,
} from "./delta-test-harness.js";

const THREAD_ID = "informational-thread";
const BLOCK_REASON = "Execution stopped by a configured hook.";

function sdkMessage(message: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    method: "sdk/message",
    params: { threadId: THREAD_ID, message },
  };
}

describe("Claude blocking informational messages", () => {
  it("shows the block reason, fails the turn, and accepts a later prompt", () => {
    const harness = createClaudeDeltaHarness();
    harness.acceptInput("request-1", THREAD_ID);

    const blockingMessage = sdkMessage({
      type: "system",
      subtype: "informational",
      content: BLOCK_REASON,
      level: "warning",
      prevent_continuation: true,
    });
    const events = harness.translate(blockingMessage, {
      threadId: THREAD_ID,
    });
    const trailingResult = harness.translate(
      sdkMessage({
        type: "result",
        subtype: "success",
        is_error: false,
        result: BLOCK_REASON,
        usage: { input_tokens: 12, output_tokens: 3 },
      }),
      { threadId: THREAD_ID },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/error",
        detail: BLOCK_REASON,
        scope: turnScope(TURN_1),
      }),
    );
    expect(trailingResult).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        status: "failed",
        scope: turnScope(TURN_1),
      }),
    );
    expect(events.some((event) => event.type === "provider/unhandled")).toBe(
      false,
    );
    expect(
      trailingResult.some((event) => event.type === "provider/error"),
    ).toBe(false);
    expect(trailingResult).toContainEqual(
      expect.objectContaining({
        type: "thread/tokenUsage/updated",
        tokenUsage: expect.objectContaining({
          last: expect.objectContaining({ inputTokens: 12, outputTokens: 3 }),
        }),
      }),
    );
    expect(harness.translate(blockingMessage, { threadId: THREAD_ID })).toEqual(
      [],
    );
    expect(
      harness.translate(
        sdkMessage({
          type: "assistant",
          message: { content: [{ type: "text", text: "Stale response" }] },
        }),
        { threadId: THREAD_ID },
      ),
    ).toEqual([]);

    const nextTurn = [
      ...harness.acceptInput("request-2", THREAD_ID),
      ...harness.translate(
        sdkMessage({ type: "result", subtype: "success", is_error: false }),
        { threadId: THREAD_ID },
      ),
    ];
    expect(nextTurn).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        status: "completed",
        scope: turnScope(TURN_2),
      }),
    );
  });

  it.each([
    {
      outcome: {
        kind: "blocked_by_hook",
        prompt_kept: false,
        reason: "REPRO: prompt blocked by test hook",
      },
      detail:
        "Prompt blocked by a UserPromptSubmit hook: REPRO: prompt blocked by test hook",
    },
    {
      outcome: { kind: "blocked_by_hook", reason: "  " },
      detail: BLOCK_REASON,
    },
    {
      outcome: { kind: "other_outcome", reason: "Not a hook block" },
      detail: BLOCK_REASON,
    },
  ])(
    "shows the hook reason only for a hook-blocked prompt outcome $outcome",
    ({ outcome, detail }) => {
      const harness = createClaudeDeltaHarness();
      harness.acceptInput("request-1", THREAD_ID);

      const events = harness.translate(
        sdkMessage({
          type: "system",
          subtype: "informational",
          content: BLOCK_REASON,
          level: "warning",
          prevent_continuation: true,
          prompt_submit_outcome: outcome,
        }),
        { threadId: THREAD_ID },
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: "provider/error", detail }),
      );
    },
  );

  it.each([
    { content: BLOCK_REASON },
    { content: BLOCK_REASON, prevent_continuation: false },
    { content: 42, prevent_continuation: true },
    { prevent_continuation: true },
    { content: BLOCK_REASON, prevent_continuation: "true" },
  ])(
    "retains diagnostics for unsupported informational payloads %j",
    (fields) => {
      const harness = createClaudeDeltaHarness();
      harness.acceptInput("request-1", THREAD_ID);

      const events = harness.translate(
        sdkMessage({ type: "system", subtype: "informational", ...fields }),
        { threadId: THREAD_ID },
      );

      expect(events).toContainEqual(
        expect.objectContaining({ type: "provider/unhandled" }),
      );
      expect(events.some((event) => event.type === "turn/completed")).toBe(
        false,
      );
    },
  );
});
