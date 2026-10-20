import { spawn, type ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createAcpSessionModel } from "../session/session-model.js";
import type { AcpSessionEvent } from "../session/session-types.js";
import {
  ACP_AUTH_REQUIRED_CODE,
  AcpRequestTimeoutError,
  acpErrorCode,
  connectAcpClient,
  decodeAcpPermissionRequest,
  type AcpClient,
  type AcpClientHandlers,
  type AcpPermissionRequest,
  type AcpSessionUpdateNotification,
} from "./acp-client.js";
import {
  ACP_CLIENT_PROTOCOL_VERSION,
  AcpUnsupportedProtocolVersionError,
  readAcpAgentCapabilities,
} from "./capabilities.js";

const FAKE_AGENT_PATH = fileURLToPath(
  new URL("../bridge/fake-acp-agent.mjs", import.meta.url),
);

interface ScriptedPeer {
  client: AcpClient;
  updates: AcpSessionUpdateNotification[];
  discarded: Array<[string, string]>;
  written: Array<Record<string, unknown>>;
  feed(message: unknown): void;
  endInput(): void;
  nextWritten(count: number): Promise<void>;
}

function scriptedPeer(
  overrides: Partial<AcpClientHandlers> = {},
  requestTimeoutMs = 2_000,
): ScriptedPeer {
  const input = new PassThrough();
  const output = new PassThrough();
  const updates: AcpSessionUpdateNotification[] = [];
  const discarded: Array<[string, string]> = [];
  const written: Array<Record<string, unknown>> = [];
  let pendingText = "";
  output.on("data", (chunk: Buffer) => {
    pendingText += chunk.toString("utf8");
    const lines = pendingText.split("\n");
    pendingText = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() !== "") {
        written.push(JSON.parse(line));
      }
    }
  });
  const client = connectAcpClient({
    input,
    output,
    requestTimeoutMs,
    closeOnInputEnd: true,
    handlers: {
      sessionUpdate: (notification) => updates.push(notification),
      discarded: (reason, line) => discarded.push([reason, line]),
      ...overrides,
    },
  });
  return {
    client,
    updates,
    discarded,
    written,
    feed(message) {
      input.write(
        `${typeof message === "string" ? message : JSON.stringify(message)}\n`,
      );
    },
    endInput() {
      input.end();
    },
    async nextWritten(count) {
      await expect.poll(() => written.length).toBeGreaterThanOrEqual(count);
    },
  };
}

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
  }
});

describe("message handling", () => {
  it("delivers session updates the SDK would reject, untouched", async () => {
    const peer = scriptedPeer();
    const future = { sessionUpdate: "future_variant", payload: { a: 1 } };
    const vendorKind = {
      sessionUpdate: "tool_call",
      toolCallId: "t1",
      title: "x",
      kind: "browse",
      status: "cancelled",
      vendorField: 7,
    };
    peer.feed({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s1", update: future },
    });
    peer.feed({
      jsonrpc: "2.0",
      method: "session/update",
      params: { sessionId: "s1", update: vendorKind },
    });
    await expect.poll(() => peer.updates.length).toBe(2);
    expect(peer.updates).toEqual([
      { sessionId: "s1", update: future },
      { sessionId: "s1", update: vendorKind },
    ]);
  });

  it("drops stdout noise and stray responses without answering the agent", async () => {
    const peer = scriptedPeer();
    peer.feed("warning: this agent logs to stdout");
    peer.feed("[1,2,3]");
    peer.feed({ jsonrpc: "2.0", id: "skills-reload", result: { reloaded: 1 } });
    peer.feed({ jsonrpc: "2.0", method: "session/update", params: {} });
    await expect.poll(() => peer.discarded.length).toBe(4);
    expect(peer.discarded.map(([reason]) => reason)).toEqual([
      "not-json",
      "not-a-message",
      "unexpected-response",
      "malformed-update",
    ]);
    expect(peer.written).toEqual([]);
  });

  it("answers a handler that returns nothing with a null result", async () => {
    const peer = scriptedPeer({ requests: { "fs/write_text_file": () => {} } });
    peer.feed({
      jsonrpc: "2.0",
      id: 3,
      method: "fs/write_text_file",
      params: {},
    });
    await peer.nextWritten(1);
    expect(peer.written).toEqual([{ jsonrpc: "2.0", id: 3, result: null }]);
  });

  it("answers an unknown request with method-not-found and ignores unknown notifications", async () => {
    const peer = scriptedPeer();
    peer.feed({ jsonrpc: "2.0", method: "_vendor/notice", params: {} });
    peer.feed({ jsonrpc: "2.0", id: 4, method: "terminal/create", params: {} });
    await peer.nextWritten(1);
    expect(peer.written).toMatchObject([{ id: 4, error: { code: -32601 } }]);
  });

  it("routes extension requests and notifications to their handlers", async () => {
    const wakes: unknown[] = [];
    const peer = scriptedPeer({
      requests: {
        "cursor/task": (params) => ({ accepted: params }),
      },
      notifications: {
        "_x.ai/sessions/changed": (params) => wakes.push(params),
      },
    });
    peer.feed({
      jsonrpc: "2.0",
      method: "_x.ai/sessions/changed",
      params: { upserted: [{ activity: "idle" }] },
    });
    peer.feed({
      jsonrpc: "2.0",
      id: 9,
      method: "cursor/task",
      params: { agentId: "a1" },
    });
    await peer.nextWritten(1);
    expect(peer.written).toEqual([
      { jsonrpc: "2.0", id: 9, result: { accepted: { agentId: "a1" } } },
    ]);
    expect(wakes).toEqual([{ upserted: [{ activity: "idle" }] }]);
  });

  it("passes permission options with kinds outside the v1 enum to the handler", async () => {
    const requests: AcpPermissionRequest[] = [];
    const peer = scriptedPeer({
      requests: {
        "session/request_permission": (params) => {
          requests.push(decodeAcpPermissionRequest(params));
          return { outcome: { outcome: "selected", optionId: "o1" } };
        },
      },
    });
    peer.feed({
      jsonrpc: "2.0",
      id: 5,
      method: "session/request_permission",
      params: {
        sessionId: "s1",
        toolCall: { toolCallId: "t1", kind: "browse" },
        options: [{ optionId: "o1", name: "Yes", kind: "allow_forever" }],
      },
    });
    await peer.nextWritten(1);
    expect(requests).toEqual([
      {
        sessionId: "s1",
        toolCall: { toolCallId: "t1", kind: "browse" },
        options: [{ optionId: "o1", name: "Yes", kind: "allow_forever" }],
      },
    ]);
    expect(peer.written).toMatchObject([
      { id: 5, result: { outcome: { outcome: "selected", optionId: "o1" } } },
    ]);
  });

  it("rejects a permission request without options as invalid params", async () => {
    const peer = scriptedPeer({
      requests: { "session/request_permission": decodeAcpPermissionRequest },
    });
    peer.feed({
      jsonrpc: "2.0",
      id: 6,
      method: "session/request_permission",
      params: { sessionId: "s1", toolCall: { toolCallId: "t1" } },
    });
    await peer.nextWritten(1);
    expect(peer.written).toMatchObject([{ id: 6, error: { code: -32602 } }]);
  });
});

describe("requests", () => {
  it("keeps response fields outside the schema and exposes agent error codes", async () => {
    const peer = scriptedPeer();
    const created = peer.client.request("session/new", {
      cwd: "/work",
      mcpServers: [],
    });
    await peer.nextWritten(1);
    peer.feed({
      jsonrpc: "2.0",
      id: peer.written[0]?.["id"],
      result: {
        sessionId: "s1",
        models: { currentModelId: "m", availableModels: [] },
      },
    });
    await expect(created).resolves.toEqual({
      sessionId: "s1",
      models: { currentModelId: "m", availableModels: [] },
    });

    const denied = peer.client.request("session/new", {
      cwd: "/work",
      mcpServers: [],
    });
    await peer.nextWritten(2);
    peer.feed({
      jsonrpc: "2.0",
      id: peer.written[1]?.["id"],
      error: { code: -32000, message: "Authentication required" },
    });
    const error = await denied.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(acpErrorCode(error)).toBe(ACP_AUTH_REQUIRED_CODE);
  });

  it("times out a request the agent never answers and tells the agent to cancel it", async () => {
    const peer = scriptedPeer({}, 40);
    const error = await peer.client
      .request("session/new", { cwd: "/work", mcpServers: [] })
      .then(
        () => null,
        (reason: unknown) => reason,
      );
    expect(error).toBeInstanceOf(AcpRequestTimeoutError);
    await peer.nextWritten(2);
    expect(peer.written[1]).toEqual({
      jsonrpc: "2.0",
      method: "$/cancel_request",
      params: { requestId: peer.written[0]?.["id"] },
    });
  });

  it("lets a prompt run without a deadline when asked", async () => {
    const peer = scriptedPeer({}, 20);
    const prompt = peer.client.request(
      "session/prompt",
      { sessionId: "s1", prompt: [{ type: "text", text: "hi" }] },
      { timeoutMs: null },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    peer.feed({
      jsonrpc: "2.0",
      id: peer.written[0]?.["id"],
      result: { stopReason: "paused_by_vendor" },
    });
    await expect(prompt).resolves.toEqual({ stopReason: "paused_by_vendor" });
  });

  it("rejects everything in flight when the agent's output ends", async () => {
    const peer = scriptedPeer();
    const pending = peer.client.request(
      "session/prompt",
      { sessionId: "s1", prompt: [] },
      { timeoutMs: null },
    );
    await peer.nextWritten(1);
    peer.endInput();
    await expect(pending).rejects.toBeDefined();
    await peer.client.closed;
  });

  it("matches a response whose numeric id the agent echoed as a string", async () => {
    const peer = scriptedPeer();
    const created = peer.client.request("session/new", {
      cwd: "/work",
      mcpServers: [],
    });
    await peer.nextWritten(1);
    peer.feed({
      jsonrpc: "2.0",
      id: String(peer.written[0]?.["id"]),
      result: { sessionId: "s1" },
    });
    await expect(created).resolves.toEqual({ sessionId: "s1" });
  });

  it("sends notifications without an id", async () => {
    const peer = scriptedPeer();
    await peer.client.notify("session/cancel", { sessionId: "s1" });
    await peer.nextWritten(1);
    expect(peer.written).toEqual([
      { jsonrpc: "2.0", method: "session/cancel", params: { sessionId: "s1" } },
    ]);
  });
});

describe("agent capabilities", () => {
  it("reads advertised capabilities with presence semantics", () => {
    const capabilities = readAcpAgentCapabilities({
      protocolVersion: 1,
      agentInfo: { name: "grok", version: "1.0.41" },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: false, embeddedContext: true },
        mcpCapabilities: { http: true },
        sessionCapabilities: { list: {}, resume: {}, close: {}, fork: null },
        auth: {},
        _meta: { "x.ai/fs_notify": true },
      },
      authMethods: [
        { id: "cached_token", name: "cached_token" },
        {
          id: "terminal-login",
          name: "Log in",
          type: "terminal",
          args: ["--login", 3],
          env: { INTERACTIVE: "1", BAD: 2 },
        },
        { name: "no id" },
      ],
    });
    expect(capabilities).toEqual({
      protocolVersion: 1,
      agentInfo: { name: "grok", version: "1.0.41" },
      prompt: { image: false, audio: false, embeddedContext: true },
      mcp: { http: true, sse: false },
      session: {
        load: true,
        resume: true,
        list: true,
        close: true,
        delete: false,
        fork: false,
        additionalDirectories: false,
      },
      logout: false,
      authMethods: [
        {
          id: "cached_token",
          name: "cached_token",
          type: "agent",
          args: [],
          env: {},
        },
        {
          id: "terminal-login",
          name: "Log in",
          type: "terminal",
          args: ["--login"],
          env: { INTERACTIVE: "1" },
        },
      ],
      meta: { "x.ai/fs_notify": true },
    });
  });

  it("refuses an agent that answers in another protocol generation", () => {
    expect(() =>
      readAcpAgentCapabilities({
        protocolVersion: 2,
        info: { name: "agent" },
        capabilities: { session: {} },
      }),
    ).toThrow(AcpUnsupportedProtocolVersionError);
    expect(() => readAcpAgentCapabilities({})).toThrow(
      AcpUnsupportedProtocolVersionError,
    );
  });

  it("accepts an agent that misreports the version number but answers in the v1 shape", () => {
    const capabilities = readAcpAgentCapabilities({
      protocolVersion: 2,
      agentCapabilities: { loadSession: true },
    });
    expect(capabilities.protocolVersion).toBe(2);
    expect(capabilities.session.load).toBe(true);
  });
});

describe("against the fake agent process", () => {
  function startFakeAgent(env: Record<string, string>) {
    const child = spawn(process.execPath, [FAKE_AGENT_PATH], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(child);
    const events: AcpSessionEvent[] = [];
    const model = createAcpSessionModel({ generation: 1 });
    const client = connectAcpClient({
      input: child.stdout,
      output: child.stdin,
      requestTimeoutMs: 10_000,
      closeOnInputEnd: true,
      handlers: {
        sessionUpdate: ({ update }) => {
          events.push(...model.applySessionUpdate(update));
        },
        requests: {
          "session/request_permission": (params) => {
            const request = decodeAcpPermissionRequest(params);
            events.push(...model.actionRequested("permission"));
            const option = request.options.find(
              (candidate) => candidate.kind === "allow_once",
            );
            events.push(...model.actionResolved("permission"));
            return option
              ? { outcome: { outcome: "selected", optionId: option.optionId } }
              : { outcome: { outcome: "cancelled" } };
          },
        },
      },
    });
    return { client, model, events };
  }

  it("runs initialize, session setup and a prompt turn through the session model", async () => {
    const { client, model, events } = startFakeAgent({
      FAKE_ACP_MODEL_CONFIG: "1",
    });
    const initialized = await client.request("initialize", {
      protocolVersion: ACP_CLIENT_PROTOCOL_VERSION,
      clientInfo: { name: "bb", version: "test" },
      clientCapabilities: {},
    });
    expect(readAcpAgentCapabilities(initialized).protocolVersion).toBe(1);

    const session = await client.request("session/new", {
      cwd: process.cwd(),
      mcpServers: [],
    });
    events.push(...model.applySessionSetup(session));
    const modelOption = model
      .snapshot()
      .configOptions.find((option) => option.category === "model");
    expect(modelOption).toMatchObject({
      type: "select",
      setMethod: "session/set_config_option",
    });

    events.push(...model.promptSubmitted());
    const result = await client.request(
      "session/prompt",
      {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: "hello" }],
      },
      { timeoutMs: null },
    );
    events.push(...model.promptSettled({ stopReason: result.stopReason }));

    const workStates = events.flatMap((event) =>
      event.type === "work" ? [event.work.state] : [],
    );
    expect(workStates).toEqual(["running", "idle"]);
    expect(events.some((event) => event.type === "message")).toBe(true);
    expect(events.filter((event) => event.type === "unhandled")).toEqual([]);
    expect(model.snapshot().work).toMatchObject({
      state: "idle",
      stopReason: "end_turn",
    });
    client.close();
  });

  it("passes through requires_action when the agent asks for permission mid-turn", async () => {
    const { client, model, events } = startFakeAgent({});
    await client.request("initialize", {
      protocolVersion: ACP_CLIENT_PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    const session = await client.request("session/new", {
      cwd: process.cwd(),
      mcpServers: [],
    });
    events.push(...model.promptSubmitted());
    const result = await client.request(
      "session/prompt",
      {
        sessionId: session.sessionId,
        prompt: [
          { type: "text", text: "request-external-directory-permission" },
        ],
      },
      { timeoutMs: null },
    );
    events.push(...model.promptSettled({ stopReason: result.stopReason }));
    const workStates = events.flatMap((event) =>
      event.type === "work" ? [event.work.state] : [],
    );
    expect(workStates).toEqual([
      "running",
      "requires_action",
      "running",
      "idle",
    ]);
    expect(
      events.some(
        (event) =>
          event.type === "toolCall" &&
          event.toolCall.toolCallId === "write-tool-1",
      ),
    ).toBe(true);
    client.close();
  });

  it("surfaces an authentication-required error by code", async () => {
    const { client } = startFakeAgent({
      FAKE_ACP_AUTH_METHODS: "cached_token",
    });
    const initialized = await client.request("initialize", {
      protocolVersion: ACP_CLIENT_PROTOCOL_VERSION,
      clientCapabilities: {},
    });
    expect(
      readAcpAgentCapabilities(initialized).authMethods.map((m) => m.id),
    ).toEqual(["cached_token"]);
    const error = await client
      .request("session/new", { cwd: process.cwd(), mcpServers: [] })
      .then(
        () => null,
        (reason: unknown) => reason,
      );
    expect(acpErrorCode(error)).toBe(ACP_AUTH_REQUIRED_CODE);
    await client.request("authenticate", { methodId: "cached_token" });
    await expect(
      client.request("session/new", { cwd: process.cwd(), mcpServers: [] }),
    ).resolves.toMatchObject({ sessionId: expect.any(String) });
    client.close();
  });
});
