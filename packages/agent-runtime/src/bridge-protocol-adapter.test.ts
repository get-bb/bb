import type { ThreadEvent } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createBridgeProtocolAdapter } from "./bridge-protocol-adapter.js";
import type { ProviderExecutionContext } from "./provider-adapter.js";

function makeAdapter() {
  return createBridgeProtocolAdapter({
    id: "fake-bridge",
    displayName: "Fake Bridge",
    capabilities: {
      supportsArchive: false,
      supportsRename: false,
      supportsServiceTier: false,
      supportsUserQuestion: false,
      supportsFork: true,
      supportedPermissionModes: ["full"],
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
  permissionEscalation: "ask",
  claudeCodeMockCliTraffic: { enabled: false, endpoint: null },
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

    completeHandshake(adapter, { nameSync: true, archiveSync: true });

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
    expect(adapter.approvalRequestPolicy).toBe("runtime");
    completeHandshake(adapter, { approvalRequestPolicy: "provider" });
    expect(adapter.approvalRequestPolicy).toBe("provider");
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
    ).toMatchObject({ params: { intent: "interrupt", activeTurnId: "turn_9" } });
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
            claudeCodeMockCliTraffic: { enabled: false, endpoint: null },
          },
        },
      },
    });
    const options = (
      plan as { params: { options: Record<string, unknown> } }
    ).params.options;
    expect(options).not.toHaveProperty("workflowsEnabled");
    expect(options).not.toHaveProperty("skillRoots");
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
