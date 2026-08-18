import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { threadScope, turnScope } from "@bb/domain";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createPiEventTranslator } from "./event-translation.js";

/**
 * Pi event translation.
 *
 * These cases moved here verbatim-in-behavior from the deleted legacy Pi
 * adapter suite, which reached this translator through the adapter's
 * pass-through `translateEvent`. The canonical bridge drives the same
 * translator, but its suites assert session/protocol behavior rather than the
 * ThreadEvent shapes below.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "../__fixtures__/pi");

function loadFixture(name: string): AgentSessionEvent {
  return JSON.parse(
    readFileSync(resolve(FIXTURES, name), "utf8"),
  ) as AgentSessionEvent;
}

type PiEventTranslator = ReturnType<typeof createPiEventTranslator>;

function createTranslator(): PiEventTranslator {
  return createPiEventTranslator({ providerId: "pi" });
}

function createPiAgentErrorEvent(
  errorMessage: string,
  willRetry: boolean,
): AgentSessionEvent {
  return {
    type: "agent_end",
    messages: [
      {
        role: "assistant",
        content: [],
        stopReason: "error",
        errorMessage,
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-haiku-4-5",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
        timestamp: 1777995781000,
      },
    ],
    willRetry,
  };
}

interface PiTestThreadContext {
  threadId: string;
}

interface PiBashStartEventArgs {
  command: string;
  cwd?: string;
  toolCallId: string;
}

function createPiBashStartEvent(args: PiBashStartEventArgs): AgentSessionEvent {
  return {
    type: "tool_execution_start",
    toolCallId: args.toolCallId,
    toolName: "bash",
    args: {
      command: args.command,
      cwd: args.cwd ?? "/repo",
    },
  };
}

interface PiBashUpdateEventArgs {
  text: string;
  threadId: string;
  toolCallId: string;
}

function createPiBashUpdateEvent(args: PiBashUpdateEventArgs) {
  return {
    jsonrpc: "2.0" as const,
    method: "sdk/message",
    params: {
      threadId: args.threadId,
      message: {
        type: "tool_execution_update" as const,
        toolCallId: args.toolCallId,
        toolName: "bash" as const,
        partialResult: {
          content: [{ type: "text" as const, text: args.text }],
        },
      },
    },
  };
}

interface SeedPiBashSnapshotArgs {
  translator: PiEventTranslator;
  context: PiTestThreadContext;
  toolCallId: string;
}

function seedPiBashOutputSnapshot(args: SeedPiBashSnapshotArgs): void {
  args.translator.translatePiEvent(
    loadFixture("agent-start.json"),
    args.context,
  );
  args.translator.translatePiEvent(
    createPiBashStartEvent({
      toolCallId: args.toolCallId,
      command: "printf 'FIRST\\n'",
    }),
    args.context,
  );
  args.translator.translatePiEvent(
    createPiBashUpdateEvent({
      threadId: args.context.threadId,
      toolCallId: args.toolCallId,
      text: "FIRST\n",
    }),
    args.context,
  );
}

interface ExpectPiBashSnapshotResetArgs {
  translator: PiEventTranslator;
  context: PiTestThreadContext;
  reset: () => void;
  toolCallId: string;
}

function expectPiBashSnapshotReset(args: ExpectPiBashSnapshotResetArgs): void {
  args.reset();
  args.translator.translatePiEvent(
    loadFixture("agent-start.json"),
    args.context,
  );
  args.translator.translatePiEvent(
    createPiBashStartEvent({
      toolCallId: args.toolCallId,
      command: "printf 'FIRST\\nSECOND\\n'",
    }),
    args.context,
  );

  const events = args.translator.translatePiEvent(
    createPiBashUpdateEvent({
      threadId: args.context.threadId,
      toolCallId: args.toolCallId,
      text: "FIRST\nSECOND\n",
    }),
    args.context,
  );

  expect(events).toContainEqual(
    expect.objectContaining({
      type: "item/commandExecution/outputDelta",
      itemId: args.toolCallId,
      delta: "FIRST\nSECOND\n",
    }),
  );
}
describe("pi event translation", () => {
  it("translateEvent keeps turn_start as internal noise while agent_start owns the bb turn", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      type: "turn_start",
    } as AgentSessionEvent);

    expect(events).toMatchObject([]);
  });

  it("translateEvent agent_end emits agentMessage + turn/completed", () => {
    const translator = createTranslator();
    // Start a turn first
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      ...loadFixture("agent-end-with-message.json"),
      providerCheckpointId: "pi-entry-42",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          text: "I've updated the configuration file to use the new database connection string. The change affects `/src/config/database.ts` and should resolve the timeout issues you were experiencing.",
        }),
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
        providerCheckpointId: "pi-entry-42",
      }),
    );
    expect(events.some((event) => event.type === "provider/error")).toBe(false);
  });

  it("completes extension-triggered turns when agent_end includes string custom content", () => {
    const translator = createTranslator();
    const context = { threadId: "pi-thread-1" };
    const agentEndEvent = {
      type: "agent_end",
      messages: [
        {
          role: "custom",
          customType: "pi-processes",
          content: "Process completed successfully",
          display: true,
          timestamp: 1777995780000,
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "The process finished." }],
          api: "anthropic-messages",
          provider: "anthropic",
          model: "claude-haiku-4-5",
          usage: {
            input: 10,
            output: 5,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 15,
            cost: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              total: 0,
            },
          },
          stopReason: "stop",
          timestamp: 1777995781000,
        },
      ],
      willRetry: false,
    } satisfies AgentSessionEvent;

    translator.translatePiEvent(
      {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: context.threadId,
          message: { type: "agent_start" },
        },
      },
      context,
    );

    const events = translator.translatePiEvent(
      {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: context.threadId,
          message: agentEndEvent,
        },
      },
      context,
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    );
    expect(events.some((event) => event.type === "provider/unhandled")).toBe(
      false,
    );
  });

  it("translateEvent agent_end surfaces Pi assistant stop errors as failed turns", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };
    const quotaMessage =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage. Add more at claude.ai/settings/usage and keep going."},"request_id":"req_011CajgGfxCAhmznZJw7t6Br"}';

    translator.translatePiEvent(loadFixture("agent-start.json"), context);

    const events = translator.translatePiEvent(
      createPiAgentErrorEvent(quotaMessage, false),
      context,
    );

    expect(events).toEqual([
      {
        type: "provider/error",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        message: "Provider error",
        detail: quotaMessage,
      },
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "failed",
      },
    ]);
    expect(events.some((event) => event.type === "item/completed")).toBe(false);
  });

  it("keeps the Pi turn active while the SDK retries an assistant error", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };
    translator.translatePiEvent(loadFixture("agent-start.json"), context);

    const retryEvents = translator.translatePiEvent(
      createPiAgentErrorEvent("temporary provider failure", true),
      context,
    );
    const completedEvents = translator.translatePiEvent(
      loadFixture("agent-end-with-message.json"),
      context,
    );

    expect(retryEvents).toEqual([
      expect.objectContaining({
        type: "provider/error",
        detail: "temporary provider failure",
        willRetry: true,
      }),
    ]);
    expect(retryEvents.some((event) => event.type === "turn/completed")).toBe(
      false,
    );
    expect(completedEvents).toContainEqual(
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    );
  });

  it("translateEvent compaction_start emits a compaction item", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const event = {
      type: "compaction_start",
      reason: "threshold",
    } satisfies AgentSessionEvent;
    const events = translator.translatePiEvent(event);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "contextCompaction",
          id: "pi-compaction-turn-1",
        },
      }),
    );
  });

  it("translateEvent compaction_end emits thread/compacted", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));
    const startEvent = {
      type: "compaction_start",
      reason: "threshold",
    } satisfies AgentSessionEvent;
    translator.translatePiEvent(startEvent);

    const endEvent = {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
    } satisfies AgentSessionEvent;
    const events = translator.translatePiEvent(endEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/compacted",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
      }),
    );
  });

  it.each([
    {
      label: "failed",
      end: {
        aborted: false,
        errorMessage: "Automatic compaction overflowed",
      },
      detail: "Automatic compaction overflowed",
    },
    {
      label: "aborted",
      end: { aborted: true },
      detail: "Automatic context compaction was interrupted",
    },
  ])("terminates a $label automatic compaction", ({ end, detail }) => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));
    translator.translatePiEvent({
      type: "compaction_start",
      reason: "threshold",
    } satisfies AgentSessionEvent);

    const events = translator.translatePiEvent({
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      willRetry: false,
      ...end,
    } satisfies AgentSessionEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/error",
        scope: turnScope("turn-1"),
        detail,
      }),
    );
    expect(events.some((event) => event.type === "thread/compacted")).toBe(
      false,
    );
  });

  function translateManualCompaction(args: {
    aborted: boolean;
    errorMessage?: string;
  }) {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };
    const started = translator.translatePiEvent(
      {
        type: "compaction_start",
        reason: "manual",
      } satisfies AgentSessionEvent,
      context,
    );
    const completed = translator.translatePiEvent(
      {
        type: "compaction_end",
        reason: "manual",
        result: undefined,
        willRetry: false,
        ...args,
      } satisfies AgentSessionEvent,
      context,
    );
    return { completed, started };
  }

  it("translateEvent manual compaction owns a complete maintenance turn", () => {
    const { completed, started } = translateManualCompaction({
      aborted: false,
    });

    expect(started.map((event) => event.type)).toEqual([
      "turn/started",
      "item/started",
    ]);
    expect(completed).toEqual([
      expect.objectContaining({
        type: "thread/compacted",
        scope: turnScope("turn-1"),
      }),
      expect.objectContaining({
        type: "turn/completed",
        scope: turnScope("turn-1"),
        status: "completed",
      }),
    ]);
  });

  it.each([
    "Compaction failed: Nothing to compact (session too small)",
    "Compaction failed: Already compacted",
  ])(
    "translateEvent manual compaction refusal %j completes the turn as a no-op",
    (errorMessage) => {
      const { completed } = translateManualCompaction({
        aborted: false,
        errorMessage,
      });

      expect(completed).toEqual([
        expect.objectContaining({
          type: "provider/warning",
          scope: turnScope("turn-1"),
          category: "compaction-skipped",
          summary: "Context compaction skipped",
          details: errorMessage,
        }),
        {
          type: "turn/completed",
          threadId: "",
          providerThreadId: "",
          scope: turnScope("turn-1"),
          status: "completed",
        },
      ]);
      expect(completed.some((event) => event.type === "thread/compacted")).toBe(
        false,
      );
    },
  );

  it.each([
    {
      label: "failed",
      args: {
        aborted: false,
        errorMessage: "Compaction failed: Summarization failed: 500",
      },
      expected: {
        status: "failed",
        error: {
          message: "Compaction failed: Summarization failed: 500",
        },
      },
    },
    {
      label: "aborted",
      args: { aborted: true },
      expected: { status: "interrupted" },
    },
  ])(
    "translateEvent $label manual compaction does not report success",
    ({ args, expected }) => {
      const { completed } = translateManualCompaction(args);
      expect(completed).toEqual([
        expect.objectContaining({
          type: "turn/completed",
          scope: turnScope("turn-1"),
          ...expected,
        }),
      ]);
    },
  );

  it("translateEvent compaction_end without a known turn is unhandled", () => {
    const translator = createTranslator();
    const event = {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
    } satisfies AgentSessionEvent;

    const events = translator.translatePiEvent(event);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
      }),
    );
  });

  it("translateEvent compaction_start reuses the last completed turn id without opening a new turn", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));
    translator.translatePiEvent(loadFixture("agent-end-with-message.json"));

    const event = {
      type: "compaction_start",
      reason: "threshold",
    } satisfies AgentSessionEvent;
    const events = translator.translatePiEvent(event);

    expect(events).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "contextCompaction",
          id: "pi-compaction-turn-1",
        },
      },
    ]);
  });
  it("translateEvent reuses the streamed assistant item id when the turn ends", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const deltaEvents = translator.translatePiEvent(
      loadFixture("message-update-delta.json"),
    );
    const deltaEvent = deltaEvents.find(
      (
        event,
      ): event is Extract<
        (typeof deltaEvents)[number],
        { type: "item/agentMessage/delta" }
      > => event.type === "item/agentMessage/delta",
    );
    const completedEvents = translator.translatePiEvent(
      loadFixture("agent-end-with-message.json"),
    );

    expect(deltaEvent?.itemId).toMatch(/^pi-assistant-/);
    expect(completedEvents).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "agentMessage",
          id: deltaEvent?.itemId,
        }),
      }),
    );
  });

  it("translateEvent assigns a new assistant id after a tool call interrupts streaming", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    // Stream assistant text before tool call
    const preDelta = translator.translatePiEvent(
      loadFixture("message-update-delta.json"),
    );
    const preItemId = preDelta.find(
      (
        e,
      ): e is Extract<
        (typeof preDelta)[number],
        { type: "item/agentMessage/delta" }
      > => e.type === "item/agentMessage/delta",
    )?.itemId;

    // Tool call starts — should close the assistant scope
    translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: { command: "ls" },
    });

    // Stream assistant text after tool call
    const postDelta = translator.translatePiEvent(
      loadFixture("message-update-delta.json"),
    );
    const postItemId = postDelta.find(
      (
        e,
      ): e is Extract<
        (typeof postDelta)[number],
        { type: "item/agentMessage/delta" }
      > => e.type === "item/agentMessage/delta",
    )?.itemId;

    // Completed assistant message at agent_end should use the post-tool id
    const endEvents = translator.translatePiEvent(
      loadFixture("agent-end-with-message.json"),
    );
    const completedId = endEvents.find(
      (e) => e.type === "item/completed" && e.item.type === "agentMessage",
    );

    expect(preItemId).toMatch(/^pi-assistant-/);
    expect(postItemId).toMatch(/^pi-assistant-/);
    expect(preItemId).not.toBe(postItemId);
    expect(completedId).toBeDefined();
    if (
      completedId?.type === "item/completed" &&
      completedId.item.type === "agentMessage"
    ) {
      expect(completedId.item.id).toBe(postItemId);
    }
  });

  it("translateEvent streams and finalizes Pi thinking with a stable reasoning id", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const deltaEvents = translator.translatePiEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 0,
        delta: "Thinking through the edit.",
      },
    } as AgentSessionEvent);
    const reasoningDelta = deltaEvents.find(
      (
        event,
      ): event is Extract<
        (typeof deltaEvents)[number],
        { type: "item/reasoning/textDelta" }
      > => event.type === "item/reasoning/textDelta",
    );

    const completedEvents = translator.translatePiEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_end",
        contentIndex: 0,
        content: "Thinking through the edit.",
      },
    } as AgentSessionEvent);

    expect(reasoningDelta?.itemId).toMatch(/^pi-reasoning-/);
    expect(completedEvents).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "reasoning",
          id: reasoningDelta?.itemId,
          content: ["Thinking through the edit."],
        }),
      }),
    );
  });

  it("translateEvent surfaces Pi thinking without contentIndex as provider/unhandled", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "Thinking without a scope.",
      },
    } as AgentSessionEvent);

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "pi",
        rawType: "sdk/message_update:thinking_delta",
        scope: turnScope("turn-1"),
      }),
    ]);
  });

  // -- translateEvent: tool calls ------------------------------------------

  it("translateEvent tool_execution_start emits item/started", () => {
    const translator = createTranslator();
    // Start a turn first
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent(
      loadFixture("tool-execution-start-bash.json"),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tc_01a2b3c4d5e6f7g8h9i0j1k2",
          status: "pending",
        }),
      }),
    );
  });

  it("translateEvent preserves parent_tool_use_id on nested sdk/message events", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        parent_tool_use_id: "agent-parent-1",
        message: {
          type: "tool_execution_start",
          toolCallId: "tool-bash-1",
          toolName: "bash",
          args: {
            command: "ls",
          },
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-bash-1",
          parentToolCallId: "agent-parent-1",
        }),
      }),
    );
  });

  it("translateEvent falls back to a generic tool call when bash args are malformed", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: {
        command: 42,
      },
    } as AgentSessionEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "toolCall",
          id: "tool-bash-1",
          tool: "bash",
          status: "pending",
        }),
      }),
    );
  });

  it("translateEvent surfaces malformed handled sdk envelopes as provider/unhandled", () => {
    const translator = createTranslator();

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "agent_end",
        },
      },
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "pi",
        rawType: "sdk/agent_end",
        scope: threadScope(),
        rawEvent: expect.objectContaining({
          method: "sdk/message",
        }),
      }),
    ]);
  });

  it("translateEvent drops agent_settled instead of surfacing it in the transcript", () => {
    // Pi emits agent_settled after every agent run. Without an explicit
    // ignore it falls through to provider/unhandled, which renders as
    // "Unhandled Pi event" in the thread for the user on every single turn.
    const translator = createTranslator();

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "agent_settled",
        },
      },
    });

    expect(events).toEqual([]);
  });

  it("translateEvent scopes unknown sdk envelopes to the active turn", () => {
    const translator = createTranslator();
    const context = { threadId: "pi-thread-1" };
    translator.translatePiEvent(loadFixture("agent-start.json"), context);

    const events = translator.translatePiEvent(
      {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "pi-thread-1",
          message: {
            type: "future_event",
            value: true,
          },
        },
      },
      context,
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "pi",
        scope: turnScope("turn-1"),
        rawEvent: expect.objectContaining({
          method: "sdk/message",
        }),
      }),
    ]);
  });

  it("translateEvent keeps late unknown sdk envelopes thread scoped", () => {
    const translator = createTranslator();
    const context = { threadId: "pi-thread-1" };
    translator.translatePiEvent(loadFixture("agent-start.json"), context);
    translator.translatePiEvent(
      loadFixture("agent-end-with-message.json"),
      context,
    );

    const events = translator.translatePiEvent(
      {
        jsonrpc: "2.0",
        method: "sdk/message",
        params: {
          threadId: "pi-thread-1",
          message: {
            type: "future_event",
            value: true,
          },
        },
      },
      context,
    );

    expect(events).toEqual([
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "pi",
        scope: threadScope(),
        rawEvent: expect.objectContaining({
          method: "sdk/message",
        }),
      }),
    ]);
  });

  it("translateEvent tool_execution_start with edit args emits fileChange with diff", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-edit-1",
      toolName: "edit",
      args: {
        path: "src/app.ts",
        oldText: "const enabled = false;\n",
        newText: "const enabled = true;\n",
      },
    } as AgentSessionEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "fileChange",
          id: "tool-edit-1",
          status: "pending",
          changes: [
            expect.objectContaining({
              path: "src/app.ts",
              diff: expect.stringContaining("const enabled = true;"),
            }),
          ],
        }),
      }),
    );
  });

  it("translateEvent tool_execution_start with content-only write args marks the change as an add", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-write-1",
      toolName: "write",
      args: {
        path: "src/app.ts",
        content: "console.log('updated');\n",
      },
    } as AgentSessionEvent);

    const started = events.find(
      (
        event,
      ): event is Extract<(typeof events)[number], { type: "item/started" }> =>
        event.type === "item/started",
    );
    expect(started?.item).toMatchObject({
      type: "fileChange",
      id: "tool-write-1",
      status: "pending",
      changes: [
        {
          path: "src/app.ts",
          kind: "add",
        },
      ],
    });
    if (!started || started.item.type !== "fileChange") return;
    expect(started.item.changes[0]?.diff).toContain("+++ b/src/app.ts");
  });

  it("translateEvent tool_execution_start with read args preserves structured tool arguments", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-read-1",
      toolName: "read",
      args: {
        path: "src/app.ts",
        offset: 1,
        limit: 20,
      },
    } as AgentSessionEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/started",
        item: expect.objectContaining({
          type: "toolCall",
          id: "tool-read-1",
          tool: "read",
          status: "pending",
          arguments: expect.objectContaining({
            path: "src/app.ts",
            offset: 1,
            limit: 20,
          }),
        }),
      }),
    );
  });

  it("translateEvent tool_execution_end emits item/completed", () => {
    const translator = createTranslator();
    // Start a turn first
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent(
      loadFixture("tool-execution-end-bash.json"),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tc_01a2b3c4d5e6f7g8h9i0j1k2",
          status: "completed",
        }),
      }),
    );
  });

  it("translateEvent tool_execution_end marks bash failures", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: {
        command: "npm test",
        cwd: "/repo",
      },
    } as AgentSessionEvent);

    const events = translator.translatePiEvent({
      type: "tool_execution_end",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      isError: true,
      result: "tests failed",
    } as AgentSessionEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-bash-1",
          command: "npm test",
          cwd: "/repo",
          aggregatedOutput: "tests failed",
          exitCode: 1,
          status: "failed",
        }),
      }),
    );
  });

  it("translateEvent recovers non-bash tool results from the started item", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-read-1",
      toolName: "read",
      args: {
        path: "src/app.ts",
        offset: 1,
        limit: 20,
      },
    } as AgentSessionEvent);

    const events = translator.translatePiEvent({
      type: "tool_execution_end",
      toolCallId: "tool-read-1",
      toolName: "read",
      isError: false,
      result: "file contents",
    } as AgentSessionEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "toolCall",
          id: "tool-read-1",
          tool: "read",
          status: "completed",
          result: "file contents",
          arguments: expect.objectContaining({
            path: "src/app.ts",
            offset: 1,
            limit: 20,
          }),
        }),
      }),
    );
  });

  it("translateEvent maps bash tool execution updates to command output deltas", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));
    translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: {
        command: "printf 'FIRST\\nSECOND\\n'",
        cwd: "/repo",
      },
    } as AgentSessionEvent);

    const firstEvents = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "tool_execution_update",
          toolCallId: "tool-bash-1",
          toolName: "bash",
          partialResult: {
            content: [{ type: "text", text: "FIRST\n" }],
          },
        },
      },
    });

    expect(firstEvents).toContainEqual(
      expect.objectContaining({
        type: "item/commandExecution/outputDelta",
        itemId: "tool-bash-1",
        delta: "FIRST\n",
      }),
    );

    const secondEvents = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "tool_execution_update",
          toolCallId: "tool-bash-1",
          toolName: "bash",
          partialResult: {
            content: [{ type: "text", text: "FIRST\nSECOND\n" }],
          },
        },
      },
    });

    expect(secondEvents).toContainEqual(
      expect.objectContaining({
        type: "item/commandExecution/outputDelta",
        itemId: "tool-bash-1",
        delta: "SECOND\n",
      }),
    );
  });

  it("translateEvent emits the full bash delta when Pi resets cumulative output", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));
    translator.translatePiEvent(
      createPiBashStartEvent({
        toolCallId: "tool-bash-1",
        command: "printf 'FIRST\\nSECOND\\n'",
      }),
    );

    translator.translatePiEvent(
      createPiBashUpdateEvent({
        threadId: "pi-thread-1",
        toolCallId: "tool-bash-1",
        text: "FIRST\nSECOND\n",
      }),
    );

    const resetEvents = translator.translatePiEvent(
      createPiBashUpdateEvent({
        threadId: "pi-thread-1",
        toolCallId: "tool-bash-1",
        text: "RESET\n",
      }),
    );

    expect(resetEvents).toContainEqual(
      expect.objectContaining({
        type: "item/commandExecution/outputDelta",
        itemId: "tool-bash-1",
        delta: "RESET\n",
        reset: true,
      }),
    );
  });

  it("translateEvent clears bash output snapshots when a turn completes", () => {
    const translator = createTranslator();
    const context = { threadId: "bb-thread-1" };

    seedPiBashOutputSnapshot({
      translator,
      context,
      toolCallId: "tool-bash-1",
    });

    expectPiBashSnapshotReset({
      translator,
      context,
      toolCallId: "tool-bash-1",
      reset: () => {
        translator.translatePiEvent(
          loadFixture("agent-end-with-message.json"),
          context,
        );
      },
    });
  });
  it("translateEvent skips empty bash updates with no content", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "tool_execution_update",
          toolCallId: "tool-bash-1",
          toolName: "bash",
          partialResult: {
            content: [],
          },
        },
      },
    });

    expect(events).toMatchObject([]);
  });

  it("translateEvent skips Pi bash update placeholders", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "tool_execution_update",
          toolCallId: "tool-bash-1",
          toolName: "bash",
          partialResult: {
            content: [{ type: "text", text: "(no output)" }],
          },
        },
      },
    });

    expect(events).toMatchObject([]);
  });

  it("translateEvent keeps non-bash tool execution updates as shared tool progress", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "tool_execution_update",
          toolCallId: "tool-read-1",
          toolName: "read",
          partialResult: {
            content: [{ type: "text", text: "partial output" }],
          },
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/toolCall/progress",
        itemId: "tool-read-1",
        message: "partial output",
      }),
    );
  });

  it("translateEvent falls back to legacy non-bash progress text when partial output is empty", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "tool_execution_update",
          toolCallId: "tool-read-1",
          toolName: "read",
          partialResult: {
            content: [],
          },
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/toolCall/progress",
        itemId: "tool-read-1",
        message: "read progress update",
      }),
    );
  });

  it("translateEvent strips Pi no-output placeholders from bash completions", () => {
    const translator = createTranslator();
    translator.translatePiEvent(loadFixture("agent-start.json"));
    translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: {
        command: "true",
        cwd: "/repo",
      },
    } as AgentSessionEvent);

    const events = translator.translatePiEvent({
      type: "tool_execution_end",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      isError: false,
      result: {
        content: [{ type: "text", text: "(no output)" }],
      },
    } as AgentSessionEvent);

    const completedEvent = events.find(
      (
        event,
      ): event is Extract<
        (typeof events)[number],
        { type: "item/completed" }
      > => event.type === "item/completed",
    );

    expect(completedEvent?.item).toMatchObject({
      type: "commandExecution",
      id: "tool-bash-1",
      command: "true",
      cwd: "/repo",
      status: "completed",
      exitCode: 0,
    });
    if (completedEvent?.item.type !== "commandExecution") {
      throw new Error("Expected commandExecution completion");
    }
    expect(completedEvent.item.aggregatedOutput).toBeUndefined();
  });

  it("translateEvent surfaces tool events without an active turn as provider/unhandled", () => {
    const translator = createTranslator();

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "tool_execution_start",
          toolCallId: "tool-bash-1",
          toolName: "bash",
          args: {
            command: "npm test",
          },
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
        providerId: "pi",
        rawType: "sdk/tool_execution_start",
        rawEvent: expect.objectContaining({
          method: "sdk/message",
        }),
      }),
    );
  });

  it("translateEvent ignores auto retry notifications for now", () => {
    const translator = createTranslator();

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "sdk/message",
      params: {
        threadId: "pi-thread-1",
        message: {
          type: "auto_retry_start",
          attempt: 1,
          maxAttempts: 2,
          delayMs: 2000,
        },
      },
    });

    expect(events).toMatchObject([]);
  });
  it("translateEvent accumulates Pi token usage across turns", () => {
    const translator = createPiEventTranslator({
      providerId: "pi",
      resolveModelContextWindow: () => 123_456,
    });

    translator.translatePiEvent(loadFixture("agent-start.json"));
    const firstTurnEvents = translator.translatePiEvent(
      loadFixture("agent-end-with-message.json"),
    );

    translator.translatePiEvent(loadFixture("agent-start.json"));
    const secondTurnEvents = translator.translatePiEvent(
      loadFixture("agent-end-with-message.json"),
    );

    const firstTokenUsage = firstTurnEvents.find(
      (
        event,
      ): event is Extract<
        (typeof firstTurnEvents)[number],
        { type: "thread/tokenUsage/updated" }
      > => event.type === "thread/tokenUsage/updated",
    );
    const secondTokenUsage = secondTurnEvents.find(
      (
        event,
      ): event is Extract<
        (typeof secondTurnEvents)[number],
        { type: "thread/tokenUsage/updated" }
      > => event.type === "thread/tokenUsage/updated",
    );

    expect(firstTokenUsage?.tokenUsage.last).toMatchObject({
      totalTokens: 7736,
      inputTokens: 4200,
      cachedInputTokens: 3380,
      outputTokens: 156,
    });
    expect(firstTokenUsage?.tokenUsage.modelContextWindow).toBe(123_456);
    expect(secondTokenUsage?.tokenUsage.total).toMatchObject({
      totalTokens: 15472,
      inputTokens: 8400,
      cachedInputTokens: 6760,
      outputTokens: 312,
    });
    expect(secondTokenUsage?.tokenUsage.last).toEqual(
      firstTokenUsage?.tokenUsage.last,
    );
    expect(secondTokenUsage?.tokenUsage.modelContextWindow).toBe(123_456);
  });

  it("translateEvent maps bridge context-window usage updates into the meter event", () => {
    const translator = createTranslator();

    translator.translatePiEvent(loadFixture("agent-start.json"), {
      threadId: "bb-thread-1",
    });
    translator.translatePiEvent(loadFixture("agent-end-with-message.json"), {
      threadId: "bb-thread-1",
    });

    const events = translator.translatePiEvent({
      jsonrpc: "2.0",
      method: "thread/contextWindowUsage/updated",
      params: {
        threadId: "bb-thread-1",
        contextWindowUsage: {
          usedTokens: 54321,
          modelContextWindow: 123456,
          estimated: true,
        },
      },
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/contextWindowUsage/updated",
        threadId: "bb-thread-1",
        providerThreadId: "bb-thread-1",
        scope: turnScope("turn-1"),
        contextWindowUsage: {
          usedTokens: 54321,
          modelContextWindow: 123456,
          estimated: true,
        },
      }),
    );
  });

  it("translateEvent clears stale tool state when a turn ends without tool results", () => {
    const translator = createTranslator();

    translator.translatePiEvent(loadFixture("agent-start.json"));
    translator.translatePiEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: {
        command: "npm test",
        cwd: "/repo",
      },
    } as AgentSessionEvent);
    translator.translatePiEvent(loadFixture("agent-end-with-message.json"));

    translator.translatePiEvent(loadFixture("agent-start.json"));
    const events = translator.translatePiEvent({
      type: "tool_execution_end",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      isError: false,
      result: "late output",
    } as AgentSessionEvent);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/completed",
        item: expect.objectContaining({
          type: "commandExecution",
          id: "tool-bash-1",
          command: "",
          cwd: "",
          aggregatedOutput: "late output",
        }),
      }),
    );
  });
});
