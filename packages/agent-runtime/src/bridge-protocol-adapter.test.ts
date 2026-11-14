import type { ThreadEvent } from "@bb/domain";
import { EMPTY_SESSION_SETTINGS_APPLY } from "@bb/provider-bridge-protocol";
import { describe, expect, it, vi } from "vitest";
import { createBridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import type {
  AdapterCommand,
  ProviderExecutionContext,
} from "./provider-adapter.js";

function makeAdapter(
  staticProviderOptions?: Record<string, unknown>,
  onNotice?: (message: string) => void,
) {
  return createBridgeProtocolAdapter({
    id: "fake-bridge",
    capabilities: {
      supportsThreadArchive: false,
      supportsThreadRename: false,
      supportsServiceTier: false,
      fork: "checkpoint",
      permissionModes: ["full"],
    },
    process: { command: "node", args: ["fake-bridge.mjs"] },
    ...(staticProviderOptions === undefined ? {} : { staticProviderOptions }),
    ...(onNotice === undefined ? {} : { onNotice }),
  });
}

function completeHandshake(
  adapter: ReturnType<typeof makeAdapter>,
  capabilities: Record<string, unknown>,
): void {
  const requests = adapter.buildPostInitializeRequests();
  expect(requests).toHaveLength(1);
  requests[0]?.onResult({
    protocolVersion: 3,
    capabilities: {
      grammarVersions: [3, 3],
      sessionSettings: {},
      ...capabilities,
    },
  });
}

const fullModeOptions: ProviderExecutionContext = {
  permissionMode: "full",
  permissionScope: "full",
  approvalReviewer: null,
  permissionEscalation: null,
  providerOptions: {},
};

describe("handshake version gate", () => {
  it("rejects a bridge on another protocol version with a legible error", () => {
    const adapter = makeAdapter();
    const requests = adapter.buildPostInitializeRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.required).toBe(true);
    expect(() =>
      requests[0]?.onResult({ protocolVersion: 1, capabilities: {} }),
    ).toThrowError(
      /speaks Provider Bridge Protocol version 1.*speaks version 3 \(and 2 for compatibility\).*fake-bridge/s,
    );
  });

  it("rejects a malformed initialize result instead of defaulting capabilities", () => {
    const adapter = makeAdapter();
    const requests = adapter.buildPostInitializeRequests();
    expect(requests).toHaveLength(1);
    expect(() => requests[0]?.onResult({ nonsense: true })).toThrowError(
      /malformed result.*fake-bridge/s,
    );
    expect(() => requests[0]?.onResult(null)).toThrowError(/malformed result/);
  });

  it("states the assembler's grammar range and rejects a bridge with no common version", () => {
    const adapter = makeAdapter();
    const requests = adapter.buildPostInitializeRequests();
    expect(requests[0]?.plan).toMatchObject({
      method: "initialize",
      params: { grammarVersions: [3, 3] },
    });
    expect(() =>
      requests[0]?.onResult({
        protocolVersion: 3,
        capabilities: { grammarVersions: [4, 5] },
      }),
    ).toThrowError(
      /grammar versions 4-5.*assembles versions 3-3.*fake-bridge/s,
    );
    expect(() =>
      requests[0]?.onResult({
        protocolVersion: 3,
        capabilities: { grammarVersions: [2, 2] },
      }),
    ).toThrowError(/grammar versions 2-2.*assembles versions 3-3/s);
    expect(() =>
      requests[0]?.onResult({ protocolVersion: 3, capabilities: {} }),
    ).toThrowError(/grammar versions 2-2.*assembles versions 3-3/s);
    expect(() =>
      requests[0]?.onResult({
        protocolVersion: 3,
        capabilities: { grammarVersions: [3, 3] },
      }),
    ).not.toThrow();
    expect(() =>
      requests[0]?.onResult({
        protocolVersion: 3,
        capabilities: { grammarVersions: [2, 4] },
      }),
    ).not.toThrow();
  });
});

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

  it("routes declared sessionless maintenance methods with provider context", () => {
    const adapter = makeAdapter();
    expect(
      adapter.buildCommandPlan({ type: "provider/health", cwd: "/workspace" }),
    ).toEqual({
      kind: "request",
      method: "provider/health",
      params: { providerId: "fake-bridge", cwd: "/workspace" },
    });
    expect(adapter.buildCommandPlan({ type: "provider/usage" })).toEqual({
      kind: "request",
      method: "provider/usage",
      params: { providerId: "fake-bridge" },
    });
    expect(
      adapter.buildCommandPlan({
        type: "provider/installation/status",
        checkUpdates: false,
        cwd: "/workspace",
        requirement: "thread_rewind",
      }),
    ).toEqual({
      kind: "request",
      method: "provider/installation/status",
      params: {
        providerId: "fake-bridge",
        cwd: "/workspace",
        requirement: "thread_rewind",
        checkUpdates: false,
      },
    });
    expect(
      adapter.buildCommandPlan({
        type: "provider/installation/run",
        action: "update",
      }),
    ).toEqual({
      kind: "request",
      method: "provider/installation/run",
      params: { providerId: "fake-bridge", action: "update" },
    });
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
});

describe("options mapping", () => {
  it("keeps core fields top-level and merges the plugin-derived bag over the static options", () => {
    const adapter = makeAdapter({ acpLaunchSpec: { command: "echo" } });
    const plan = adapter.buildCommandPlan({
      type: "turn/start",
      threadId: "thr_1",
      providerThreadId: "p_1",
      input: [{ type: "text", text: "hi", mentions: [] }],
      clientRequestId: "creq_abcdefghjk",
      options: {
        ...fullModeOptions,
        model: "gpt-5.6-sol",
        promptMode: "plan",
        providerOptions: { memoryEnabled: false },
      },
      apply: EMPTY_SESSION_SETTINGS_APPLY,
    });
    expect(plan).toMatchObject({
      kind: "request",
      params: {
        options: {
          model: "gpt-5.6-sol",
          permissionMode: "full",
          promptMode: "plan",
          providerOptions: {
            acpLaunchSpec: { command: "echo" },
            memoryEnabled: false,
          },
        },
      },
    });
    const options = (plan as { params: { options: Record<string, unknown> } })
      .params.options;
    expect(options).not.toHaveProperty("memoryEnabled");
  });
});

describe("commands/list", () => {
  it("is a noop until the handshake declares commands.list", () => {
    const adapter = makeAdapter();
    const command = { type: "commands/list" as const, cwd: "/workspace" };
    expect(adapter.buildCommandPlan(command)).toMatchObject({ kind: "noop" });
    completeHandshake(adapter, { commands: { list: true } });
    expect(adapter.buildCommandPlan(command)).toMatchObject({
      kind: "request",
      method: "commands/list",
      params: { cwd: "/workspace" },
    });
  });
});

describe("skills/configure", () => {
  it("is a noop until the handshake declares skills.configure", () => {
    const adapter = makeAdapter();
    const command = {
      type: "skills/configure" as const,
      skillRoots: [
        { id: "global-skills:abc", path: "/staged/skills", skills: [] },
      ],
    };
    expect(adapter.buildCommandPlan(command)).toMatchObject({ kind: "noop" });
    completeHandshake(adapter, { skills: { configure: true } });
    expect(adapter.buildCommandPlan(command)).toMatchObject({
      kind: "request",
      method: "skills/configure",
    });
  });
});

describe("translateEvent", () => {
  it("ignores an unknown bridge notification without emitting a timeline event", () => {
    const adapter = makeAdapter();
    expect(
      adapter.translateEvent({
        jsonrpc: "2.0",
        method: "thread/openWork",
        params: { threadId: "thr_1", open: true },
      }),
    ).toStrictEqual([]);
  });

  it("only surfaces session/replaced when provider context was lost", () => {
    const adapter = makeAdapter();
    expect(
      adapter.translateEvent({
        jsonrpc: "2.0",
        method: "session/replaced",
        params: {
          threadId: "thr_1",
          providerThreadId: "p_2",
          reason: "authentication recovery required a new process",
          contextLost: false,
        },
      }),
    ).toStrictEqual([]);

    expect(
      adapter.translateEvent({
        jsonrpc: "2.0",
        method: "session/replaced",
        params: {
          threadId: "thr_1",
          providerThreadId: "p_2",
          reason:
            "Execution settings changed; the Claude session was rebuilt to apply them.",
          contextLost: false,
          showRuntimeNote: true,
        },
      }),
    ).toMatchObject([
      {
        type: "provider/warning",
        summary:
          "Execution settings changed; the Claude session was rebuilt to apply them.",
      },
    ]);

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

describe("provider/recovery", () => {
  it("decodes a typed recovery hint as a runtime signal, never a timeline event", () => {
    const adapter = makeAdapter();
    const event = {
      jsonrpc: "2.0" as const,
      method: "provider/recovery",
      params: {
        threadId: "thr_1",
        kind: "sessionArchived",
        message: "session rollout-1 is archived",
        retryable: true,
      },
    };
    expect(adapter.decodeRecoveryHint(event)).toEqual({
      threadId: "thr_1",
      kind: "sessionArchived",
      message: "session rollout-1 is archived",
      retryable: true,
    });
    expect(adapter.translateEvent(event)).toStrictEqual([]);
    expect(
      adapter.decodeRecoveryHint({
        jsonrpc: "2.0",
        method: "provider/recovery",
        params: { kind: "authRequired", message: "sign in", retryable: false },
      }),
    ).toEqual({ kind: "authRequired", message: "sign in", retryable: false });
  });

  it("drops a malformed or unknown-kind hint and ignores other notifications", () => {
    const adapter = makeAdapter();
    expect(
      adapter.decodeRecoveryHint({
        jsonrpc: "2.0",
        method: "provider/recovery",
        params: { kind: "rebootTheUniverse", message: "x", retryable: true },
      }),
    ).toBeNull();
    expect(
      adapter.decodeRecoveryHint({
        jsonrpc: "2.0",
        method: "thread/openWork",
        params: { threadId: "thr_1", open: true },
      }),
    ).toBeNull();
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
});

function feedDeltas(
  adapter: ReturnType<typeof makeAdapter>,
  threadId: string,
  deltas: unknown[],
): ThreadEvent[] {
  return adapter.translateEvent({
    jsonrpc: "2.0",
    method: "thread/delta",
    params: { threadId, deltas },
  });
}

describe("provider-native id translation", () => {
  it("reverse-maps steer/interrupt turn ids to provider-native ids", () => {
    const adapter = makeAdapter();
    const [started] = feedDeltas(adapter, "t_1", [
      { kind: "turn.open", providerTurnId: "codex-turn-1" },
    ]);
    const bbTurnId =
      started?.type === "turn/started" && started.scope.kind === "turn"
        ? started.scope.turnId
        : "";
    expect(bbTurnId).not.toBe("");

    const steer = adapter.buildCommandPlan({
      type: "turn/steer",
      threadId: "t_1",
      providerThreadId: "p_1",
      expectedTurnId: bbTurnId,
      input: [],
      clientRequestId: "creq_abcdefghjk",
      options: fullModeOptions,
    });
    expect(steer).toMatchObject({
      params: { expectedTurnId: "codex-turn-1" },
    });

    const stop = adapter.buildCommandPlan({
      type: "thread/stop",
      threadId: "t_1",
      providerThreadId: "p_1",
      activeTurnId: bbTurnId,
    });
    expect(stop).toMatchObject({
      params: { intent: "interrupt", activeTurnId: "codex-turn-1" },
    });

    const passthrough = adapter.buildCommandPlan({
      type: "turn/steer",
      threadId: "t_1",
      providerThreadId: "p_1",
      expectedTurnId: "unmapped-turn",
      input: [],
      clientRequestId: "creq_abcdefghjk",
      options: fullModeOptions,
    });
    expect(passthrough).toMatchObject({
      params: { expectedTurnId: "unmapped-turn" },
    });
  });

  it("maps interaction request ids onto assembler-minted ids", () => {
    const adapter = makeAdapter();
    const events = feedDeltas(adapter, "t_1", [
      { kind: "turn.open", providerTurnId: "codex-turn-1" },
      {
        kind: "item.open",
        key: { providerItemId: "cmd-1" },
        item: { type: "command", command: "git status", cwd: "/repo" },
        providerTurnId: "codex-turn-1",
      },
    ]);
    const bbItemId =
      events[1]?.type === "item/started" ? events[1].item.id : "";
    const bbTurnId =
      events[0]?.type === "turn/started" && events[0].scope.kind === "turn"
        ? events[0].scope.turnId
        : "";

    const params = {
      providerThreadId: "p_1",
      threadId: "t_1",
      turnId: "codex-turn-1",
      payload: {
        kind: "approval",
        subject: {
          kind: "command",
          itemId: "cmd-1",
          command: "git status",
          cwd: null,
          actions: [],
          sessionGrant: null,
        },
        reason: null,
        availableDecisions: ["allow_once", "deny"],
      },
    };
    const decoded = adapter.decodeInteractiveRequest?.({
      id: 11,
      method: "interaction/request",
      params,
    });
    expect(decoded).toMatchObject({
      turnId: bbTurnId,
      payload: { subject: { itemId: bbItemId } },
    });

    const unknown = adapter.decodeInteractiveRequest?.({
      id: 12,
      method: "interaction/request",
      params: {
        ...params,
        turnId: "unmapped-turn",
        payload: {
          ...params.payload,
          subject: { ...params.payload.subject, itemId: "acp-permission" },
        },
      },
    });
    expect(unknown).toMatchObject({
      turnId: "unmapped-turn",
      payload: { subject: { itemId: "acp-permission" } },
    });
  });

  it("maps tool-call request ids onto assembler-minted ids", () => {
    const adapter = makeAdapter();
    const events = feedDeltas(adapter, "t_1", [
      { kind: "turn.open", providerTurnId: "codex-turn-1" },
      {
        kind: "item.open",
        key: { providerItemId: "dyn-1" },
        item: { type: "tool", tool: "bb_test_ping" },
        providerTurnId: "codex-turn-1",
      },
    ]);
    const bbItemId =
      events[1]?.type === "item/started" ? events[1].item.id : "";
    const bbTurnId =
      events[0]?.type === "turn/started" && events[0].scope.kind === "turn"
        ? events[0].scope.turnId
        : "";

    const decoded = adapter.decodeToolCallRequest({
      id: 13,
      method: "item/tool/call",
      params: {
        providerThreadId: "p_1",
        threadId: "t_1",
        turnId: "codex-turn-1",
        callId: "dyn-1",
        tool: "bb_test_ping",
        arguments: {},
      },
    });
    expect(decoded).toMatchObject({ turnId: bbTurnId, callId: bbItemId });
  });
});

describe("deferred text flush", () => {
  it("hands a quiet stream's buffered text to the deferred listener", () => {
    vi.useFakeTimers();
    try {
      const adapter = makeAdapter();
      const deferred: Array<[string, ThreadEvent[]]> = [];
      adapter.onDeferredEvents((threadId, events) => {
        deferred.push([threadId, events]);
      });
      const opened = feedDeltas(adapter, "t_1", [
        { kind: "turn.open" },
        {
          kind: "item.textDelta",
          key: { channel: "assistant" },
          channel: "agentMessage",
          text: "Hi",
        },
      ]);
      expect(opened.map((event) => event.type)).toEqual([
        "turn/started",
        "item/started",
      ]);
      vi.advanceTimersByTime(60);
      expect(deferred).toEqual([
        [
          "t_1",
          [
            expect.objectContaining({
              type: "item/agentMessage/delta",
              delta: "Hi",
            }),
          ],
        ],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

const turnStartCommand: AdapterCommand = {
  type: "turn/start",
  threadId: "t_1",
  providerThreadId: "p_1",
  input: [{ type: "text", text: "hi", mentions: [] }],
  clientRequestId: "creq_abcdefghjk",
  options: fullModeOptions,
  apply: { settings: ["model"], sessionOptions: [], providerOptions: [] },
  dynamicTools: [],
};

const claimIfIdleTurn = [
  { kind: "input.accepted", clientRequestId: "creq_abcdefghjk" },
  { kind: "turn.boundary", status: "completed", claimIfIdle: true },
];

describe("protocol 2 compatibility", () => {
  it("drives a protocol 2 bridge with main's wire: claimIfIdle turns, any turn result accepted, no apply or open-work requests", () => {
    const adapter = makeAdapter();
    adapter.buildPostInitializeRequests()[0]?.onResult({
      protocolVersion: 2,
      capabilities: { grammarVersions: [3, 3], openWork: { list: true } },
    });

    expect(adapter.protocolVersion).toBe(2);
    expect(adapter.sessionSettings).toEqual({});
    expect(
      adapter.buildCommandPlan({
        type: "thread/openWork",
        threadId: "t_1",
        providerThreadId: "p_1",
      }),
    ).toMatchObject({ kind: "noop" });
    const plan = adapter.buildCommandPlan(turnStartCommand);
    expect(plan).toMatchObject({ kind: "request", method: "turn/start" });
    expect(plan.kind === "request" ? plan.params : null).not.toHaveProperty(
      "apply",
    );
    expect(plan.kind === "request" ? plan.params : null).not.toHaveProperty(
      "dynamicTools",
    );
    for (const result of [{}, { threadId: "t_1" }, null]) {
      expect(adapter.turnInputResultSchema.parse(result)).toEqual({
        admission: "accepted",
      });
    }
    expect(
      feedDeltas(adapter, "t_1", claimIfIdleTurn).map((event) => event.type),
    ).toEqual(["turn/started", "turn/input/accepted", "turn/completed"]);
    expect(
      feedDeltas(adapter, "t_1", [
        { kind: "turn.boundary", status: "completed", claimIfIdle: true },
      ]),
    ).toEqual([]);
  });

  it("keeps protocol 3 free of claimIfIdle inference and requires an admission answer", () => {
    const adapter = makeAdapter();
    completeHandshake(adapter, {});

    expect(adapter.protocolVersion).toBe(3);
    expect(feedDeltas(adapter, "t_1", claimIfIdleTurn)).toEqual([]);
    expect(adapter.turnInputResultSchema.safeParse({}).success).toBe(false);
    expect(adapter.buildCommandPlan(turnStartCommand)).toMatchObject({
      params: {
        apply: { settings: ["model"] },
        dynamicTools: [],
      },
    });
  });

  it("runs a bridge that claims protocol 3 without sessionSettings as protocol 2 and says why", () => {
    const notices: string[] = [];
    const adapter = makeAdapter(undefined, (message) => notices.push(message));
    adapter.buildPostInitializeRequests()[0]?.onResult({
      protocolVersion: 3,
      capabilities: { grammarVersions: [3, 3], openWork: { list: true } },
    });

    expect(adapter.protocolVersion).toBe(2);
    expect(notices).toEqual([
      expect.stringMatching(
        /"fake-bridge" answered initialize with protocol version 3 but without capabilities\.sessionSettings.*runs it as a protocol 2 bridge/s,
      ),
    ]);
    expect(
      feedDeltas(adapter, "t_1", claimIfIdleTurn).map((event) => event.type),
    ).toEqual(["turn/started", "turn/input/accepted", "turn/completed"]);
  });
});
