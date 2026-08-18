import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { threadScope, turnScope } from "@bb/domain";
import { queueAcceptedUserMessage } from "@bb/provider-bridge-protocol/bridge-kit";
import type { ProviderRuntimeEvent } from "@bb/provider-bridge-protocol/bridge-kit";
import { createClaudeEventTranslator } from "./event-translation.js";

/**
 * Event-translation invariants for the Claude Code provider.
 *
 * Most of the cases below were pinned only by claude-code/adapter.test.ts,
 * which was deleted when the legacy adapter graduated. The adapter's
 * `translateEvent` was a pass-through to this module's
 * `translateClaudeEvent`, and this module is also the canonical bridge's
 * translation surface — that shared ownership is why these invariants outlive
 * the adapter suite and are re-homed here, exercised through the canonical
 * translator construction.
 *
 * Rate-limit classification (#1408, c934ec40a) uses the bridge's exact
 * construction (per-session id prefix); the moved cases use fixed readable
 * prefixes so their original ids ("turn-1", "claude-assistant-1") survive the
 * move. Both constructions set `synthesizeItemStarted`, the canonical grammar:
 * a delta-first assistant/reasoning item emits an `item/started` before its
 * first delta, which the legacy adapter shape omitted.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "./__fixtures__");

function isFixtureObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function loadFixture(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    readFileSync(resolve(FIXTURES, name), "utf8"),
  );
  if (!isFixtureObject(parsed)) {
    throw new Error(`Fixture ${name} did not contain an object`);
  }
  return parsed;
}

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

// The canonical bridge injects per-session entropy into these prefixes
// (#1224); the fixed prefixes below reproduce the legacy id scheme so the
// invariants moved off the deleted adapter suite keep their original readable
// ids ("turn-1", "claude-assistant-1", "claude-compaction-turn-1").
function createTranslator() {
  return createClaudeEventTranslator({
    providerId: "claude-code",
    turnIdPrefix: "turn-",
    itemIdPrefix: "claude-",
    synthesizeItemStarted: true,
  });
}

describe("claude turn and checkpoint lifecycle", () => {
  it("emits turn/started + item/completed for assistant message", () => {
    const { translateClaudeEvent } = createTranslator();
    const events = translateClaudeEvent({
      type: "assistant",
      message: {
        id: "msg-1",
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("turn-1"),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          id: "msg-1",
          text: "Hello world",
        }),
      }),
    );
  });

  it("records the latest Claude assistant message as the turn checkpoint", () => {
    const { translateClaudeEvent } = createTranslator();
    translateClaudeEvent({
      type: "assistant",
      uuid: "assistant-message-42",
      message: {
        id: "msg-1",
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
      },
      session_id: "sess-1",
    });

    const events = translateClaudeEvent({
      type: "result",
      subtype: "success",
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        status: "completed",
        providerCheckpointId: "assistant-message-42",
      }),
    );
  });

  it("does not replace the root checkpoint with a sidechain assistant UUID", () => {
    const { translateClaudeEvent } = createTranslator();
    translateClaudeEvent(
      {
        type: "assistant",
        uuid: "root-assistant-message",
        message: {
          id: "root-message",
          role: "assistant",
          content: [{ type: "text", text: "Root response" }],
        },
        session_id: "sess-1",
      },
      { threadId: "bb-thread-1" },
    );
    translateClaudeEvent(
      {
        type: "assistant",
        uuid: "sidechain-assistant-message",
        message: {
          id: "sidechain-message",
          role: "assistant",
          content: [{ type: "text", text: "Subagent response" }],
        },
        session_id: "sess-1",
      },
      { threadId: "bb-thread-1", parentToolCallId: "tool-subagent" },
    );

    const events = translateClaudeEvent(
      {
        type: "result",
        subtype: "success",
        session_id: "sess-1",
      },
      { threadId: "bb-thread-1" },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        providerCheckpointId: "root-assistant-message",
      }),
    );
  });

  it("keeps assistant message ids distinct within one turn", () => {
    const { translateClaudeEvent } = createTranslator();

    const firstEvents = translateClaudeEvent({
      type: "assistant",
      message: {
        id: "msg-1",
        role: "assistant",
        content: [{ type: "text", text: "Now let me read the main files:" }],
      },
      session_id: "sess-1",
    });

    const secondEvents = translateClaudeEvent({
      type: "assistant",
      message: {
        id: "msg-2",
        role: "assistant",
        content: [{ type: "text", text: "Now let me read the test file:" }],
      },
      session_id: "sess-1",
    });

    expect(firstEvents).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          id: "msg-1",
          text: "Now let me read the main files:",
        }),
      }),
    );
    expect(secondEvents).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          id: "msg-2",
          text: "Now let me read the test file:",
        }),
      }),
    );
  });

  it("increments turn IDs across turns", () => {
    const { translateClaudeEvent } = createTranslator();

    // Turn 1
    translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "first" }],
      },
      session_id: "sess-1",
    });
    translateClaudeEvent({
      type: "result",
      subtype: "end_turn",
      session_id: "sess-1",
    });

    // Turn 2
    const events = translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "second" }],
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("turn-2"),
      }),
    );
  });

  it("emits turn/completed on result message", () => {
    const { translateClaudeEvent } = createTranslator();
    // Start a turn
    translateClaudeEvent({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "done" }] },
      session_id: "sess-1",
    });

    const events = translateClaudeEvent({
      type: "result",
      subtype: "end_turn",
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    );
  });

  it("emits failed status for error result", () => {
    const { translateClaudeEvent } = createTranslator();
    // Start a turn
    translateClaudeEvent({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "x" }] },
      session_id: "sess-1",
    });

    const events = translateClaudeEvent({
      type: "result",
      subtype: "error",
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        status: "failed",
      }),
    );
  });

  it("does not open a provider-only turn while a failed turn's subagent drains", () => {
    const { translateClaudeEvent, turnState } = createTranslator();
    const context = { threadId: "bb-thread-rate-limited" };
    const state = turnState.getOrCreate({ threadId: context.threadId });
    queueAcceptedUserMessage({
      clientRequestId: "creq_23456789af",
      state,
    });
    translateClaudeEvent(loadFixture("task-started-subagent.json"), context);
    translateClaudeEvent(
      {
        type: "rate_limit_event",
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          resetsAt: 12345,
        },
        session_id: "claude-session-1",
      },
      context,
    );

    const failed = translateClaudeEvent(
      {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        api_error_status: 429,
        result: "You've hit your session limit",
        usage: {},
        modelUsage: {},
        session_id: "claude-session-1",
      },
      context,
    );
    expect(failed).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "failed",
      }),
    );

    const taskCompleted = translateClaudeEvent(
      loadFixture("task-notification-subagent.json"),
      context,
    );
    expect(taskCompleted).toContainEqual(
      expect.objectContaining({ type: "item/backgroundTask/completed" }),
    );
    expect(
      translateClaudeEvent(
        {
          type: "assistant",
          message: {
            id: "late-subagent-message",
            role: "assistant",
            content: [{ type: "text", text: "Late subagent output" }],
          },
          session_id: "claude-session-1",
        },
        {
          ...context,
          parentToolCallId: "toolu_01W1cLr7AsTRvbya9LM5LSAV",
        },
      ),
    ).toEqual([]);

    state.suppressUnacceptedTurnStart = false;
    queueAcceptedUserMessage({
      clientRequestId: "creq_23456789ad",
      state,
    });
    expect(
      translateClaudeEvent(
        {
          type: "assistant",
          message: {
            id: "follow-up-message",
            role: "assistant",
            content: [{ type: "text", text: "Working again" }],
          },
          session_id: "claude-session-1",
        },
        context,
      ),
    ).toEqual([
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("turn-2"),
      }),
      expect.objectContaining({
        type: "turn/input/accepted",
        clientRequestId: "creq_23456789ad",
      }),
      expect.objectContaining({
        type: "item/completed",
        scope: turnScope("turn-2"),
      }),
    ]);
  });

  it("does not open a provider-only turn for a bridge error after terminal failure", () => {
    const { translateClaudeEvent, turnState } = createTranslator();
    const context = { threadId: "bb-thread-bridge-error-drain" };
    queueAcceptedUserMessage({
      clientRequestId: "creq_23456789bg",
      state: turnState.getOrCreate({ threadId: context.threadId }),
    });
    translateClaudeEvent(
      {
        type: "assistant",
        message: {
          id: "assistant-before-failure",
          role: "assistant",
          content: [{ type: "text", text: "Working" }],
        },
        session_id: "claude-session-1",
      },
      context,
    );
    expect(
      translateClaudeEvent(
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          result: "Usage limit reached",
          usage: {},
          modelUsage: {},
          session_id: "claude-session-1",
        },
        context,
      ),
    ).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "failed",
      }),
    );

    expect(
      translateClaudeEvent(
        {
          jsonrpc: "2.0",
          method: "error",
          params: { message: "Late SDK stream failure" },
        },
        context,
      ),
    ).toEqual([]);
  });
});

describe("claude synthetic no-response handling", () => {
  it("completes a pending turn for Claude synthetic no-response messages", () => {
    const { translateClaudeEvent, turnState } = createTranslator();
    // The adapter queued this from an accepted turn/start command; the pending
    // accepted message is translator state, so queue it directly.
    queueAcceptedUserMessage({
      clientRequestId: "creq_23456789af",
      state: turnState.getOrCreate({ threadId: "bb-thread-1" }),
    });

    const events = translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "No response requested." }],
          model: "<synthetic>",
          stop_reason: "stop_sequence",
          stop_sequence: "",
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
          },
        },
        session_id: "claude-session-1",
      },
      { threadId: "bb-thread-1" },
    );

    expect(events).toEqual([
      {
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
      },
      {
        type: "turn/input/accepted",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        clientRequestId: "creq_23456789af",
      },
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "completed",
      },
    ]);
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          text: "No response requested.",
        }),
      }),
    );
  });

  it("maps a conversation reset and settles its zero-work turn", () => {
    const { translateClaudeEvent, turnState } = createTranslator();
    queueAcceptedUserMessage({
      clientRequestId: "creq_23456789af",
      state: turnState.getOrCreate({ threadId: "bb-thread-1" }),
    });

    // The CLI resolves /clear locally: conversation_reset is the successful
    // context-clear signal, followed by a result with no model call.
    const resetEvents = translateClaudeEvent(
      {
        type: "conversation_reset",
        session_id: "claude-session-1",
      },
      { threadId: "bb-thread-1" },
    );

    expect(resetEvents.map((event) => event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "thread/context/cleared",
    ]);
    expect(resetEvents).toContainEqual({
      type: "thread/context/cleared",
      threadId: "",
      providerThreadId: "",
      scope: turnScope("turn-1"),
    });

    const resultEvents = translateClaudeEvent(
      {
        type: "result",
        subtype: "success",
        is_error: false,
        num_turns: 0,
        result: "",
        session_id: "claude-session-1",
      },
      { threadId: "bb-thread-1" },
    );

    expect(resultEvents.map((event) => event.type)).toEqual(["turn/completed"]);
    expect(resultEvents).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    );
  });

  it("ignores a trailing result once the turn has closed", () => {
    const { translateClaudeEvent, turnState } = createTranslator();
    queueAcceptedUserMessage({
      clientRequestId: "creq_23456789af",
      state: turnState.getOrCreate({ threadId: "bb-thread-1" }),
    });
    translateClaudeEvent(
      {
        type: "assistant",
        message: {
          id: "msg-1",
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
        },
        session_id: "claude-session-1",
      },
      { threadId: "bb-thread-1" },
    );

    // A stop finishes the open turn before the CLI's result lands, so a result
    // with no open turn is routine. It must not open a second, empty turn.
    const state = turnState.getOrCreate({ threadId: "bb-thread-1" });
    if (state.currentTurnId) {
      turnState.finishTurn({ state, threadId: "bb-thread-1" });
    }

    expect(
      translateClaudeEvent(
        { type: "result", subtype: "success", session_id: "claude-session-1" },
        { threadId: "bb-thread-1" },
      ),
    ).toEqual([]);
  });

  it("completes a pending turn for wrapped Claude synthetic no-response messages", () => {
    const { translateClaudeEvent, turnState } = createTranslator();
    queueAcceptedUserMessage({
      clientRequestId: "creq_23456789af",
      state: turnState.getOrCreate({ threadId: "bb-thread-1" }),
    });

    const events = translateClaudeEvent(
      {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "bb-thread-1",
          message: {
            type: "assistant",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "No response requested." }],
              model: "<synthetic>",
              stop_reason: "stop_sequence",
              stop_sequence: "",
              usage: {
                input_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                output_tokens: 0,
              },
            },
            session_id: "claude-session-1",
          },
        },
      },
      { threadId: "bb-thread-1" },
    );

    expect(events).toEqual([
      {
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
      },
      {
        type: "turn/input/accepted",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        clientRequestId: "creq_23456789af",
      },
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "completed",
      },
    ]);
  });

  it("does not treat Claude synthetic assistant errors as no-response messages", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent(
      {
        type: "assistant",
        error: "rate_limit",
        isApiErrorMessage: true,
        apiErrorStatus: 429,
        message: {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "API Error: Server is temporarily limiting requests.",
            },
          ],
          model: "<synthetic>",
          stop_reason: "stop_sequence",
          stop_sequence: "",
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
          },
        },
        session_id: "claude-session-1",
      },
      { threadId: "bb-thread-1" },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          text: "API Error: Server is temporarily limiting requests.",
        }),
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
      }),
    );
  });

  it("completes an open turn for Claude synthetic no-response messages", () => {
    const { translateClaudeEvent } = createTranslator();

    translateClaudeEvent(
      {
        type: "stream_event",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Starting" },
        },
        session_id: "claude-session-1",
      },
      { threadId: "bb-thread-1" },
    );

    const events = translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "No response requested." }],
          model: "<synthetic>",
          stop_reason: "stop_sequence",
          stop_sequence: "",
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
          },
        },
        session_id: "claude-session-1",
      },
      { threadId: "bb-thread-1" },
    );

    expect(events).toEqual([
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "completed",
      },
    ]);
  });

  it("keeps an open turn for synthetic no-response messages while an agent is running", () => {
    const { translateClaudeEvent } = createTranslator();
    const context = { threadId: "bb-thread-1" };
    translateClaudeEvent(loadFixture("task-started-subagent.json"), context);

    const events = translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "No response requested." }],
          model: "<synthetic>",
          stop_reason: "stop_sequence",
          stop_sequence: "",
          usage: {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
          },
        },
        session_id: "claude-session-1",
      },
      context,
    );

    expect(events).toEqual([]);
    translateClaudeEvent(
      loadFixture("task-notification-subagent.json"),
      context,
    );
    const finalEvents = translateClaudeEvent(
      {
        type: "result",
        subtype: "end_turn",
        session_id: "claude-session-1",
      },
      context,
    );
    expect(finalEvents).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    );
  });
});

describe("claude streaming", () => {
  it("emits item/agentMessage/delta for stream text", () => {
    const { translateClaudeEvent } = createTranslator();
    // Start a turn first
    translateClaudeEvent({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "x" }] },
      session_id: "sess-1",
    });

    const events = translateClaudeEvent({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "streaming..." },
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/agentMessage/delta",
        itemId: expect.stringMatching(/^claude-assistant-/),
        delta: "streaming...",
      }),
    );
  });

  it("reuses the streamed assistant item id when the final assistant arrives", () => {
    const { translateClaudeEvent } = createTranslator();

    const deltaEvents = translateClaudeEvent({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "PONG" },
      },
      session_id: "sess-1",
    });
    const deltaEvent = deltaEvents.find(
      (
        event,
      ): event is Extract<
        (typeof deltaEvents)[number],
        { type: "item/agentMessage/delta" }
      > => event.type === "item/agentMessage/delta",
    );

    const assistantEvents = translateClaudeEvent({
      type: "assistant",
      message: {
        id: "provider-msg-1",
        role: "assistant",
        content: [{ type: "text", text: "PONG" }],
      },
      session_id: "sess-1",
    });

    expect(deltaEvent?.itemId).toMatch(/^claude-assistant-/);
    expect(assistantEvents).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          id: deltaEvent?.itemId,
          text: "PONG",
        }),
      }),
    );
  });

  it("starts a turn when stream text arrives before the assistant envelope", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "PONG" },
      },
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("turn-1"),
      }),
    );
    // Canonical grammar: the delta-first item opens with a synthesized
    // item/started, which the legacy adapter shape omitted.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        scope: turnScope("turn-1"),
        item: expect.objectContaining({
          type: "agentMessage",
          id: expect.stringMatching(/^claude-assistant-/),
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/agentMessage/delta",
        itemId: expect.stringMatching(/^claude-assistant-/),
        scope: turnScope("turn-1"),
        delta: "PONG",
      }),
    );
  });

  it("streams thinking and finalizes it on the assistant message", () => {
    const { translateClaudeEvent } = createTranslator();

    const deltaEvents = translateClaudeEvent({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "thinking_delta",
          thinking: "Let me inspect this first.",
        },
      },
      session_id: "sess-1",
    });
    const reasoningDelta = deltaEvents.find(
      (
        event,
      ): event is Extract<
        (typeof deltaEvents)[number],
        { type: "item/reasoning/textDelta" }
      > => event.type === "item/reasoning/textDelta",
    );

    const assistantEvents = translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "Let me inspect this first.",
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(reasoningDelta?.itemId).toMatch(/^claude-reasoning-/);
    // Canonical grammar: the delta-first reasoning item opens with a
    // synthesized item/started ahead of its first delta.
    expect(deltaEvents).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "reasoning",
          id: reasoningDelta?.itemId,
        }),
      }),
    );
    expect(assistantEvents).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "reasoning",
          id: reasoningDelta?.itemId,
          content: ["Let me inspect this first."],
        }),
      }),
    );
  });
});

describe("claude unhandled and ignored events", () => {
  it("falls back to provider/unhandled for unknown sdk envelopes", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "bb-thread-1",
        message: {
          type: "custom_event",
        },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        threadId: "bb-thread-1",
        providerThreadId: "bb-thread-1",
        providerId: "claude-code",
        rawType: "sdk/custom_event",
        scope: threadScope(),
        rawEvent: expect.objectContaining({
          method: "sdk/message",
        }),
      }),
    ]);
  });

  it("ignores sdk user text echoes", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "bb-thread-1",
        message: {
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "This session is being continued from a previous conversation.",
              },
            ],
          },
          parent_tool_use_id: null,
          session_id: "sess-1",
          uuid: "user-message-1",
          timestamp: "2026-05-03T07:53:31.543Z",
          isSynthetic: true,
        },
      },
    });

    expect(events).toEqual([]);
  });

  it("ignores sdk stream ping keepalives", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "bb-thread-1",
        message: {
          type: "stream_event",
          event: {
            type: "ping",
          },
          session_id: "sess-1",
          parent_tool_use_id: null,
          uuid: "stream-ping-1",
        },
      },
    });

    expect(events).toEqual([]);
  });

  it("preserves the active turn on unknown sdk envelopes", () => {
    const { translateClaudeEvent } = createTranslator();

    translateClaudeEvent(
      {
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Working on it." }],
        },
        session_id: "sess-1",
      },
      { threadId: "bb-thread-1" },
    );

    const events = translateClaudeEvent(
      {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "bb-thread-1",
          message: {
            type: "custom_event",
          },
        },
      },
      { threadId: "bb-thread-1" },
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        threadId: "bb-thread-1",
        scope: turnScope("turn-1"),
        rawType: "sdk/custom_event",
      }),
    ]);
  });

  it("surfaces malformed handled sdk envelopes as provider/unhandled", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "result",
        },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "claude-code",
        rawType: "sdk/result",
        scope: threadScope(),
        rawEvent: expect.objectContaining({
          method: "sdk/message",
        }),
      }),
    ]);
  });

  it("ignores task-updated system events from the SDK envelope", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "system",
          subtype: "task_updated",
          task_id: "task-1",
          patch: {
            is_backgrounded: true,
          },
        },
      },
    });

    expect(events).toMatchObject([]);
  });

  it("ignores thinking-token system events from the SDK envelope", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "system",
          subtype: "thinking_tokens",
          estimated_tokens: 24,
          estimated_tokens_delta: 23,
          uuid: "message-1",
          session_id: "session-1",
        },
      },
    });

    expect(events).toMatchObject([]);
  });

  it("ignores async hook lifecycle system events from the SDK envelope", () => {
    const { translateClaudeEvent } = createTranslator();

    for (const subtype of [
      "hook_started",
      "hook_progress",
      "hook_response",
      "commands_changed",
    ] as const) {
      const events = translateClaudeEvent({
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "claude-thread-1",
          message: {
            type: "system",
            subtype,
            hook_name: "SessionStart:startup",
            hook_event: "SessionStart",
            uuid: "message-1",
            session_id: "session-1",
          },
        },
      });

      expect(events).toMatchObject([]);
    }
  });

  it("returns empty for non-compaction system messages", () => {
    const { translateClaudeEvent } = createTranslator();
    const events = translateClaudeEvent({
      type: "system",
      subtype: "init",
      session_id: "sess-1",
    });
    expect(events).toMatchObject([]);
  });

  it("fixture: system-init produces no events", () => {
    const { translateClaudeEvent } = createTranslator();
    const events = translateClaudeEvent(loadFixture("system-init.json"));
    expect(events).toMatchObject([]);
  });

  it("ignores Claude command lifecycle events", () => {
    const { translateClaudeEvent } = createTranslator();
    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "thread-1",
        message: {
          type: "command_lifecycle",
          command_uuid: "command-1",
          state: "started",
          uuid: "message-1",
          session_id: "session-1",
        },
      },
    });

    expect(events).toEqual([]);
  });
});

describe("claude warnings and identity", () => {
  it("surfaces automatic permission denials as warnings", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "system",
          subtype: "permission_denied",
          tool_name: "Bash",
          tool_use_id: "tool-1",
          decision_reason_type: "classifier",
          decision_reason: "The command is too risky to approve automatically.",
          message: "Permission denied",
          uuid: "message-1",
          session_id: "session-1",
        },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/warning",
        category: "general",
        summary: "Bash was denied automatically",
        details:
          "The command is too risky to approve automatically. (classifier)",
      }),
    ]);
    expect(events.some((event) => event.type === "provider/unhandled")).toBe(
      false,
    );
  });

  it("maps thread identity envelopes", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "thread/identity",
      params: {
        threadId: "bb-thread-1",
        providerThreadId: "claude-thread-1",
      },
    });

    expect(events).toEqual([
      {
        type: "thread/identity",
        threadId: "bb-thread-1",
        providerThreadId: "claude-thread-1",
        scope: threadScope(),
      },
    ]);
  });
});

describe("claude model refusals", () => {
  it("normalizes Claude model refusal fallbacks", () => {
    const { translateClaudeEvent } = createTranslator();
    const events = translateClaudeEvent({
      type: "system",
      subtype: "model_refusal_fallback",
      original_model: "claude-fable-5",
      fallback_model: "claude-opus-4-8",
      content: "Fable refused this request. Switched to Opus.",
      session_id: "sess-1",
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/modelFallback",
        scope: threadScope(),
        originalModel: "claude-fable-5",
        fallbackModel: "claude-opus-4-8",
        reason: "refusal",
        message: "Fable refused this request. Switched to Opus.",
      }),
    ]);
  });

  it("emits the early assistant fallback block and deduplicates the later system event", () => {
    const { translateClaudeEvent } = createTranslator();
    const earlyEvents = translateClaudeEvent({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-opus-4-8",
        content: [
          {
            type: "fallback",
            from: { model: "claude-fable-5" },
            to: { model: "claude-opus-4-8" },
          },
        ],
      },
      session_id: "sess-1",
    });

    expect(earlyEvents).toEqual([
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("turn-1"),
      }),
      expect.objectContaining({
        type: "provider/modelFallback",
        scope: turnScope("turn-1"),
        originalModel: "claude-fable-5",
        fallbackModel: "claude-opus-4-8",
        reason: "provider",
        message: "Switched from claude-fable-5 to claude-opus-4-8.",
      }),
    ]);

    const detailedEvents = translateClaudeEvent({
      type: "system",
      subtype: "model_refusal_fallback",
      original_model: "claude-fable-5",
      fallback_model: "claude-opus-4-8",
      content: "Fable refused this request. Switched to Opus.",
      session_id: "sess-1",
    });

    expect(detailedEvents).toEqual([]);
  });

  it("surfaces refusal without fallback as a warning", () => {
    const { translateClaudeEvent } = createTranslator();
    const events = translateClaudeEvent({
      type: "system",
      subtype: "model_refusal_no_fallback",
      content: "The model refused and no fallback was configured.",
      session_id: "sess-1",
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/warning",
        category: "general",
        summary: "Model refused the request",
        details: "The model refused and no fallback was configured.",
      }),
    ]);
  });
});

describe("claude compaction", () => {
  it("status compacting starts a turn and emits a compaction item", () => {
    const { translateClaudeEvent } = createTranslator();
    const events = translateClaudeEvent({
      type: "system",
      subtype: "status",
      status: "compacting",
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "contextCompaction",
          id: "claude-compaction-turn-1",
        },
      }),
    );
  });

  it("status null completes the open compaction item", () => {
    const { translateClaudeEvent } = createTranslator();
    translateClaudeEvent({
      type: "system",
      subtype: "status",
      status: "compacting",
      session_id: "sess-1",
    });

    const events = translateClaudeEvent({
      type: "system",
      subtype: "status",
      status: null,
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        scope: turnScope("turn-1"),
        item: {
          type: "contextCompaction",
          id: "claude-compaction-turn-1",
        },
      }),
    );
  });

  it("status null after the compaction turn ended emits nothing", () => {
    const { translateClaudeEvent } = createTranslator();
    translateClaudeEvent({
      type: "system",
      subtype: "status",
      status: "compacting",
      session_id: "sess-1",
    });
    // The turn that owned the compaction completes before the status clears;
    // a stale entry must not complete under a later turn.
    translateClaudeEvent({
      type: "result",
      subtype: "end_turn",
      session_id: "sess-1",
    });

    const events = translateClaudeEvent({
      type: "system",
      subtype: "status",
      status: null,
      session_id: "sess-1",
    });

    expect(
      events.filter((event) => event.type === "item/completed"),
    ).toHaveLength(0);
  });

  it("compact_boundary emits thread/compacted", () => {
    const { translateClaudeEvent } = createTranslator();

    translateClaudeEvent({
      type: "system",
      subtype: "status",
      status: "compacting",
      session_id: "sess-1",
    });

    const events = translateClaudeEvent({
      type: "system",
      subtype: "compact_boundary",
      session_id: "sess-1",
      compact_metadata: {
        pre_tokens: 199622,
        trigger: "auto",
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/compacted",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
      }),
    );
  });

  it("compact_boundary without a known turn is unhandled", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      type: "system",
      subtype: "compact_boundary",
      session_id: "sess-1",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
      }),
    );
  });
});

describe("claude error translation", () => {
  it("maps error envelopes", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "error",
      params: {
        message: "bridge failed",
      },
    });

    expect(events).toEqual([
      {
        type: "provider/error",
        threadId: "",
        providerThreadId: "",
        scope: threadScope(),
        message: "Provider error",
        detail: "bridge failed",
      },
    ]);
  });

  it("completes a failed turn for thread-scoped bridge errors", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent(
      {
        jsonrpc: "2.0",
        method: "error",
        params: {
          message: "Claude auth expired",
        },
      },
      { threadId: "bb-thread-1" },
    );

    expect(events).toEqual([
      {
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
      },
      {
        type: "provider/error",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        message: "Provider error",
        detail: "Claude auth expired",
      },
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "failed",
      },
    ]);
  });

  it("marks Claude result events with is_error as failed", () => {
    const { translateClaudeEvent } = createTranslator();

    translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "assistant",
          message: {
            id: "assistant-1",
            content: [
              {
                type: "text",
                text: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded. https://docs.claude.com/en/api/errors"},"request_id":"req_123"}',
              },
            ],
          },
        },
      },
    });

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "result",
          subtype: "success",
          is_error: true,
          api_error_status: 529,
          result:
            'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded. https://docs.claude.com/en/api/errors"},"request_id":"req_123"}',
          usage: {},
          modelUsage: {},
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "failed",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/error",
        message: "Provider error",
        errorInfo: {
          category: "overloaded",
          providerCode: null,
          httpStatusCode: 529,
        },
      }),
    );
  });

  // The only coverage in the repo for claude-code/error-info.ts's
  // non-rate-limit classification.
  it("maps Claude result error subtypes to provider error info", () => {
    const { translateClaudeEvent } = createTranslator();

    translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "assistant",
          message: {
            id: "assistant-1",
            content: [],
          },
        },
      },
    });

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "result",
          subtype: "error_max_budget_usd",
          is_error: true,
          errors: ["Budget limit reached"],
          usage: {},
          modelUsage: {},
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/error",
        scope: turnScope("turn-1"),
        message: "Provider error",
        detail: "Budget limit reached",
        errorInfo: {
          category: "budget-exceeded",
          providerCode: "error_max_budget_usd",
          httpStatusCode: null,
        },
      }),
    );
  });

  it("preserves unknown Claude rate limit window keys", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "allowed",
            rateLimitType: "seven_day_fable",
            overageStatus: "rejected",
            overageDisabledReason: "out_of_credits",
          },
        },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/rateLimits/updated",
        scope: threadScope(),
        rateLimits: expect.objectContaining({
          providerId: "claude-code",
          status: "allowed",
          windows: [
            expect.objectContaining({
              providerKey: "seven_day_fable",
              label: null,
            }),
          ],
        }),
      }),
    ]);
  });

  it("keeps overage-covered rejections nonterminal", () => {
    const { translateClaudeEvent } = createTranslator();

    const events = translateClaudeEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "claude-thread-1",
        message: {
          type: "rate_limit_event",
          rate_limit_info: {
            status: "rejected",
            rateLimitType: "five_hour",
            resetsAt: 1781120400,
            overageStatus: "allowed",
          },
        },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/rateLimits/updated",
        rateLimits: expect.objectContaining({
          status: "allowed",
          overageStatus: "allowed",
          windows: [
            expect.objectContaining({
              providerKey: "five_hour",
              status: "blocked",
              resetsAtMs: 1_781_120_400_000,
            }),
          ],
        }),
      }),
    ]);
  });
});

describe("claude interactive-request turn id resolution", () => {
  // The bridge forwards permission/user-question requests that omit a turn id;
  // they must land inside the turn that is actually running.
  it("fills a missing interactive-request turn id from the active turn", () => {
    const { resolveClaudeInteractiveRequestTurnId, translateClaudeEvent } =
      createTranslator();
    translateClaudeEvent(
      {
        type: "assistant",
        message: {
          id: "msg-1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: { file_path: "/etc/hosts" },
            },
          ],
        },
        session_id: "sess-1",
      },
      { threadId: "thr_1" },
    );

    expect(
      resolveClaudeInteractiveRequestTurnId({
        threadId: "thr_1",
        turnId: null,
      }),
    ).toBe("turn-1");
  });

  it("rejects a missing interactive-request turn id without an active turn", () => {
    const { resolveClaudeInteractiveRequestTurnId } = createTranslator();

    expect(
      resolveClaudeInteractiveRequestTurnId({
        threadId: "thr_1",
        turnId: null,
      }),
    ).toBeNull();
  });
});
