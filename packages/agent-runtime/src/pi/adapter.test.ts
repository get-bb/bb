import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createStandaloneBuiltinCompactCommandInput,
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  createPiModelContextWindowResolverFrom,
  createPiProviderAdapter,
} from "./adapter.js";
import { buildPiAvailableModels } from "./model-list.js";
import type { ProviderExecutionContext } from "../provider-adapter.js";
import { promptTextInput } from "../test/prompt-input.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "../__fixtures__/pi");

function loadFixture(name: string): AgentSessionEvent {
  return JSON.parse(
    readFileSync(resolve(FIXTURES, name), "utf8"),
  ) as AgentSessionEvent;
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

const fullProviderExecutionContext = {
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
  workflowsEnabled: false,
} satisfies ProviderExecutionContext;

type PiProviderAdapter = ReturnType<typeof createPiProviderAdapter>;

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
  adapter: PiProviderAdapter;
  context: PiTestThreadContext;
  toolCallId: string;
}

function seedPiBashOutputSnapshot(args: SeedPiBashSnapshotArgs): void {
  args.adapter.translateEvent(loadFixture("agent-start.json"), args.context);
  args.adapter.translateEvent(
    createPiBashStartEvent({
      toolCallId: args.toolCallId,
      command: "printf 'FIRST\\n'",
    }),
    args.context,
  );
  args.adapter.translateEvent(
    createPiBashUpdateEvent({
      threadId: args.context.threadId,
      toolCallId: args.toolCallId,
      text: "FIRST\n",
    }),
    args.context,
  );
}

interface ExpectPiBashSnapshotResetArgs {
  adapter: PiProviderAdapter;
  context: PiTestThreadContext;
  reset: () => void;
  toolCallId: string;
}

function expectPiBashSnapshotReset(args: ExpectPiBashSnapshotResetArgs): void {
  args.reset();
  args.adapter.translateEvent(loadFixture("agent-start.json"), args.context);
  args.adapter.translateEvent(
    createPiBashStartEvent({
      toolCallId: args.toolCallId,
      command: "printf 'FIRST\\nSECOND\\n'",
    }),
    args.context,
  );

  const events = args.adapter.translateEvent(
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

describe("pi provider adapter", () => {
  // -- Identity & capabilities ---------------------------------------------

  it("advertises trimmed capabilities", () => {
    const adapter = createPiProviderAdapter();
    expect(adapter.capabilities).toEqual({
      supportsArchive: false,
      supportsRename: false,
      supportsServiceTier: false,
      supportsUserQuestion: false,
      supportsFork: true,
      supportedPermissionModes: ["full"],
    });
  });

  it("translates accepted steers to input accepted events", () => {
    const adapter = createPiProviderAdapter();

    expect(
      adapter.translateAcceptedCommand({
        command: {
          type: "turn/steer",
          threadId: "thread-1",
          providerThreadId: "provider-thread-1",
          expectedTurnId: "turn-1",
          clientRequestId: "creq_23456789ad",
          input: [promptTextInput({ text: "steer turn" })],
          options: fullProviderExecutionContext,
        },
      }),
    ).toEqual([
      {
        type: "turn/input/accepted",
        threadId: "thread-1",
        providerThreadId: "provider-thread-1",
        scope: turnScope("turn-1"),
        clientRequestId: "creq_23456789ad",
      },
    ]);
  });

  it("queues accepted turn starts after a completed turn until the next turn starts", () => {
    const adapter = createPiProviderAdapter();

    adapter.translateEvent(loadFixture("agent-start.json"), { threadId: "t1" });
    adapter.translateEvent(loadFixture("agent-end-with-message.json"), {
      threadId: "t1",
    });

    expect(
      adapter.translateAcceptedCommand({
        command: {
          type: "turn/start",
          threadId: "t1",
          providerThreadId: "pi-1",
          clientRequestId: "creq_23456789ae",
          input: [promptTextInput({ text: "new turn" })],
          options: fullProviderExecutionContext,
        },
      }),
    ).toEqual([]);

    const nextTurnEvents = adapter.translateEvent(
      loadFixture("agent-start.json"),
      { threadId: "t1" },
    );

    expect(nextTurnEvents).toContainEqual({
      type: "turn/started",
      threadId: "",
      providerThreadId: "",
      scope: turnScope("turn-2"),
    });
    expect(nextTurnEvents).toContainEqual({
      type: "turn/input/accepted",
      threadId: "",
      providerThreadId: "",
      scope: turnScope("turn-2"),
      clientRequestId: "creq_23456789ae",
    });
  });

  it("translateEvent completes a failed turn for thread-scoped bridge errors", () => {
    const adapter = createPiProviderAdapter();

    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "error",
        params: {
          message: "No API key found for openai.",
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
        detail: "No API key found for openai.",
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

  // -- buildCommand --------------------------------------------------------

  it("buildCommand thread/start includes threadId and omits instruction overrides when empty", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "thread/start",
      cwd: "/tmp/worktree",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      instructionMode: "append",
      options: fullProviderExecutionContext,
    });
    expect(cmd).toMatchObject({
      method: "thread/start",
      params: {
        threadId: "t1",
        cwd: "/tmp/worktree",
      },
    });
    expect(cmd).not.toMatchObject({
      params: {
        baseInstructions: expect.any(String),
      },
    });
    expect(cmd).not.toMatchObject({
      params: {
        appendSystemPrompt: expect.any(String),
      },
    });
  });

  it("buildCommand thread/fork forwards the provider checkpoint", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "thread/fork",
      cwd: "/tmp/worktree",
      threadId: "t1",
      sourceProviderThreadId: "source-session",
      sourceProviderCheckpointId: "pi-entry-42",
      instructionMode: "append",
      options: fullProviderExecutionContext,
    });

    expect(cmd).toMatchObject({
      method: "thread/fork",
      params: {
        providerCheckpointId: "pi-entry-42",
        sourceProviderThreadId: "source-session",
      },
    });
  });

  it("buildCommand thread/start maps skill roots to Pi additional skill paths", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "thread/start",
      cwd: "/tmp/worktree",
      threadId: "t1",
      input: [promptTextInput({ text: "hello" })],
      instructionMode: "append",
      options: {
        ...fullProviderExecutionContext,
        skillRoots: [
          {
            id: "bb-cli",
            providerId: "pi",
            skillDirectoryRootPath: "/tmp/bb-skills",
          },
          {
            id: "repo-tools",
            providerId: "pi",
            skillDirectoryRootPath: "/tmp/repo-skills",
          },
        ],
      },
    });

    expect(cmd).toMatchObject({
      method: "thread/start",
      params: {
        additionalSkillPaths: ["/tmp/bb-skills", "/tmp/repo-skills"],
      },
    });
  });

  it("buildCommand thread/start passes through model, env vars, append instructions, reasoning level, and dynamic tools", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "thread/start",
      cwd: "/tmp/worktree",
      threadId: "bb-thread-1",
      input: [promptTextInput({ text: "hello" })],
      instructionMode: "append",
      options: {
        ...fullProviderExecutionContext,
        model: "anthropic/claude-sonnet-4-20250514",
        instructions: "Focus on the failing tests first.",
        reasoningLevel: "high",
        envVars: {
          "BAD.KEY": "ignored",
          TEST_VAR: "123",
        },
      },
      dynamicTools: [
        {
          name: "bb_test_ping",
          description: "Ping the host",
          inputSchema: {
            type: "object",
            properties: {
              ping: { type: "boolean" },
            },
            required: ["ping"],
          },
        },
      ],
    });

    expect(cmd).toMatchObject({
      method: "thread/start",
      params: {
        threadId: "bb-thread-1",
        model: "anthropic/claude-sonnet-4-20250514",
        reasoningLevel: "high",
        appendSystemPrompt: "Focus on the failing tests first.",
        dynamicTools: [
          {
            name: "bb_test_ping",
            description: "Ping the host",
            inputSchema: {
              type: "object",
              properties: {
                ping: { type: "boolean" },
              },
              required: ["ping"],
            },
          },
        ],
      },
    });
    expect(cmd).not.toMatchObject({
      params: {
        baseInstructions: expect.any(String),
      },
    });
    expect(
      (cmd as { params: { config?: Record<string, unknown> } }).params.config,
    ).toMatchObject({
      "shell_environment_policy.set.BB_THREAD_ID": "bb-thread-1",
      "shell_environment_policy.set.TEST_VAR": "123",
    });
    expect(cmd).not.toMatchObject({
      params: {
        config: {
          "shell_environment_policy.set.BAD.KEY": "ignored",
        },
      },
    });
  });

  it("maps none to Pi off for every session launch path", () => {
    const adapter = createPiProviderAdapter();
    const options = {
      ...fullProviderExecutionContext,
      reasoningLevel: "none",
    } satisfies ProviderExecutionContext;

    expect(
      adapter.buildCommandPlan({
        type: "thread/start",
        cwd: "/tmp/worktree",
        threadId: "new-thread",
        input: [promptTextInput({ text: "hello" })],
        instructionMode: "append",
        options,
      }),
    ).toMatchObject({
      method: "thread/start",
      params: { reasoningLevel: "off" },
    });
    expect(
      adapter.buildCommandPlan({
        type: "thread/resume",
        cwd: "/tmp/worktree",
        threadId: "bb-thread",
        providerThreadId: "pi-thread",
        instructionMode: "append",
        options,
      }),
    ).toMatchObject({
      method: "thread/resume",
      params: { reasoningLevel: "off" },
    });
    expect(
      adapter.buildCommandPlan({
        type: "thread/fork",
        cwd: "/tmp/worktree",
        threadId: "forked-thread",
        sourceProviderThreadId: "source-thread",
        instructionMode: "append",
        options,
      }),
    ).toMatchObject({
      method: "thread/fork",
      params: { reasoningLevel: "off" },
    });
  });

  it("buildCommand thread/start uses baseInstructions for replace instructions", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "thread/start",
      cwd: "/tmp/worktree",
      threadId: "bb-thread-replace",
      input: [promptTextInput({ text: "hello" })],
      instructionMode: "replace",
      options: {
        ...fullProviderExecutionContext,
        instructions: "Replace the provider prompt.",
      },
    });

    expect(cmd).toMatchObject({
      method: "thread/start",
      params: {
        threadId: "bb-thread-replace",
        baseInstructions: "Replace the provider prompt.",
      },
    });
    expect(cmd).not.toMatchObject({
      params: {
        appendSystemPrompt: expect.any(String),
      },
    });
  });

  it("buildCommand thread/resume routes to provider thread id", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "thread/resume",
      cwd: "/tmp/worktree",
      threadId: "bb-t1",
      providerThreadId: "pi-session-1",
      instructionMode: "append",
      options: fullProviderExecutionContext,
    });
    expect(cmd).toMatchObject({
      method: "thread/resume",
      params: {
        threadId: "pi-session-1",
        cwd: "/tmp/worktree",
      },
    });
  });

  it("buildCommand thread/resume uses appendSystemPrompt for append instructions", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "thread/resume",
      cwd: "/tmp/worktree",
      threadId: "bb-t1",
      providerThreadId: "pi-session-1",
      instructionMode: "append",
      options: {
        ...fullProviderExecutionContext,
        instructions: "Keep responses brief.",
      },
    });
    expect(cmd).toMatchObject({
      method: "thread/resume",
      params: {
        threadId: "pi-session-1",
        appendSystemPrompt: "Keep responses brief.",
      },
    });
    expect(cmd).not.toMatchObject({
      params: {
        baseInstructions: expect.any(String),
      },
    });
  });

  it("buildCommand thread/stop maps to the bridge stop command", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "thread/stop",
      threadId: "bb-t1",
      providerThreadId: "pi-session-1",
      activeTurnId: "turn-1",
    });
    expect(cmd).toEqual({
      kind: "request",
      method: "thread/stop",
      params: {
        threadId: "pi-session-1",
      },
    });
  });

  it("maps the selected compact command turn to the bridge compact command", () => {
    const adapter = createPiProviderAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "turn/start",
        clientRequestId: "creq_222222228c",
        threadId: "bb-t1",
        providerThreadId: "pi-session-1",
        input: createStandaloneBuiltinCompactCommandInput(),
        options: fullProviderExecutionContext,
      }),
    ).toEqual({
      kind: "request",
      method: "thread/compact",
      params: { threadId: "pi-session-1" },
    });
  });

  it("buildCommand thread/discard maps to destructive bridge cleanup", () => {
    const adapter = createPiProviderAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "thread/discard",
        threadId: "bb-staging",
        providerThreadId: "pi-staging",
      }),
    ).toEqual({
      kind: "request",
      method: "thread/discard",
      params: { threadId: "pi-staging" },
    });
  });

  it("buildCommand turn/start includes input", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "turn/start",
      clientRequestId: "creq_222222228c",
      threadId: "t1",
      providerThreadId: "pi-1",
      input: [promptTextInput({ text: "do it" })],
      options: fullProviderExecutionContext,
    });
    expect(cmd).toMatchObject({
      method: "turn/start",
      params: { threadId: "pi-1" },
    });
  });

  it("buildCommand turn/steer includes expectedTurnId", () => {
    const adapter = createPiProviderAdapter();
    const cmd = adapter.buildCommandPlan({
      type: "turn/steer",
      clientRequestId: "creq_222222228d",
      threadId: "t1",
      providerThreadId: "pi-1",
      expectedTurnId: "turn-1",
      input: [promptTextInput({ text: "steer" })],
      options: fullProviderExecutionContext,
    });
    expect(cmd).toMatchObject({
      method: "turn/steer",
      params: {
        threadId: "pi-1",
        expectedTurnId: "turn-1",
      },
    });
  });

  it("buildCommand thread/name/set returns an unsupported no-op", () => {
    const adapter = createPiProviderAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "thread/name/set",
        threadId: "t1",
        providerThreadId: "p1",
        title: "hi",
      }),
    ).toEqual({
      kind: "noop",
      reason: "rename unsupported",
    });
  });

  it("decodeToolCallRequest preserves string request ids", () => {
    const adapter = createPiProviderAdapter();
    expect(
      adapter.decodeToolCallRequest({
        id: "req-1",
        method: "item/tool/call",
        params: {
          threadId: "t1",
          providerThreadId: "t1",
          turnId: "turn-1",
          callId: "call-1",
          tool: "bb_test_ping",
          arguments: { ping: true },
        },
      }),
    ).toEqual({
      requestId: "req-1",
      threadId: "t1",
      providerThreadId: "t1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "bb_test_ping",
      arguments: { ping: true },
    });
  });

  it("decodeToolCallRequest rejects non-string, non-number request ids", () => {
    const adapter = createPiProviderAdapter();
    const malformedRequest = JSON.parse(
      '{"jsonrpc":"2.0","id":true,"method":"item/tool/call","params":{"threadId":"t1","turnId":"turn-1","callId":"call-1","tool":"bb_test_ping","arguments":{"ping":true}}}',
    );

    expect(adapter.decodeToolCallRequest(malformedRequest)).toBeNull();
  });

  // -- translateEvent: turn lifecycle --------------------------------------

  it("translateEvent agent_start emits turn/started", () => {
    const adapter = createPiProviderAdapter();
    const events = adapter.translateEvent(loadFixture("agent-start.json"));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("turn-1"),
      }),
    );
  });

  it("settles accepted input when the prompt resolves before agent_start", () => {
    const adapter = createPiProviderAdapter();
    adapter.translateAcceptedCommand({
      command: {
        type: "turn/start",
        clientRequestId: "creq_222222228e",
        input: [promptTextInput({ text: "/local-extension-command" })],
        options: fullProviderExecutionContext,
        providerThreadId: "pi-session-1",
        threadId: "bb-t1",
      },
    });

    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "pi/prompt/settled",
        params: { threadId: "bb-t1", status: "completed" },
      },
      { threadId: "bb-t1" },
    );

    expect(events.map((event) => event.type)).toEqual([
      "turn/started",
      "turn/input/accepted",
      "turn/completed",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "turn/completed",
      scope: turnScope("turn-1"),
      status: "completed",
    });
  });

  it("translateEvent keeps turn_start as internal noise while agent_start owns the bb turn", () => {
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
      type: "turn_start",
    } as AgentSessionEvent);

    expect(events).toMatchObject([]);
  });

  it("translateEvent agent_end emits agentMessage + turn/completed", () => {
    const adapter = createPiProviderAdapter();
    // Start a turn first
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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

  it("translateEvent agent_end surfaces Pi assistant stop errors as failed turns", () => {
    const adapter = createPiProviderAdapter();
    const context = { threadId: "bb-thread-1" };
    const quotaMessage =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"You\'re out of extra usage. Add more at claude.ai/settings/usage and keep going."},"request_id":"req_011CajgGfxCAhmznZJw7t6Br"}';

    adapter.translateEvent(loadFixture("agent-start.json"), context);

    const events = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();
    const context = { threadId: "bb-thread-1" };
    adapter.translateEvent(loadFixture("agent-start.json"), context);

    const retryEvents = adapter.translateEvent(
      createPiAgentErrorEvent("temporary provider failure", true),
      context,
    );
    const completedEvents = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const event = {
      type: "compaction_start",
      reason: "threshold",
    } satisfies AgentSessionEvent;
    const events = adapter.translateEvent(event);

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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));
    const startEvent = {
      type: "compaction_start",
      reason: "threshold",
    } satisfies AgentSessionEvent;
    adapter.translateEvent(startEvent);

    const endEvent = {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
    } satisfies AgentSessionEvent;
    const events = adapter.translateEvent(endEvent);

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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));
    adapter.translateEvent({
      type: "compaction_start",
      reason: "threshold",
    } satisfies AgentSessionEvent);

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    const context = { threadId: "bb-thread-1" };
    const started = adapter.translateEvent(
      {
        type: "compaction_start",
        reason: "manual",
      } satisfies AgentSessionEvent,
      context,
    );
    const completed = adapter.translateEvent(
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
    {
      label: "failed",
      args: {
        aborted: false,
        errorMessage:
          "Compaction failed: Nothing to compact (session too small)",
      },
      expected: {
        status: "failed",
        error: {
          message: "Compaction failed: Nothing to compact (session too small)",
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
    const adapter = createPiProviderAdapter();
    const event = {
      type: "compaction_end",
      reason: "threshold",
      result: undefined,
      aborted: false,
      willRetry: false,
    } satisfies AgentSessionEvent;

    const events = adapter.translateEvent(event);

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "provider/unhandled",
      }),
    );
  });

  it("translateEvent compaction_start reuses the last completed turn id without opening a new turn", () => {
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));
    adapter.translateEvent(loadFixture("agent-end-with-message.json"));

    const event = {
      type: "compaction_start",
      reason: "threshold",
    } satisfies AgentSessionEvent;
    const events = adapter.translateEvent(event);

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

  // -- translateEvent: streaming -------------------------------------------

  it("translateEvent message_update emits agentMessage delta", () => {
    const adapter = createPiProviderAdapter();
    // Start a turn first
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent(
      loadFixture("message-update-delta.json"),
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "item/agentMessage/delta",
        itemId: expect.stringMatching(/^pi-assistant-/),
        delta: expect.any(String),
      }),
    );
  });

  it("translateEvent reuses the streamed assistant item id when the turn ends", () => {
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const deltaEvents = adapter.translateEvent(
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
    const completedEvents = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    // Stream assistant text before tool call
    const preDelta = adapter.translateEvent(
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
    adapter.translateEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: { command: "ls" },
    });

    // Stream assistant text after tool call
    const postDelta = adapter.translateEvent(
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
    const endEvents = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const deltaEvents = adapter.translateEvent({
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

    const completedEvents = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    // Start a turn first
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    const context = { threadId: "pi-thread-1" };
    adapter.translateEvent(loadFixture("agent-start.json"), context);

    const events = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();
    const context = { threadId: "pi-thread-1" };
    adapter.translateEvent(loadFixture("agent-start.json"), context);
    adapter.translateEvent(loadFixture("agent-end-with-message.json"), context);

    const events = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    // Start a turn first
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    adapter.translateEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: {
        command: "npm test",
        cwd: "/repo",
      },
    } as AgentSessionEvent);

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    adapter.translateEvent({
      type: "tool_execution_start",
      toolCallId: "tool-read-1",
      toolName: "read",
      args: {
        path: "src/app.ts",
        offset: 1,
        limit: 20,
      },
    } as AgentSessionEvent);

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));
    adapter.translateEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: {
        command: "printf 'FIRST\\nSECOND\\n'",
        cwd: "/repo",
      },
    } as AgentSessionEvent);

    const firstEvents = adapter.translateEvent({
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

    const secondEvents = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));
    adapter.translateEvent(
      createPiBashStartEvent({
        toolCallId: "tool-bash-1",
        command: "printf 'FIRST\\nSECOND\\n'",
      }),
    );

    adapter.translateEvent(
      createPiBashUpdateEvent({
        threadId: "pi-thread-1",
        toolCallId: "tool-bash-1",
        text: "FIRST\nSECOND\n",
      }),
    );

    const resetEvents = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    seedPiBashOutputSnapshot({
      adapter,
      context,
      toolCallId: "tool-bash-1",
    });

    expectPiBashSnapshotReset({
      adapter,
      context,
      toolCallId: "tool-bash-1",
      reset: () => {
        adapter.translateEvent(
          loadFixture("agent-end-with-message.json"),
          context,
        );
      },
    });
  });

  it("buildCommand thread/start clears stale bash output snapshots", () => {
    const adapter = createPiProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    seedPiBashOutputSnapshot({
      adapter,
      context,
      toolCallId: "tool-bash-1",
    });

    expectPiBashSnapshotReset({
      adapter,
      context,
      toolCallId: "tool-bash-1",
      reset: () => {
        adapter.buildCommandPlan({
          type: "thread/start",
          cwd: "/tmp/worktree",
          threadId: "bb-thread-1",
          input: [promptTextInput({ text: "hello" })],
          instructionMode: "append",
          options: fullProviderExecutionContext,
        });
      },
    });
  });

  it("buildCommand thread/resume clears stale bash output snapshots", () => {
    const adapter = createPiProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    seedPiBashOutputSnapshot({
      adapter,
      context,
      toolCallId: "tool-bash-1",
    });

    expectPiBashSnapshotReset({
      adapter,
      context,
      toolCallId: "tool-bash-1",
      reset: () => {
        adapter.buildCommandPlan({
          type: "thread/resume",
          cwd: "/tmp/worktree",
          threadId: "bb-thread-1",
          providerThreadId: "pi-thread-1",
          instructionMode: "append",
          options: fullProviderExecutionContext,
        });
      },
    });
  });

  it("buildCommand thread/stop clears stale bash output snapshots", () => {
    const adapter = createPiProviderAdapter();
    const context = { threadId: "bb-thread-1" };

    seedPiBashOutputSnapshot({
      adapter,
      context,
      toolCallId: "tool-bash-1",
    });

    expectPiBashSnapshotReset({
      adapter,
      context,
      toolCallId: "tool-bash-1",
      reset: () => {
        adapter.buildCommandPlan({
          type: "thread/stop",
          threadId: "bb-thread-1",
          providerThreadId: "pi-thread-1",
          activeTurnId: "turn-1",
        });
      },
    });
  });

  it("translateEvent skips empty bash updates with no content", () => {
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();
    adapter.translateEvent(loadFixture("agent-start.json"));
    adapter.translateEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: {
        command: "true",
        cwd: "/repo",
      },
    } as AgentSessionEvent);

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();

    const events = adapter.translateEvent({
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

  // -- translateEvent: multiple turns --------------------------------------

  it("translateEvent increments turn IDs across turns", () => {
    const adapter = createPiProviderAdapter();

    // Turn 1
    adapter.translateEvent(loadFixture("agent-start.json"));
    adapter.translateEvent(loadFixture("agent-end-with-message.json"));

    // Turn 2
    const events = adapter.translateEvent(loadFixture("agent-start.json"));

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "turn/started",
        scope: turnScope("turn-2"),
      }),
    );
  });

  it("translateEvent accumulates Pi token usage across turns", () => {
    const adapter = createPiProviderAdapter({
      resolveModelContextWindow: () => 123_456,
    });

    adapter.translateEvent(loadFixture("agent-start.json"));
    const firstTurnEvents = adapter.translateEvent(
      loadFixture("agent-end-with-message.json"),
    );

    adapter.translateEvent(loadFixture("agent-start.json"));
    const secondTurnEvents = adapter.translateEvent(
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
    const adapter = createPiProviderAdapter();

    adapter.translateEvent(loadFixture("agent-start.json"), {
      threadId: "bb-thread-1",
    });
    adapter.translateEvent(loadFixture("agent-end-with-message.json"), {
      threadId: "bb-thread-1",
    });

    const events = adapter.translateEvent({
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
    const adapter = createPiProviderAdapter();

    adapter.translateEvent(loadFixture("agent-start.json"));
    adapter.translateEvent({
      type: "tool_execution_start",
      toolCallId: "tool-bash-1",
      toolName: "bash",
      args: {
        command: "npm test",
        cwd: "/repo",
      },
    } as AgentSessionEvent);
    adapter.translateEvent(loadFixture("agent-end-with-message.json"));

    adapter.translateEvent(loadFixture("agent-start.json"));
    const events = adapter.translateEvent({
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

  // -- Model catalog -------------------------------------------------------

  it("builds a dynamic model list from the Pi catalog", () => {
    const { models } = buildPiAvailableModels({
      models: [
        {
          id: "claude-sonnet-4",
          name: "Claude Sonnet 4",
          provider: "anthropic",
          reasoning: true,
          input: ["text", "image"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
        {
          id: "codex-mini",
          name: "Codex Mini",
          provider: "openai",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
      ],
    });

    const ids = models.map((model) => model.id);
    expect(ids).toContain("anthropic/claude-sonnet-4");
    expect(ids).toContain("openai/codex-mini");
    expect(ids).not.toContain("google/gemini-2.5-pro");
    expect(models.find((model) => model.isDefault)?.id).toBe(
      "anthropic/claude-sonnet-4",
    );
  });

  it("exposes off as none without changing models that lack off", () => {
    const { models } = buildPiAvailableModels({
      models: [
        {
          id: "kimi-k2.7-code",
          name: "Kimi K2.7 Code",
          provider: "ollama-cloud",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["off", "low", "medium", "high"],
        },
        {
          id: "minimax-m2.7",
          name: "MiniMax M2.7",
          provider: "ollama-cloud",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
        {
          id: "non-reasoning-model",
          name: "Non-reasoning model",
          provider: "custom",
          reasoning: false,
          input: ["text"],
          supportedThinkingLevels: ["off"],
        },
      ],
    });

    expect(
      models[0]?.supportedReasoningEfforts.map(
        ({ reasoningEffort }) => reasoningEffort,
      ),
    ).toEqual(["none", "low", "medium", "high"]);
    expect(
      models[1]?.supportedReasoningEfforts.map(
        ({ reasoningEffort }) => reasoningEffort,
      ),
    ).toEqual(["low", "medium", "high"]);
    expect(models[2]).toMatchObject({
      supportedReasoningEfforts: [{ reasoningEffort: "none" }],
      defaultReasoningEffort: "none",
    });
  });

  it("routes dated Pi versions to the selected-only bucket", () => {
    const { models, selectedOnlyModels } = buildPiAvailableModels({
      models: [
        {
          id: "claude-opus-4-8",
          name: "Claude Opus 4.8",
          provider: "anthropic",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high", "xhigh"],
        },
        {
          id: "claude-opus-4-6-20240620",
          name: "Claude Opus 4.6 (2024-06-20)",
          provider: "anthropic",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
      ],
    });

    expect(models.map((model) => model.id)).toEqual([
      "anthropic/claude-opus-4-8",
    ]);
    expect(selectedOnlyModels.map((model) => model.id)).toEqual([
      "anthropic/claude-opus-4-6-20240620",
    ]);
    expect(selectedOnlyModels[0]).toEqual(
      expect.objectContaining({
        displayName: "Claude Opus 4.6 (2024-06-20)",
        isDefault: false,
      }),
    );
  });

  it("keeps the provider prefix on aggregator models whose id has a slash", () => {
    // OpenRouter and the Vercel AI Gateway name a model after the vendor that
    // serves it. Without the prefix the id collides with the direct provider.
    const { models } = buildPiAvailableModels({
      models: [
        {
          id: "deepseek/deepseek-v4-flash-0731",
          name: "DeepSeek V4 Flash",
          provider: "openrouter",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
        {
          id: "openai/gpt-5.1-codex",
          name: "GPT-5.1 Codex",
          provider: "openrouter",
          reasoning: true,
          input: ["text"],
          supportedThinkingLevels: ["low", "medium", "high"],
        },
        {
          id: "accounts/fireworks/models/deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          provider: "fireworks",
          reasoning: false,
          input: ["text"],
          supportedThinkingLevels: [],
        },
      ],
    });

    expect(models.map((model) => model.id)).toEqual([
      "openrouter/deepseek/deepseek-v4-flash-0731",
      "openrouter/openai/gpt-5.1-codex",
      "fireworks/accounts/fireworks/models/deepseek-v4-flash",
    ]);
    // The per-provider default is itself a slashed id, so it only matches once
    // the prefix survives.
    expect(models.find((model) => model.isDefault)?.id).toBe(
      "openrouter/openai/gpt-5.1-codex",
    );
  });

  it("reads the context window of the provider that served the message", () => {
    // Pi's catalog holds 134 of these pairs, and the two sides disagree on the
    // window often enough to matter for compaction.
    const resolveContextWindow = createPiModelContextWindowResolverFrom([
      {
        id: "deepseek/deepseek-v4-flash",
        provider: "openrouter",
        contextWindow: 1_048_575,
      },
      {
        id: "deepseek-v4-flash",
        provider: "deepseek",
        contextWindow: 1_000_000,
      },
    ]);

    const assistant = (provider: string | undefined, model: string) => ({
      role: "assistant" as const,
      content: [],
      ...(provider === undefined ? {} : { provider }),
      model,
    });

    expect(
      resolveContextWindow(
        assistant("openrouter", "deepseek/deepseek-v4-flash"),
      ),
    ).toBe(1_048_575);
    expect(
      resolveContextWindow(assistant("deepseek", "deepseek-v4-flash")),
    ).toBe(1_000_000);
    // Without a provider only the model id is left to match on.
    expect(
      resolveContextWindow(assistant(undefined, "deepseek-v4-flash")),
    ).toBe(1_000_000);
    expect(resolveContextWindow(assistant("openrouter", "unknown"))).toBeNull();
    // A known provider that the catalog does not cover reports nothing rather
    // than borrowing the window another provider published for the same id.
    // The network refresh and custom models both produce this case.
    expect(
      resolveContextWindow(assistant("openrouter", "deepseek-v4-flash")),
    ).toBeNull();
  });
});
