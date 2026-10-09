import { describe, expect, it } from "vitest";
import {
  ACP_LEGACY_MODEL_CONFIG_ID,
  ACP_LEGACY_MODE_CONFIG_ID,
} from "./decode.js";
import { createAcpSessionModel } from "./session-model.js";
import type { AcpSessionEvent } from "./session-types.js";

function model(generation: 1 | 2 = 1) {
  return createAcpSessionModel({ generation });
}

function eventTypes(events: AcpSessionEvent[]): string[] {
  return events.map((event) => event.type);
}

function agentChunk(text: string, messageId?: string) {
  return {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
    ...(messageId !== undefined ? { messageId } : {}),
  };
}

describe("work state on a v1 connection", () => {
  it("follows the prompt request from running to idle with its stop reason", () => {
    const session = model();
    const started = session.promptSubmitted();
    expect(started).toMatchObject([
      { type: "work", work: { state: "running", initiator: "client" } },
    ]);
    expect(eventTypes(session.applySessionUpdate(agentChunk("hi")))).toEqual([
      "message",
    ]);
    const settled = session.promptSettled({ stopReason: "max_tokens" });
    expect(settled).toMatchObject([
      {
        type: "work",
        previous: { state: "running" },
        work: { state: "idle", stopReason: "max_tokens", error: null },
      },
    ]);
  });

  it("reports a failed prompt as an idle state with the error stop reason", () => {
    const session = model();
    session.promptSubmitted();
    const settled = session.promptSettled({
      error: { code: -32000, message: "Authentication required" },
    });
    expect(settled).toMatchObject([
      {
        work: {
          state: "idle",
          stopReason: "error",
          error: { code: -32000, message: "Authentication required" },
        },
      },
    ]);
  });

  it("treats output that arrives while idle as work the agent started", () => {
    const session = model();
    const events = session.applySessionUpdate(agentChunk("background done"));
    expect(events).toMatchObject([
      { type: "work", work: { state: "running", initiator: "agent" } },
      { type: "message", change: "appended" },
    ]);
    expect(session.applySessionUpdate(agentChunk(" more"))).toHaveLength(1);
    expect(session.agentWorkSettled("end_turn")).toMatchObject([
      { type: "work", work: { state: "idle", stopReason: "end_turn" } },
    ]);
    expect(session.agentWorkSettled("end_turn")).toEqual([]);
  });

  it("does not start agent work for bookkeeping updates while idle", () => {
    const session = model();
    const updates = [
      { sessionUpdate: "available_commands_update", availableCommands: [] },
      { sessionUpdate: "session_info_update", title: "Renamed" },
      { sessionUpdate: "usage_update", used: 1, size: 2 },
      { sessionUpdate: "plan", entries: [] },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "late",
        status: "completed",
      },
    ];
    session.applySessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "late",
      title: "Background job",
      status: "in_progress",
    });
    session.agentWorkSettled("end_turn");
    for (const update of updates) {
      const events = session.applySessionUpdate(update);
      expect(eventTypes(events)).not.toContain("work");
    }
    expect(session.snapshot().work.state).toBe("idle");
  });

  it("enters requires_action for a permission request and returns when it resolves", () => {
    const session = model();
    session.promptSubmitted();
    expect(session.actionRequested("permission-1")).toMatchObject([
      { work: { state: "requires_action", initiator: "client" } },
    ]);
    session.actionRequested("permission-2");
    expect(session.actionResolved("permission-1")).toEqual([]);
    expect(session.actionResolved("permission-2")).toMatchObject([
      { work: { state: "running" } },
    ]);
  });

  it("surfaces a permission request that arrives with no prompt in flight", () => {
    const session = model();
    expect(session.actionRequested("permission-1")).toMatchObject([
      { work: { state: "requires_action", initiator: "agent" } },
    ]);
    expect(session.actionResolved("permission-1")).toMatchObject([
      { work: { state: "running", initiator: "agent" } },
    ]);
  });

  it("hands agent-started work over to a prompt submitted on top of it", () => {
    const session = model();
    session.applySessionUpdate(agentChunk("working"));
    expect(session.promptSubmitted()).toMatchObject([
      { work: { state: "running", initiator: "client" } },
    ]);
    expect(session.promptSettled({ stopReason: "end_turn" })).toMatchObject([
      { work: { state: "idle" } },
    ]);
  });

  it("keeps replayed history out of the work state and flags its events", () => {
    const session = model();
    session.beginReplay();
    const events = session.applySessionUpdate({
      sessionUpdate: "user_message_chunk",
      content: { type: "text", text: "earlier question" },
    });
    expect(events).toMatchObject([{ type: "message", replay: true }]);
    session.endReplay();
    expect(session.snapshot().work.state).toBe("idle");
  });

  it("does not treat state_update as known on a v1 connection", () => {
    const events = model().applySessionUpdate({
      sessionUpdate: "state_update",
      state: "running",
    });
    expect(events).toMatchObject([
      { type: "unhandled", reason: "unknown-variant" },
    ]);
  });
});

describe("work state on a v2 connection", () => {
  it("is driven by state_update and ignores prompt bookkeeping", () => {
    const session = model(2);
    expect(session.promptSubmitted()).toEqual([]);
    expect(
      session.applySessionUpdate({
        sessionUpdate: "state_update",
        state: "running",
      }),
    ).toMatchObject([{ work: { state: "running" } }]);
    expect(session.promptSettled({ stopReason: "end_turn" })).toEqual([]);
    expect(session.applySessionUpdate(agentChunk("x", "m1"))).toHaveLength(1);
    expect(
      session.applySessionUpdate({
        sessionUpdate: "state_update",
        state: "idle",
        stopReason: "error",
        error: { code: -32603, message: "boom" },
      }),
    ).toMatchObject([
      {
        work: {
          state: "idle",
          stopReason: "error",
          error: { code: -32603, message: "boom" },
        },
      },
    ]);
  });
});

describe("messages", () => {
  it("groups chunks without ids into one message per run of a role", () => {
    const session = model();
    session.promptSubmitted();
    const ids = [
      session.applySessionUpdate({
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "thinking" },
      }),
      session.applySessionUpdate(agentChunk("a")),
      session.applySessionUpdate(agentChunk("b")),
      session.applySessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "Read",
      }),
      session.applySessionUpdate(agentChunk("c")),
    ]
      .flat()
      .flatMap((event) => (event.type === "message" ? [event.messageId] : []));
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[3]).not.toBe(ids[2]);
    expect(session.snapshot().messages.map((m) => m.content.length)).toEqual([
      1, 2, 1,
    ]);
  });

  it("uses the agent's message id when it sends one", () => {
    const session = model();
    session.promptSubmitted();
    session.applySessionUpdate(agentChunk("a", "msg-1"));
    session.applySessionUpdate(agentChunk("b", "msg-2"));
    session.applySessionUpdate(agentChunk("c", "msg-1"));
    expect(
      session.snapshot().messages.map((m) => [m.messageId, m.content.length]),
    ).toEqual([
      ["msg-1", 2],
      ["msg-2", 1],
    ]);
  });

  it("keeps content blocks it does not understand instead of dropping them", () => {
    const session = model();
    session.promptSubmitted();
    const events = session.applySessionUpdate({
      sessionUpdate: "agent_message_chunk",
      content: { type: "hologram", url: "x", extra: 1 },
    });
    expect(events).toMatchObject([
      { appended: [{ type: "hologram", url: "x", extra: 1 }] },
    ]);
  });

  it("applies v2 whole-message upserts: replace, keep, then clear", () => {
    const session = model(2);
    session.applySessionUpdate(agentChunk("draft", "m1"));
    const replaced = session.applySessionUpdate({
      sessionUpdate: "agent_message",
      messageId: "m1",
      content: [{ type: "text", text: "final" }],
    });
    expect(replaced).toMatchObject([
      { change: "replaced", content: [{ type: "text", text: "final" }] },
    ]);
    const kept = session.applySessionUpdate({
      sessionUpdate: "agent_message",
      messageId: "m1",
    });
    expect(kept).toMatchObject([{ content: [{ text: "final" }] }]);
    const cleared = session.applySessionUpdate({
      sessionUpdate: "agent_message",
      messageId: "m1",
      content: null,
    });
    expect(cleared).toMatchObject([{ content: [] }]);
  });

  it("reports a chunk with no usable content as malformed, with the raw payload", () => {
    const raw = { sessionUpdate: "agent_message_chunk", content: "text" };
    expect(model().applySessionUpdate(raw)).toEqual([
      {
        type: "unhandled",
        replay: false,
        reason: "malformed",
        sessionUpdate: "agent_message_chunk",
        raw,
      },
    ]);
  });
});

describe("tool calls", () => {
  it("merges updates into the call and reports which fields changed", () => {
    const session = model();
    session.promptSubmitted();
    const created = session.applySessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "run_terminal_command",
      rawInput: { command: "echo hi" },
      _meta: { "x.ai/tool": { kind: "execute" } },
    });
    expect(created).toMatchObject([
      {
        type: "toolCall",
        created: true,
        toolCall: { status: "pending", title: "run_terminal_command" },
      },
    ]);
    const updated = session.applySessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      kind: "execute",
      title: "Execute `echo hi`",
      status: "in_progress",
      locations: [{ path: "notes.txt" }, { line: 3 }],
      rawOutput: null,
    });
    expect(updated).toMatchObject([
      {
        created: false,
        updated: ["title", "kind", "status", "locations"],
        toolCall: {
          title: "Execute `echo hi`",
          kind: "execute",
          status: "in_progress",
          locations: [{ path: "notes.txt" }],
          rawInput: { command: "echo hi" },
          meta: { "x.ai/tool": { kind: "execute" } },
        },
      },
    ]);
  });

  it("keeps kinds and statuses outside the v1 enums", () => {
    const session = model();
    session.promptSubmitted();
    const events = session.applySessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "x",
      kind: "browse",
      status: "cancelled",
    });
    expect(events).toMatchObject([
      { toolCall: { kind: "browse", status: "cancelled" } },
    ]);
  });

  it("creates a call from an update for an id it has not seen", () => {
    const events = model().applySessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "orphan",
      status: "in_progress",
    });
    expect(events).toMatchObject([
      { type: "work" },
      { type: "toolCall", created: true, toolCall: { title: "" } },
    ]);
  });

  it("leaves a field alone on null in v1 and clears it in v2", () => {
    const patch = {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      kind: null,
      content: null,
    };
    const create = {
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      title: "Edit",
      kind: "edit",
      content: [{ type: "diff", path: "/a", newText: "b" }],
    };
    const v1 = model(1);
    v1.applySessionUpdate(create);
    expect(v1.applySessionUpdate(patch).at(-1)).toMatchObject({
      updated: [],
      toolCall: { kind: "edit", content: [{ type: "diff" }] },
    });
    const v2 = model(2);
    v2.applySessionUpdate(create);
    const cleared = v2.applySessionUpdate(patch).at(-1);
    expect(cleared).toMatchObject({ updated: ["kind", "content"] });
    expect(cleared).toMatchObject({ toolCall: { content: [] } });
    expect(
      cleared?.type === "toolCall" ? "kind" in cleared.toolCall : true,
    ).toBe(false);
  });

  it("appends v2 content chunks to the call", () => {
    const session = model(2);
    session.applySessionUpdate({
      sessionUpdate: "tool_call_update",
      toolCallId: "t1",
      title: "Search",
    });
    session.applySessionUpdate({
      sessionUpdate: "tool_call_content_chunk",
      toolCallId: "t1",
      content: { type: "content", content: { type: "text", text: "one" } },
    });
    const events = session.applySessionUpdate({
      sessionUpdate: "tool_call_content_chunk",
      toolCallId: "t1",
      content: { type: "content", content: { type: "text", text: "two" } },
    });
    expect(events.at(-1)).toMatchObject({
      toolCall: { content: [{ type: "content" }, { type: "content" }] },
    });
  });

  it("marks unfinished calls when asked and leaves finished ones alone", () => {
    const session = model();
    session.promptSubmitted();
    for (const [toolCallId, status] of [
      ["open", "in_progress"],
      ["done", "completed"],
    ]) {
      session.applySessionUpdate({
        sessionUpdate: "tool_call",
        toolCallId,
        title: toolCallId,
        status,
      });
    }
    expect(session.closeUnfinishedToolCalls("cancelled")).toMatchObject([
      { toolCall: { toolCallId: "open", status: "cancelled" } },
    ]);
  });

  it("drops finished calls and messages when the next prompt starts, keeping open calls", () => {
    const session = model();
    session.promptSubmitted();
    session.applySessionUpdate(agentChunk("text"));
    session.applySessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "background",
      title: "Background",
      status: "in_progress",
    });
    session.applySessionUpdate({
      sessionUpdate: "tool_call",
      toolCallId: "finished",
      title: "Finished",
      status: "completed",
    });
    session.promptSettled({ stopReason: "end_turn" });
    session.promptSubmitted();
    const snapshot = session.snapshot();
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.toolCalls.map((call) => call.toolCallId)).toEqual([
      "background",
    ]);
  });
});

describe("plans", () => {
  it("replaces the plan and keeps priorities and unknown statuses", () => {
    const session = model();
    session.applySessionUpdate({
      sessionUpdate: "plan",
      entries: [{ content: "a", priority: "high", status: "pending" }],
    });
    const events = session.applySessionUpdate({
      sessionUpdate: "plan",
      entries: [
        { content: "a", priority: "urgent", status: "blocked" },
        { priority: "high" },
        { content: "b" },
      ],
    });
    expect(events).toEqual([
      {
        type: "plan",
        replay: false,
        plan: {
          planId: "default",
          entries: [
            { content: "a", priority: "urgent", status: "blocked" },
            { content: "b", priority: "medium", status: "pending" },
          ],
        },
      },
    ]);
  });

  it("keys v2 plans by plan id", () => {
    const session = model(2);
    session.applySessionUpdate({
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "p1", entries: [{ content: "a" }] },
    });
    session.applySessionUpdate({
      sessionUpdate: "plan_update",
      plan: { type: "items", planId: "p2", entries: [] },
    });
    expect(session.snapshot().plans.map((plan) => plan.planId)).toEqual([
      "p1",
      "p2",
    ]);
  });
});

describe("configuration", () => {
  const modelOption = {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: "a",
    options: [
      {
        group: "recommended",
        name: "Recommended",
        options: [{ value: "a", name: "A", description: "provider/a" }],
      },
    ],
  };

  it("keeps the agent's own values, descriptions and groups", () => {
    const session = model();
    const [event] = session.applySessionSetup({
      configOptions: [
        modelOption,
        {
          id: "effort",
          name: "Reasoning",
          category: "thought_level",
          type: "select",
          currentValue: "thinking",
          options: [
            { value: "none", name: "None" },
            { value: "thinking", name: "Thinking" },
          ],
        },
        { id: "brave", name: "Brave", type: "boolean", currentValue: true },
        { id: "slider", name: "Slider", type: "slider", currentValue: 3 },
      ],
    });
    expect(event).toMatchObject({
      type: "configOptions",
      configOptions: [
        {
          id: "model",
          type: "select",
          values: [{ value: "a", name: "A", description: "provider/a" }],
          groups: [{ group: "recommended", name: "Recommended" }],
          setMethod: "session/set_config_option",
        },
        {
          id: "effort",
          currentValue: "thinking",
          values: [{ value: "none" }, { value: "thinking" }],
        },
        { id: "brave", type: "boolean", currentValue: true },
        { id: "slider", type: "unsupported", rawType: "slider" },
      ],
    });
  });

  it("turns legacy modes and models into options set through their own methods", () => {
    const session = model();
    const [event] = session.applySessionSetup({
      modes: {
        currentModeId: "agent",
        availableModes: [
          { id: "agent", name: "Agent" },
          { id: "plan", name: "Plan", description: "Read-only" },
        ],
      },
      models: {
        currentModelId: "default[]",
        availableModels: [{ modelId: "default[]", name: "Auto" }],
      },
    });
    expect(event).toMatchObject({
      configOptions: [
        {
          id: ACP_LEGACY_MODEL_CONFIG_ID,
          category: "model",
          setMethod: "session/set_model",
          currentValue: "default[]",
        },
        {
          id: ACP_LEGACY_MODE_CONFIG_ID,
          category: "mode",
          setMethod: "session/set_mode",
          values: [
            { value: "agent" },
            { value: "plan", description: "Read-only" },
          ],
        },
      ],
    });
    expect(
      session.applySessionUpdate({
        sessionUpdate: "current_mode_update",
        currentModeId: "plan",
      }),
    ).toMatchObject([
      {
        configOptions: [
          { id: ACP_LEGACY_MODEL_CONFIG_ID },
          { id: ACP_LEGACY_MODE_CONFIG_ID, currentValue: "plan" },
        ],
      },
    ]);
    expect(
      session.applyConfigOptionValue(ACP_LEGACY_MODEL_CONFIG_ID, "other"),
    ).toMatchObject([
      { configOptions: [{ currentValue: "other" }, { currentValue: "plan" }] },
    ]);
  });

  it("prefers the agent's config options over the legacy blocks for the same category", () => {
    const session = model();
    const [event] = session.applySessionSetup({
      configOptions: [modelOption],
      models: {
        currentModelId: "a",
        availableModels: [{ modelId: "a", name: "A" }],
      },
      modes: { currentModeId: "ask", availableModes: [{ id: "ask" }] },
    });
    expect(
      event?.type === "configOptions"
        ? event.configOptions.map((option) => option.id)
        : [],
    ).toEqual(["model", ACP_LEGACY_MODE_CONFIG_ID]);
  });

  it("replaces the whole option list when the agent pushes a change", () => {
    const session = model();
    session.applySessionSetup({ configOptions: [modelOption] });
    const events = session.applySessionUpdate({
      sessionUpdate: "config_option_update",
      configOptions: [{ ...modelOption, currentValue: "b" }],
    });
    expect(events).toMatchObject([
      { type: "configOptions", configOptions: [{ currentValue: "b" }] },
    ]);
  });
});

describe("commands, session info and usage", () => {
  it("replaces the command list and keeps input hints", () => {
    const events = model().applySessionUpdate({
      sessionUpdate: "available_commands_update",
      availableCommands: [
        { name: "compact", description: "Compress history", input: null },
        { name: "web", description: "Search", input: { hint: "query" } },
        { description: "nameless" },
      ],
    });
    expect(events).toEqual([
      {
        type: "commands",
        replay: false,
        commands: [
          { name: "compact", description: "Compress history" },
          { name: "web", description: "Search", inputHint: "query" },
        ],
      },
    ]);
  });

  it("patches the title: absent keeps it, null clears it", () => {
    const session = model();
    session.applySessionUpdate({
      sessionUpdate: "session_info_update",
      title: "Fix login",
      updatedAt: "2026-10-08T00:00:00Z",
    });
    expect(
      session.applySessionUpdate({
        sessionUpdate: "session_info_update",
        updatedAt: "2026-10-08T01:00:00Z",
      }),
    ).toMatchObject([
      { info: { title: "Fix login", updatedAt: "2026-10-08T01:00:00Z" } },
    ]);
    expect(
      session.applySessionUpdate({
        sessionUpdate: "session_info_update",
        title: null,
      }),
    ).toMatchObject([{ info: { title: null } }]);
  });

  it("carries cost and remembers the last cumulative cost when an update omits it", () => {
    const session = model();
    expect(
      session.applySessionUpdate({
        sessionUpdate: "usage_update",
        used: 10,
        size: 100,
        cost: { amount: 0.25, currency: "USD" },
      }),
    ).toMatchObject([
      {
        usage: { used: 10, size: 100, cost: { amount: 0.25, currency: "USD" } },
      },
    ]);
    expect(
      session.applySessionUpdate({
        sessionUpdate: "usage_update",
        used: 20,
        size: 100,
      }),
    ).toMatchObject([{ usage: { used: 20, cost: { amount: 0.25 } } }]);
  });

  it("passes variants it does not know through with the raw payload", () => {
    const raw = { sessionUpdate: "_vendor_wake", jobId: 7 };
    expect(model().applySessionUpdate(raw)).toEqual([
      {
        type: "unhandled",
        replay: false,
        reason: "unknown-variant",
        sessionUpdate: "_vendor_wake",
        raw,
      },
    ]);
  });
});
