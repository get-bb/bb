import type { ThreadEvent } from "@bb/domain";
import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createBridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import type { ProviderExecutionContext } from "./provider-adapter.js";

function makeAdapter() {
  return createBridgeProtocolAdapter({
    id: "fake-bridge",
    displayName: "Fake Bridge",
    capabilities: {
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "checkpoint",
      permissionModes: ["full"],
    },
    process: { command: "node", args: ["fake-bridge.mjs"] },
  });
}

function completeHandshake(
  adapter: ReturnType<typeof makeAdapter>,
  capabilities: Record<string, unknown>,
): void {
  const requests = adapter.buildPostInitializeRequests?.() ?? [];
  expect(requests).toHaveLength(1);
  requests[0]?.onResult({ protocolVersion: 1, capabilities });
}

const fullModeOptions: ProviderExecutionContext = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  workflowsEnabled: false,
};

describe("handshake gating", () => {
  it("never sends capability-gated methods a bridge did not advertise", () => {
    const adapter = makeAdapter();
    const before = adapter.buildCommandPlan({
      type: "thread/name/set",
      threadId: "thr_1",
      providerThreadId: "p_1",
      title: "New title",
    });
    expect(before).toMatchObject({ kind: "noop" });

    completeHandshake(adapter, { threadRename: true, threadArchive: true });

    expect(
      adapter.buildCommandPlan({
        type: "thread/name/set",
        threadId: "thr_1",
        providerThreadId: "p_1",
        title: "New title",
      }),
    ).toMatchObject({ kind: "request", method: "thread/name/set" });
    expect(
      adapter.buildCommandPlan({
        type: "thread/archive",
        threadId: "thr_1",
        providerThreadId: "p_1",
      }),
    ).toMatchObject({ kind: "request", method: "thread/archive" });
    expect(
      adapter.buildCommandPlan({
        type: "thread/goal/clear",
        threadId: "thr_1",
        providerThreadId: "p_1",
      }),
    ).toMatchObject({ kind: "noop" });
  });

  it("moves approval policy ownership per the handshake", () => {
    const adapter = makeAdapter();
    expect(adapter.approvalEnforcedBy).toBe("runtime");
    completeHandshake(adapter, { approvalEnforcedBy: "provider" });
    expect(adapter.approvalEnforcedBy).toBe("provider");
  });
});

describe("fork narrowing", () => {
  const forkCommand = {
    type: "thread/fork",
    threadId: "thr_2",
    cwd: "/w",
    sourceProviderThreadId: "p_1",
    options: fullModeOptions,
    instructionMode: "replace",
  } as const;

  it("refuses a fork the handshake does not support, however the declaration reads", () => {
    // The declaration says fork: "checkpoint" (makeAdapter), so only the
    // handshake can stop the request from reaching a bridge that cannot fork.
    const adapter = makeAdapter();
    completeHandshake(adapter, {});
    expect(() => adapter.buildCommandPlan(forkCommand)).toThrow(
      /does not support forking/u,
    );
  });

  it("refuses a checkpoint fork on a tip-only bridge but allows a tip fork", () => {
    const adapter = makeAdapter();
    completeHandshake(adapter, { fork: "tip" });
    expect(() =>
      adapter.buildCommandPlan({
        ...forkCommand,
        sourceProviderCheckpointId: "ckpt_1",
      }),
    ).toThrow(/only fork at the end of a session/u);
    expect(adapter.buildCommandPlan(forkCommand)).toMatchObject({
      kind: "request",
      method: "thread/fork",
    });
  });

  it("allows a checkpoint fork on a checkpoint bridge", () => {
    const adapter = makeAdapter();
    completeHandshake(adapter, { fork: "checkpoint" });
    expect(
      adapter.buildCommandPlan({
        ...forkCommand,
        sourceProviderCheckpointId: "ckpt_1",
      }),
    ).toMatchObject({
      kind: "request",
      method: "thread/fork",
      params: { sourceProviderCheckpointId: "ckpt_1" },
    });
  });
});

describe("thread/stop intent", () => {
  it("derives interrupt for an active turn and release for an idle stop", () => {
    const adapter = makeAdapter();
    expect(
      adapter.buildCommandPlan({
        type: "thread/stop",
        threadId: "thr_1",
        providerThreadId: "p_1",
        activeTurnId: "turn_9",
      }),
    ).toMatchObject({
      params: { intent: "interrupt", activeTurnId: "turn_9" },
    });
    expect(
      adapter.buildCommandPlan({
        type: "thread/stop",
        threadId: "thr_1",
        providerThreadId: "p_1",
        activeTurnId: null,
      }),
    ).toMatchObject({ params: { intent: "release", activeTurnId: null } });
  });
});

describe("options mapping", () => {
  it("keeps core fields top-level and packs provider-flavored fields opaquely", () => {
    const adapter = makeAdapter();
    const plan = adapter.buildCommandPlan({
      type: "turn/start",
      threadId: "thr_1",
      providerThreadId: "p_1",
      input: [{ type: "text", text: "hi", mentions: [] }],
      clientRequestId: "creq_abcdefghjk",
      options: {
        ...fullModeOptions,
        model: "gpt-5.6-sol",
        workflowsEnabled: true,
        memoryEnabled: false,
      },
    });
    expect(plan).toMatchObject({
      kind: "request",
      params: {
        options: {
          model: "gpt-5.6-sol",
          permissionMode: "full",
          providerOptions: {
            workflowsEnabled: true,
            memoryEnabled: false,
            claudeCodeMockCliTraffic:
              DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
          },
        },
      },
    });
    const options = (plan as { params: { options: Record<string, unknown> } })
      .params.options;
    expect(options).not.toHaveProperty("workflowsEnabled");
    expect(options).not.toHaveProperty("skillRoots");
  });
});

describe("skills/configure", () => {
  it("forwards every provider flavor of skill root as canonical roots", () => {
    const adapter = makeAdapter();
    const plan = adapter.buildCommandPlan({
      type: "skills/configure",
      skillRoots: [
        {
          id: "root_claude",
          providerId: "claude-code",
          localPluginPath: "/staged/claude-plugin",
        },
        {
          id: "root_codex",
          providerId: "codex",
          skillDirectoryRootPath: "/staged/codex-skills",
        },
        {
          id: "root_pi",
          providerId: "pi",
          skillDirectoryRootPath: "/staged/pi-skills",
        },
        {
          id: "root_acp",
          providerId: "acp",
          skillDirectoryRootPath: "/staged/acp-skills",
          skills: [{ name: "deploy", description: "Ship the app." }],
        },
      ],
    });

    expect(plan).toEqual({
      kind: "request",
      method: "skills/configure",
      params: {
        roots: [
          { id: "root_claude", path: "/staged/claude-plugin", skills: [] },
          { id: "root_codex", path: "/staged/codex-skills", skills: [] },
          { id: "root_pi", path: "/staged/pi-skills", skills: [] },
          {
            id: "root_acp",
            path: "/staged/acp-skills",
            skills: [{ name: "deploy", description: "Ship the app." }],
          },
        ],
      },
    });
  });
});

describe("translateEvent", () => {
  const validEvent: ThreadEvent = {
    type: "turn/started",
    threadId: "thr_1",
    providerThreadId: "p_1",
    scope: { kind: "turn", turnId: "bturn_1" },
  };

  it("passes valid thread/event payloads through and drops invalid ones", () => {
    const adapter = makeAdapter();
    expect(
      adapter.translateEvent({
        jsonrpc: "2.0",
        method: "thread/event",
        params: { threadId: "thr_1", event: validEvent },
      }),
    ).toStrictEqual([validEvent]);
    expect(
      adapter.translateEvent({
        jsonrpc: "2.0",
        method: "thread/event",
        params: {
          threadId: "thr_1",
          event: { type: "not/a/real/event", threadId: "thr_1" },
        },
      }),
    ).toStrictEqual([]);
  });

  // The reaper's only view of provider work bb cannot see in the timeline.
  // Codex models native subagents as tool calls, so a thread with a live child
  // agent looks idle without this; a bridge that never reports reads as idle.
  it("tracks thread/openWork per thread without emitting a timeline event", () => {
    const adapter = makeAdapter();
    const work = { providerThreadId: "codex-1", threadId: "thr_1" };
    expect(adapter.hasOpenThreadWork?.(work)).toBe(false);

    expect(
      adapter.translateEvent({
        jsonrpc: "2.0",
        method: "thread/openWork",
        params: { threadId: "thr_1", open: true },
      }),
    ).toStrictEqual([]);
    expect(adapter.hasOpenThreadWork?.(work)).toBe(true);
    expect(
      adapter.hasOpenThreadWork?.({
        providerThreadId: "codex-2",
        threadId: "thr_2",
      }),
    ).toBe(false);

    adapter.translateEvent({
      jsonrpc: "2.0",
      method: "thread/openWork",
      params: { threadId: "thr_1", open: false },
    });
    expect(adapter.hasOpenThreadWork?.(work)).toBe(false);
  });

  it("surfaces session/replaced as a visible warning with the context fate", () => {
    const adapter = makeAdapter();
    const events = adapter.translateEvent({
      jsonrpc: "2.0",
      method: "session/replaced",
      params: {
        threadId: "thr_1",
        providerThreadId: "p_2",
        reason: "model change required a session rebuild",
        contextLost: true,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "provider/warning",
      threadId: "thr_1",
      providerThreadId: "p_2",
      details: "model change required a session rebuild",
    });
    expect((events[0] as { summary?: string }).summary).toContain(
      "context was lost",
    );
  });
});

describe("inbound request decoding", () => {
  it("decodes canonical tool calls and rejects other methods", () => {
    const adapter = makeAdapter();
    const decoded = adapter.decodeToolCallRequest({
      id: 7,
      method: "item/tool/call",
      params: {
        providerThreadId: "p_1",
        turnId: null,
        callId: "call_1",
        tool: "ask_user_question",
        arguments: { q: "hi" },
      },
    });
    expect(decoded).toMatchObject({
      requestId: 7,
      providerThreadId: "p_1",
      turnId: null,
      tool: "ask_user_question",
    });
    expect(
      adapter.decodeToolCallRequest({
        id: 8,
        method: "acp/permission/request",
        params: {},
      }),
    ).toBeNull();
  });

  it("decodes canonical interaction requests with the domain payload", () => {
    const adapter = makeAdapter();
    const decoded = adapter.decodeInteractiveRequest?.({
      id: 9,
      method: "interaction/request",
      params: {
        providerThreadId: "p_1",
        turnId: "bturn_1",
        payload: {
          kind: "approval",
          subject: {
            kind: "command",
            itemId: "item_1",
            command: "rm -rf ./scratch",
            cwd: null,
            actions: [],
            sessionGrant: null,
          },
          reason: null,
          availableDecisions: ["allow_once", "deny"],
        },
      },
    });
    expect(decoded).toMatchObject({
      requestId: 9,
      providerThreadId: "p_1",
      turnId: "bturn_1",
      payload: { kind: "approval" },
    });
  });
});
