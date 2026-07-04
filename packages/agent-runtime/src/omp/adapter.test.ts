import { describe, expect, it } from "vitest";
import { turnScope, type ThreadEvent } from "@bb/domain";
import { createOmpProviderAdapter } from "./adapter.js";

const fullProviderExecutionContext = {
  claudeCodeMockCliTraffic: { enabled: false, endpoint: "https://invalid" },
  permissionMode: "full" as const,
  permissionEscalation: null,
  workflowsEnabled: false,
};

function ompSdkMessage(
  message: unknown,
  threadId = "omp-thread-1",
): { jsonrpc: "2.0"; method: string; params: Record<string, unknown> } {
  return {
    jsonrpc: "2.0",
    method: "sdk/message",
    params: { threadId, message },
  };
}

describe("omp provider adapter", () => {
  it("has correct identity", () => {
    const adapter = createOmpProviderAdapter();
    expect(adapter.id).toBe("omp");
    expect(adapter.displayName).toBe("oh-my-pi");
  });

  it("advertises full-only permission mode and no fork/archive/rename", () => {
    const adapter = createOmpProviderAdapter();
    expect(adapter.capabilities).toEqual({
      supportsArchive: false,
      supportsRename: false,
      supportsServiceTier: false,
      supportsUserQuestion: false,
      supportsFork: false,
      supportedPermissionModes: ["full"],
    });
  });

  it("spawns the node bridge targeting the omp bridge source", () => {
    const adapter = createOmpProviderAdapter();
    expect(adapter.process.command).toBe("node");
    expect(adapter.process.args.at(-1)).toMatch(
      /agent-runtime\/src\/omp\/bridge\/bridge\.ts$/,
    );
  });

  it("routes model/list through the bridge", () => {
    const adapter = createOmpProviderAdapter();
    expect(adapter.buildCommandPlan({ type: "model/list" })).toEqual({
      kind: "request",
      method: "model/list",
      params: {},
    });
  });

  it("maps skills/configure to a no-op (per-session skill paths)", () => {
    const adapter = createOmpProviderAdapter();
    expect(
      adapter.buildCommandPlan({ type: "skills/configure", skillRoots: [] }).kind,
    ).toBe("noop");
  });

  it("builds a turn/start plan with flattened input", () => {
    const adapter = createOmpProviderAdapter();
    const plan = adapter.buildCommandPlan({
      type: "turn/start",
      threadId: "bb-1",
      providerThreadId: "omp-1",
      input: [{ type: "text", text: "do it", mentions: [] }],
      clientRequestId: "creq_omp",
      options: fullProviderExecutionContext,
    });
    expect(plan).toEqual({
      kind: "request",
      method: "turn/start",
      params: {
        threadId: "omp-1",
        input: [{ type: "text", text: "do it", mentions: [] }],
      },
    });
  });

  it("builds a thread/resume plan with bb and provider thread ids", () => {
    const adapter = createOmpProviderAdapter();
    const plan = adapter.buildCommandPlan({
      type: "thread/resume",
      threadId: "bb-1",
      providerThreadId: "/tmp/omp-session.jsonl",
      cwd: "/tmp/workspace",
      instructionMode: "append",
      options: fullProviderExecutionContext,
    });
    expect(plan).toEqual({
      kind: "request",
      method: "thread/resume",
      params: {
        threadId: "bb-1",
        providerThreadId: "/tmp/omp-session.jsonl",
        cwd: "/tmp/workspace",
      },
    });
  });

  it("parses relayed omp model lists, dropping entries without an id", () => {
    const adapter = createOmpProviderAdapter();
    const result = adapter.parseModelListResult({
      models: [
        { id: "anthropic/claude-sonnet-4-6", name: "Sonnet" },
        { provider: "openai", id: "gpt-5.4", name: "GPT-5.4" },
        { name: "no id here" },
      ],
    });
    expect(result.models.map((m) => m.id)).toEqual([
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5.4",
    ]);
  });

  // -- event translation -------------------------------------------------

  it("starts a turn on agent_start", () => {
    const adapter = createOmpProviderAdapter();
    const events = adapter.translateEvent(
      ompSdkMessage({ type: "agent_start" }),
      { threadId: "omp-thread-1" },
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "turn/started" }),
    );
  });

  it("streams assistant text deltas and completes the message on agent_end", () => {
    const adapter = createOmpProviderAdapter();
    const collected: ThreadEvent[] = [];
    const push = (message: unknown): void => {
      collected.push(
        ...adapter.translateEvent(ompSdkMessage(message), {
          threadId: "omp-thread-1",
        }),
      );
    };
    // Open the turn first; omp streams message_update only after agent_start.
    push({ type: "agent_start" });
    push({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "Hello " },
    });
    push({
      type: "message_update",
      assistantMessageEvent: { type: "text_delta", delta: "world" },
    });
    push({
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
        },
      ],
    });

    const deltas = collected.filter((e) => e.type === "item/agentMessage/delta");
    expect(deltas).toHaveLength(2);
    const completed = collected.find((e) => e.type === "item/completed");
    expect(completed).toMatchObject({
      type: "item/completed",
      item: { type: "agentMessage", text: "Hello world" },
      scope: turnScope("turn-1"),
    });
    expect(collected).toContainEqual(
      expect.objectContaining({ type: "turn/completed", status: "completed" }),
    );
  });

  it("forwards thread/identity envelopes", () => {
    const adapter = createOmpProviderAdapter();
    const events = adapter.translateEvent(
      {
        jsonrpc: "2.0",
        method: "thread/identity",
        params: { threadId: "bb-1", providerThreadId: "omp-session-1" },
      },
      { threadId: "bb-1" },
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "thread/identity",
        threadId: "bb-1",
        providerThreadId: "omp-session-1",
      }),
    );
  });
});
