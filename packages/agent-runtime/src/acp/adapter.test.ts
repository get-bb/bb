import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  threadScope,
  turnScope,
} from "@bb/domain";
import type { ProviderExecutionContext } from "../provider-adapter.js";
import { promptTextInput } from "../test/prompt-input.js";
import { createAcpProviderAdapter } from "./adapter.js";
import { getAcpAgentProfile } from "./profiles.js";

const fullProviderExecutionContext = {
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  permissionMode: "full",
  permissionEscalation: null,
  workflowsEnabled: false,
} satisfies ProviderExecutionContext;

type AcpProviderAdapter = ReturnType<typeof createAcpProviderAdapter>;

function createAdapter(): AcpProviderAdapter {
  return createAcpProviderAdapter({
    profile: getAcpAgentProfile("acp-cursor"),
    additionalWorkspaceWriteRoots: ["/extra-root"],
  });
}

const CURSOR_LIST_COMMAND = { command: "agent", args: ["--list-models"] };

const THREAD_CONTEXT = { threadId: "thread-1" };

function updateNotification(update: Record<string, unknown>) {
  return {
    jsonrpc: "2.0" as const,
    method: "acp/update",
    params: { threadId: "thread-1", update },
  };
}

function startTurn(adapter: AcpProviderAdapter) {
  return adapter.translateEvent(
    {
      jsonrpc: "2.0",
      method: "acp/turn/started",
      params: { threadId: "thread-1" },
    },
    THREAD_CONTEXT,
  );
}

function countChangedLines(diff: string | undefined): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const line of diff?.split("\n") ?? []) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

describe("acp adapter command plans", () => {
  it("builds thread/start with agent command, policy, and write roots", () => {
    const adapter = createAdapter();
    const plan = adapter.buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        permissionMode: "workspace-write",
        permissionEscalation: "ask",
        instructions: "Stay focused.",
        envVars: { BB_THREAD_ID: "thread-1" },
      },
      instructionMode: "append",
    });

    expect(plan).toEqual({
      kind: "request",
      method: "thread/start",
      params: {
        threadId: "thread-1",
        cwd: "/workspace",
        agent: { command: "agent", args: ["acp"] },
        permissionMode: "workspace-write",
        permissionEscalation: "ask",
        workspaceWriteRoots: ["/workspace", "/extra-root"],
        envVars: { BB_THREAD_ID: "thread-1" },
        instructions: "Stay focused.",
      },
    });
  });

  it("builds thread/resume with the provider thread id", () => {
    const adapter = createAdapter();
    const plan = adapter.buildCommandPlan({
      type: "thread/resume",
      threadId: "thread-1",
      providerThreadId: "sess-1",
      cwd: "/workspace",
      options: fullProviderExecutionContext,
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      kind: "request",
      method: "thread/resume",
      params: { providerThreadId: "sess-1", cwd: "/workspace" },
    });
  });

  it("routes turns by provider thread id", () => {
    const adapter = createAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "turn/start",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        input: [promptTextInput({ text: "hi" })],
        clientRequestId: "creq_23456789ad",
        options: fullProviderExecutionContext,
      }),
    ).toMatchObject({
      kind: "request",
      method: "turn/start",
      params: { threadId: "sess-1" },
    });
    expect(
      adapter.buildCommandPlan({
        type: "turn/steer",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        expectedTurnId: "turn-1",
        input: [promptTextInput({ text: "also this" })],
        clientRequestId: "creq_23456789ae",
        options: fullProviderExecutionContext,
      }),
    ).toMatchObject({
      kind: "request",
      method: "turn/steer",
      params: { threadId: "sess-1", expectedTurnId: "turn-1" },
    });
    expect(
      adapter.buildCommandPlan({
        type: "thread/stop",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        activeTurnId: "turn-1",
      }),
    ).toMatchObject({
      kind: "request",
      method: "thread/stop",
      params: { threadId: "sess-1" },
    });
  });

  it("declares rename/archive as noops", () => {
    const adapter = createAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "thread/name/set",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        title: "Title",
      }).kind,
    ).toBe("noop");
    expect(
      adapter.buildCommandPlan({
        type: "thread/archive",
        threadId: "thread-1",
        providerThreadId: "sess-1",
      }).kind,
    ).toBe("noop");
  });

  it("rejects dynamic tools", () => {
    const adapter = createAdapter();
    expect(() =>
      adapter.buildCommandPlan({
        type: "thread/start",
        threadId: "thread-1",
        cwd: "/workspace",
        options: fullProviderExecutionContext,
        instructionMode: "append",
        dynamicTools: [
          { name: "ask", description: "ask", inputSchema: { type: "object" } },
        ],
      }),
    ).toThrow(/does not support dynamic tools/);
  });
});

describe("acp adapter model cli", () => {
  it("requests the profile's model list command with its primary families", () => {
    const plan = createAdapter().buildCommandPlan({ type: "model/list" });
    expect(plan).toMatchObject({
      kind: "request",
      method: "model/list",
      params: { listCommand: CURSOR_LIST_COMMAND },
    });
    const params = (plan as { params: Record<string, unknown> }).params;
    const primaryModels = params.primaryModels as string[];
    expect(primaryModels).toContain("auto");
    expect(primaryModels.length).toBeGreaterThan(1);
  });

  it("forwards the session model and reasoning level for bridge resolution", () => {
    const plan = createAdapter().buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: {
        ...fullProviderExecutionContext,
        model: "gpt-5.3-codex",
        reasoningLevel: "high",
      },
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      params: {
        agent: { command: "agent", args: ["acp"] },
        modelSelection: {
          listCommand: CURSOR_LIST_COMMAND,
          selectFlag: "--model",
          model: "gpt-5.3-codex",
          reasoningLevel: "high",
        },
      },
    });
  });

  it("omits the reasoning level when the session has none", () => {
    const plan = createAdapter().buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: { ...fullProviderExecutionContext, model: "gpt-5.3-codex" },
      instructionMode: "append",
    });
    expect(plan).toMatchObject({
      params: {
        modelSelection: { model: "gpt-5.3-codex" },
      },
    });
    const params = (plan as { params: Record<string, unknown> }).params;
    const selection = params.modelSelection as Record<string, unknown>;
    expect("reasoningLevel" in selection).toBe(false);
  });

  it("never forwards the synthetic default model id", () => {
    const plan = createAdapter().buildCommandPlan({
      type: "thread/start",
      threadId: "thread-1",
      cwd: "/workspace",
      options: { ...fullProviderExecutionContext, model: "acp-default" },
      instructionMode: "append",
    });
    const params = (plan as { params: Record<string, unknown> }).params;
    expect("modelSelection" in params).toBe(false);
    expect(params.agent).toEqual({ command: "agent", args: ["acp"] });
  });
});

describe("acp adapter event translation", () => {
  it("translates thread identity", () => {
    const adapter = createAdapter();
    expect(
      adapter.translateEvent({
        jsonrpc: "2.0",
        method: "thread/identity",
        params: { threadId: "thread-1", providerThreadId: "sess-1" },
      }),
    ).toEqual([
      {
        type: "thread/identity",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        scope: threadScope(),
      },
    ]);
  });

  it("streams agent message chunks and completes the turn", () => {
    const adapter = createAdapter();
    const startedEvents = startTurn(adapter);
    expect(startedEvents).toEqual([
      {
        type: "turn/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
      },
    ]);

    const deltaEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello " },
      }),
      THREAD_CONTEXT,
    );
    expect(deltaEvents).toEqual([
      {
        type: "item/agentMessage/delta",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        itemId: "acp-assistant-1",
        delta: "Hello ",
      },
    ]);
    adapter.translateEvent(
      updateNotification({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "world" },
      }),
      THREAD_CONTEXT,
    );

    const completedEvents = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/turn/completed",
        params: { threadId: "thread-1", stopReason: "end_turn" },
      },
      THREAD_CONTEXT,
    );
    expect(completedEvents).toEqual([
      {
        type: "item/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "agentMessage",
          id: "acp-assistant-1",
          text: "Hello world",
        },
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

  it("accumulates thought chunks into a reasoning item", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const thoughtEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Considering..." },
      }),
      THREAD_CONTEXT,
    );
    expect(thoughtEvents).toEqual([
      {
        type: "item/reasoning/textDelta",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        itemId: "acp-reasoning-1",
        delta: "Considering...",
      },
    ]);

    // The first message chunk closes the open thought item.
    const messageEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Answer" },
      }),
      THREAD_CONTEXT,
    );
    expect(messageEvents[0]).toEqual({
      type: "item/completed",
      threadId: "",
      providerThreadId: "",
      scope: turnScope("turn-1"),
      item: {
        type: "reasoning",
        id: "acp-reasoning-1",
        summary: [],
        content: ["Considering..."],
      },
    });
  });

  it("translates execute tool calls into command executions", () => {
    const adapter = createAdapter();
    startTurn(adapter);

    const startedEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call",
        toolCallId: "call-1",
        title: "Run tests",
        kind: "execute",
        status: "in_progress",
        rawInput: { command: "pnpm test" },
      }),
      THREAD_CONTEXT,
    );
    expect(startedEvents).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "commandExecution",
          id: "call-1",
          command: "pnpm test",
          cwd: "",
          status: "pending",
          approvalStatus: null,
        },
      },
    ]);

    const completedEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-1",
        status: "completed",
        content: [
          { type: "content", content: { type: "text", text: "1 passed" } },
        ],
      }),
      THREAD_CONTEXT,
    );
    expect(completedEvents).toEqual([
      {
        type: "item/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "commandExecution",
          id: "call-1",
          command: "pnpm test",
          cwd: "",
          status: "completed",
          approvalStatus: null,
          aggregatedOutput: "1 passed",
          exitCode: 0,
        },
      },
    ]);
  });

  it("translates diff tool calls into file changes", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const events = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call",
        toolCallId: "call-2",
        title: "Edit file",
        kind: "edit",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/workspace/a.ts",
            oldText: "same\nold line\nsame\n",
            newText: "same\nnew line\nsame\n",
          },
        ],
      }),
      THREAD_CONTEXT,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        id: "call-2",
        status: "completed",
        changes: [{ path: "/workspace/a.ts", kind: "update" }],
      },
    });
    const change = events[0]?.type === "item/completed" &&
      events[0].item.type === "fileChange"
      ? events[0].item.changes[0]
      : undefined;
    expect(change?.diff).toContain("-old line");
    expect(change?.diff).toContain("+new line");
    expect(change?.diff).not.toContain("-same");
    expect(change?.diff).not.toContain("+same");
    expect(countChangedLines(change?.diff)).toEqual({ added: 1, removed: 1 });
  });

  it("tracks Cursor edit calls as file changes before the final diff arrives", () => {
    const adapter = createAdapter();
    startTurn(adapter);

    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "tool_call",
          toolCallId: "call-edit",
          title: "Edit file",
          kind: "edit",
          status: "in_progress",
          locations: [{ path: "/workspace/a.ts" }],
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "fileChange",
          id: "call-edit",
          changes: [{ path: "/workspace/a.ts", kind: "update" }],
          status: "pending",
          approvalStatus: null,
        },
      },
    ]);

    const completedEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-edit",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/workspace/a.ts",
            oldText: "before\n",
            newText: "after\n",
          },
        ],
      }),
      THREAD_CONTEXT,
    );

    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]).toMatchObject({
      type: "item/completed",
      item: {
        type: "fileChange",
        id: "call-edit",
        status: "completed",
        changes: [{ path: "/workspace/a.ts", kind: "update" }],
      },
    });
    const change =
      completedEvents[0]?.type === "item/completed" &&
      completedEvents[0].item.type === "fileChange"
        ? completedEvents[0].item.changes[0]
        : undefined;
    expect(countChangedLines(change?.diff)).toEqual({ added: 1, removed: 1 });
  });

  it("settles a started generic ACP edit when completion is a file change", () => {
    const adapter = createAdapter();
    startTurn(adapter);

    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "tool_call",
          toolCallId: "call-late-diff",
          title: "Edit file",
          kind: "edit",
          status: "in_progress",
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "item/started",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "toolCall",
          id: "call-late-diff",
          tool: "Edit file",
          status: "pending",
        },
      },
    ]);

    const completedEvents = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "tool_call_update",
        toolCallId: "call-late-diff",
        status: "completed",
        content: [
          {
            type: "diff",
            path: "/workspace/a.ts",
            oldText: "before\n",
            newText: "after\n",
          },
        ],
      }),
      THREAD_CONTEXT,
    );

    expect(completedEvents).toMatchObject([
      {
        type: "item/completed",
        item: {
          type: "toolCall",
          id: "call-late-diff",
          tool: "Edit file",
          status: "completed",
        },
      },
      {
        type: "item/completed",
        item: {
          type: "fileChange",
          id: "call-late-diff",
          status: "completed",
          changes: [{ path: "/workspace/a.ts", kind: "update" }],
        },
      },
    ]);
  });

  it("translates plan updates", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const events = adapter.translateEvent(
      updateNotification({
        sessionUpdate: "plan",
        entries: [
          { content: "Read files", status: "completed" },
          { content: "Fix bug", status: "in_progress" },
          { content: "Run tests", status: "pending" },
        ],
      }),
      THREAD_CONTEXT,
    );
    expect(events).toEqual([
      {
        type: "turn/plan/updated",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        plan: [
          { step: "Read files", status: "completed" },
          { step: "Fix bug", status: "active" },
          { step: "Run tests", status: "pending" },
        ],
      },
    ]);
  });

  it("translates bridge fs writes into completed file changes", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/fs/write",
        params: {
          threadId: "thread-1",
          path: "/workspace/new.ts",
          kind: "add",
          diff: "--- /dev/null\n+++ b/workspace/new.ts\n+hi\n",
        },
      },
      THREAD_CONTEXT,
    );
    expect(events).toEqual([
      {
        type: "item/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        item: {
          type: "fileChange",
          id: "acp-fs-write-1",
          changes: [
            {
              path: "/workspace/new.ts",
              kind: "add",
              diff: "--- /dev/null\n+++ b/workspace/new.ts\n+hi\n",
            },
          ],
          status: "completed",
          approvalStatus: null,
        },
      },
    ]);
  });

  it("translates bridge warnings", () => {
    const adapter = createAdapter();
    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "acp/warning",
        params: { threadId: "thread-1", summary: "History not restored" },
      },
      THREAD_CONTEXT,
    );
    expect(events).toEqual([
      {
        type: "provider/warning",
        threadId: "",
        providerThreadId: "",
        scope: threadScope(),
        category: "general",
        summary: "History not restored",
      },
    ]);
  });

  it("fails the open turn on bridge errors", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "error",
        params: { threadId: "thread-1", message: "agent exploded" },
      },
      THREAD_CONTEXT,
    );
    expect(events).toEqual([
      {
        type: "provider/error",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        message: "Provider error",
        detail: "agent exploded",
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

  it("marks cancelled turns interrupted and refusals failed", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    expect(
      adapter.translateEvent(
        {
          jsonrpc: "2.0",
          method: "acp/turn/completed",
          params: { threadId: "thread-1", stopReason: "cancelled" },
        },
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-1"),
        status: "interrupted",
      },
    ]);

    startTurn(adapter);
    expect(
      adapter.translateEvent(
        {
          jsonrpc: "2.0",
          method: "acp/turn/completed",
          params: { threadId: "thread-1", stopReason: "refusal" },
        },
        THREAD_CONTEXT,
      ),
    ).toEqual([
      {
        type: "turn/completed",
        threadId: "",
        providerThreadId: "",
        scope: turnScope("turn-2"),
        status: "failed",
        error: { message: "Agent stopped the turn: refusal" },
      },
    ]);
  });

  it("drops noise updates and reports unknown updates", () => {
    const adapter = createAdapter();
    startTurn(adapter);
    expect(
      adapter.translateEvent(
        updateNotification({
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "replayed" },
        }),
        THREAD_CONTEXT,
      ),
    ).toEqual([]);
    expect(
      adapter.translateEvent(
        updateNotification({ sessionUpdate: "totally_new_update" }),
        THREAD_CONTEXT,
      ),
    ).toMatchObject([
      { type: "provider/unhandled", rawType: "acp/update:totally_new_update" },
    ]);
  });

  it("emits accepted user message events when the turn starts", () => {
    const adapter = createAdapter();
    const accepted = adapter.translateAcceptedCommand({
      command: {
        type: "turn/start",
        threadId: "thread-1",
        providerThreadId: "sess-1",
        input: [promptTextInput({ text: "hi" })],
        clientRequestId: "creq_23456789ad",
        options: fullProviderExecutionContext,
      },
    });
    expect(accepted).toEqual([]);

    const startedEvents = startTurn(adapter);
    expect(startedEvents).toEqual([
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
        clientRequestId: "creq_23456789ad",
      },
    ]);
  });
});

describe("acp adapter interactive requests", () => {
  it("decodes execute permission requests as command approvals", () => {
    const adapter = createAdapter();
    const decoded = adapter.decodeInteractiveRequest?.({
      id: 7,
      method: "acp/permission/request",
      params: {
        threadId: "thread-1",
        providerThreadId: "sess-1",
        turnId: null,
        toolCall: {
          toolCallId: "call-1",
          title: "Run tests",
          kind: "execute",
          command: "pnpm test",
        },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "always", name: "Always", kind: "allow_always" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    });
    expect(decoded).toEqual({
      requestId: 7,
      method: "acp/permission/request",
      threadId: "thread-1",
      providerThreadId: "sess-1",
      turnId: null,
      payload: {
        kind: "approval",
        subject: {
          kind: "command",
          itemId: "call-1",
          command: "pnpm test",
          cwd: null,
          actions: [{ type: "unknown", command: "pnpm test" }],
          sessionGrant: null,
        },
        reason: null,
        availableDecisions: ["allow_once", "allow_for_session", "deny"],
      },
    });
  });

  it("decodes non-execute permission requests as permission grants", () => {
    const adapter = createAdapter();
    const decoded = adapter.decodeInteractiveRequest?.({
      id: 8,
      method: "acp/permission/request",
      params: {
        threadId: "thread-1",
        providerThreadId: "sess-1",
        turnId: null,
        toolCall: { toolCallId: "call-2", title: "Fetch docs", kind: "fetch" },
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_always" },
        ],
      },
    });
    expect(decoded?.payload).toEqual({
      kind: "approval",
      subject: {
        kind: "permission_grant",
        itemId: "call-2",
        toolName: "Fetch docs",
        permissions: { network: null, fileSystem: null },
      },
      reason: null,
      availableDecisions: ["allow_once", "deny"],
    });
  });

  it("encodes resolutions as bare decisions for the bridge", () => {
    const adapter = createAdapter();
    const decoded = adapter.decodeInteractiveRequest?.({
      id: 9,
      method: "acp/permission/request",
      params: {
        threadId: "thread-1",
        providerThreadId: "sess-1",
        turnId: null,
        options: [
          { optionId: "allow", name: "Allow", kind: "allow_once" },
          { optionId: "deny", name: "Deny", kind: "reject_once" },
        ],
      },
    });
    if (!decoded) {
      throw new Error("expected decoded interactive request");
    }
    expect(
      adapter.buildInteractiveResponse?.({
        request: decoded,
        resolution: { decision: "deny" },
      }),
    ).toEqual({ decision: "deny" });
    expect(
      adapter.buildInteractiveResponse?.({
        request: decoded,
        resolution: { decision: "allow_once", grantedPermissions: null },
      }),
    ).toEqual({ decision: "allow_once" });
  });

  it("ignores unrelated provider requests", () => {
    const adapter = createAdapter();
    expect(
      adapter.decodeInteractiveRequest?.({
        id: 1,
        method: "something/else",
        params: {},
      }),
    ).toBeNull();
  });
});

describe("acp adapter model list", () => {
  it("parses the bridge's synthetic model list", () => {
    const adapter = createAdapter();
    const parsed = adapter.parseModelListResult({
      models: [
        {
          id: "acp-default",
          model: "acp-default",
          displayName: "Agent default",
          description: "Model selection is managed by the connected ACP agent.",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "Managed by the agent." },
          ],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
      selectedOnlyModels: [],
    });
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models[0]?.isDefault).toBe(true);
    expect(parsed.selectedOnlyModels).toEqual([]);
  });
});
