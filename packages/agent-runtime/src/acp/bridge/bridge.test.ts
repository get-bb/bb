import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamicTool } from "@bb/domain";
import {
  captureBridgeJsonRpcOutput,
  type BridgeJsonRpcOutputMessage,
  type CapturedBridgeJsonRpcOutput,
} from "../../test/bridge-json-rpc-test-helpers.js";
import { handleLine } from "./bridge.js";
import { ACP_BRIDGE_MCP_SERVER_NAME } from "./tool-proxy-mcp.js";

const FAKE_AGENT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fake-acp-agent.mjs",
);

let output: CapturedBridgeJsonRpcOutput;
let workspaceDir: string;
let nextThreadSerial = 0;
const startedProviderThreadIds: string[] = [];
let nextRequestId = 1;
const realSetTimeout = setTimeout;

function requestId(): number {
  nextRequestId += 1;
  return nextRequestId;
}

function sendRequest(method: string, params: object): number {
  const id = requestId();
  handleLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
  return id;
}

async function waitFor<T>(
  resolveValue: () => T | undefined,
  description: string,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = resolveValue();
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolveTick) => setTimeout(resolveTick, 20));
  }
}

async function waitForFileWithRealTimer(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) {
      return;
    }
    await new Promise((resolveTick) => realSetTimeout(resolveTick, 20));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function findResponse(id: number): BridgeJsonRpcOutputMessage | undefined {
  return output.messages.find((message) => message.id === id);
}

async function waitForResponse(
  id: number,
): Promise<BridgeJsonRpcOutputMessage> {
  return waitFor(() => findResponse(id), `response ${id}`);
}

function notifications(method: string): BridgeJsonRpcOutputMessage[] {
  return output.messages.filter((message) => message.method === method);
}

interface StartThreadArgs {
  permissionMode?: "full" | "workspace-write" | "readonly";
  permissionEscalation?: "ask" | "deny" | null;
  envVars?: Record<string, string>;
  instructions?: string;
  agent?: { command: string; args: string[] };
  dynamicTools?: DynamicTool[];
  modelSelection?:
    | {
        listCommand: { command: string; args: string[] };
        selectFlag: string;
        model: string;
        reasoningLevel?: string;
      }
    | { modelId: string; reasoningLevel?: string };
}

async function startThread(args?: StartThreadArgs): Promise<{
  bbThreadId: string;
  providerThreadId: string;
}> {
  nextThreadSerial += 1;
  const bbThreadId = `thread-${nextThreadSerial}`;
  const id = sendRequest("thread/start", {
    threadId: bbThreadId,
    cwd: workspaceDir,
    agent: args?.agent ?? {
      command: process.execPath,
      args: [FAKE_AGENT_PATH],
    },
    ...(args?.modelSelection ? { modelSelection: args.modelSelection } : {}),
    permissionMode: args?.permissionMode ?? "full",
    permissionEscalation:
      args?.permissionEscalation === undefined
        ? null
        : args.permissionEscalation,
    workspaceWriteRoots: [workspaceDir],
    ...(args?.envVars ? { envVars: args.envVars } : {}),
    ...(args?.instructions ? { instructions: args.instructions } : {}),
    ...(args?.dynamicTools ? { dynamicTools: args.dynamicTools } : {}),
  });
  const response = await waitForResponse(id);
  if (response.error) {
    throw new Error(`thread/start failed: ${response.error.message}`);
  }
  const result = response.result;
  if (
    typeof result !== "object" ||
    result === null ||
    Array.isArray(result) ||
    typeof result.providerThreadId !== "string"
  ) {
    throw new Error("thread/start did not return a providerThreadId");
  }
  startedProviderThreadIds.push(result.providerThreadId);
  return { bbThreadId, providerThreadId: result.providerThreadId };
}

async function stopThread(providerThreadId: string): Promise<void> {
  const id = sendRequest("thread/stop", { threadId: providerThreadId });
  await waitForResponse(id);
}

async function waitForTurnCompleted(): Promise<BridgeJsonRpcOutputMessage> {
  return waitFor(
    () => notifications("acp/turn/completed").at(-1),
    "acp/turn/completed notification",
  );
}

function agentMessageTexts(): string[] {
  return notifications("acp/update").flatMap((message) => {
    const params = message.params;
    if (
      typeof params !== "object" ||
      params === null ||
      Array.isArray(params)
    ) {
      return [];
    }
    const update = params.update;
    if (
      typeof update !== "object" ||
      update === null ||
      Array.isArray(update)
    ) {
      return [];
    }
    if (update.sessionUpdate !== "agent_message_chunk") {
      return [];
    }
    const content = update.content;
    if (
      typeof content !== "object" ||
      content === null ||
      Array.isArray(content) ||
      typeof content.text !== "string"
    ) {
      return [];
    }
    return [content.text];
  });
}

function callDynamicToolBridge(args: {
  callId: string;
  host: string;
  port: number;
  threadId: string;
  token: string;
  tool: string;
  toolArguments: Record<string, unknown>;
}): Promise<unknown> {
  return new Promise((resolveCall, rejectCall) => {
    const socket = createConnection({ host: args.host, port: args.port });
    let buffer = "";
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      rejectCall(error);
    };
    socket.setEncoding("utf8");
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          arguments: args.toolArguments,
          callId: args.callId,
          threadId: args.threadId,
          token: args.token,
          tool: args.tool,
        })}\n`,
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = buffer.slice(0, newlineIndex);
      socket.end();
      if (settled) {
        return;
      }
      settled = true;
      try {
        resolveCall(JSON.parse(line));
      } catch (error) {
        rejectCall(error);
      }
    });
    socket.on("error", rejectOnce);
    socket.on("end", () => {
      if (!settled) {
        rejectOnce(
          new Error("Dynamic tool bridge socket closed without a response"),
        );
      }
    });
  });
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "bb-acp-bridge-test-"));
  output = captureBridgeJsonRpcOutput();
});

afterEach(async () => {
  for (const providerThreadId of startedProviderThreadIds.splice(0)) {
    await stopThread(providerThreadId);
  }
  vi.unstubAllEnvs();
  output.restore();
  rmSync(workspaceDir, { recursive: true, force: true });
});

describe("acp bridge", () => {
  it("answers initialize and lists grouped models without spawning an agent", async () => {
    const initializeId = sendRequest("initialize", {
      clientInfo: { name: "bb", version: "1.0.0" },
    });
    expect((await waitForResponse(initializeId)).result).toEqual({ ok: true });

    const modelListId = sendRequest("model/list", {
      listCommand: {
        command: process.execPath,
        args: [
          "-e",
          'console.log("Available models\\n\\nauto - Auto\\ngrouped-1-low - Grouped One Low\\ngrouped-1 - Grouped One\\ngrouped-1-high - Grouped One High")',
        ],
      },
      primaryModels: ["auto"],
    });
    const response = await waitForResponse(modelListId);
    expect(response.result).toMatchObject({
      models: [{ id: "auto", displayName: "Auto", isDefault: true }],
      selectedOnlyModels: [
        {
          id: "grouped-1",
          displayName: "Grouped One",
          isDefault: false,
          defaultReasoningEffort: "medium",
        },
      ],
    });
    const selectedOnly = (
      response.result as {
        selectedOnlyModels: {
          supportedReasoningEfforts: { reasoningEffort: string }[];
        }[];
      }
    ).selectedOnlyModels;
    expect(
      selectedOnly[0]?.supportedReasoningEfforts.map((e) => e.reasoningEffort),
    ).toEqual(["low", "medium", "high"]);
  });

  it("answers a minimal model/list (no params) with the synthetic default", async () => {
    // The packaged-bridge smoke test sends `model/list` with empty params and
    // no agent binary on PATH; the bridge must still respond (not hang) so the
    // generic cross-bridge smoke contract holds.
    const modelListId = sendRequest("model/list", {});
    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
      selectedOnlyModels: [],
    });
  });

  it("uses the CLI model list before ACP-native session discovery when both are present", async () => {
    const modelListId = sendRequest("model/list", {
      listCommand: {
        command: process.execPath,
        args: ["-e", 'console.log("cli-model - CLI Model")'],
      },
      agent: {
        command: "/nonexistent/acp-session-discovery-agent",
        args: [],
      },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [{ id: "cli-model", displayName: "CLI Model", isDefault: true }],
      selectedOnlyModels: [],
    });
  });

  it("discovers ACP-native models and per-model reasoning from session configOptions", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: {
          FAKE_ACP_MODEL_CONFIG: "1",
          FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
        },
      },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          model: "fake/default",
          displayName: "Fake Default",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
        {
          id: "fake/strong",
          model: "fake/strong",
          displayName: "Fake Strong",
          isDefault: false,
          defaultReasoningEffort: "none",
          supportedReasoningEfforts: [
            { reasoningEffort: "none" },
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
            { reasoningEffort: "xhigh" },
          ],
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("discovers ACP-native models from session models state", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: { FAKE_ACP_MODELS_FIELD: "1" },
      },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          model: "fake/default",
          displayName: "Fake Default",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
        {
          id: "fake/strong",
          model: "fake/strong",
          displayName: "Fake Strong",
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("probes per-model reasoning across large catalogs instead of falling back", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: {
          FAKE_ACP_MODEL_CONFIG: "1",
          FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
          FAKE_ACP_MODEL_COUNT: "60",
        },
      },
      primaryModels: [],
    });

    const result = (await waitForResponse(modelListId)).result as {
      models: {
        id: string;
        supportedReasoningEfforts: { reasoningEffort: string }[];
      }[];
    };
    expect(result.models).toHaveLength(60);
    const lastGenerated = result.models.find(
      (model) => model.id === "fake/gen-59",
    );
    expect(lastGenerated?.supportedReasoningEfforts).toEqual([
      { reasoningEffort: "low", description: "low" },
      { reasoningEffort: "medium", description: "medium" },
      { reasoningEffort: "high", description: "high" },
    ]);
  });

  it("keeps ACP-native discovered models when per-model reasoning discovery errors", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: {
          FAKE_ACP_MODEL_CONFIG: "1",
          FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
          FAKE_ACP_SET_CONFIG_MODEL_ERROR: "1",
        },
      },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          model: "fake/default",
          displayName: "Fake Default",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
        {
          id: "fake/strong",
          model: "fake/strong",
          displayName: "Fake Strong",
          isDefault: false,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [{ reasoningEffort: "medium" }],
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("times out hung ACP-native discovery, kills the child, and falls back to the synthetic model", async () => {
    const signalFile = join(workspaceDir, "discovery-agent-signal.txt");
    const readyFile = join(workspaceDir, "discovery-agent-ready.txt");
    let modelListId: number;

    vi.useFakeTimers();
    try {
      modelListId = sendRequest("model/list", {
        agent: {
          command: process.execPath,
          args: [FAKE_AGENT_PATH],
          envVars: {
            FAKE_ACP_HANG_INITIALIZE: "1",
            FAKE_ACP_READY_FILE: readyFile,
            FAKE_ACP_SIGNAL_FILE: signalFile,
          },
        },
        primaryModels: [],
      });
      await waitForFileWithRealTimer(readyFile);
      await vi.advanceTimersByTimeAsync(30_000);
    } finally {
      vi.useRealTimers();
    }

    expect((await waitForResponse(modelListId!)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
      selectedOnlyModels: [],
    });
    await waitFor(
      () => (existsSync(signalFile) ? true : undefined),
      "discovery agent termination",
      5_000,
    );
  });

  it("serves ACP-native discovered models from cache within the TTL and re-discovers after it", async () => {
    const launchLog = join(workspaceDir, "discovery-launches.txt");
    const agent = {
      command: process.execPath,
      args: [FAKE_AGENT_PATH],
      envVars: { FAKE_ACP_MODEL_CONFIG: "1", FAKE_ACP_LAUNCH_LOG: launchLog },
    };
    const launchCount = () =>
      existsSync(launchLog)
        ? readFileSync(launchLog, "utf8").trim().split("\n").filter(Boolean)
            .length
        : 0;
    const listModels = async () =>
      (
        await waitForResponse(
          sendRequest("model/list", { agent, primaryModels: [] }),
        )
      ).result;

    // Fake only Date so real timers/I/O still drive the subprocess discovery
    // and the wait helpers; we advance the clock to cross the discovery TTL.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(1_000_000);
      await listModels();
      expect(launchCount()).toBe(1);

      // Within the 60s TTL: served from cache, no new discovery spawn.
      vi.setSystemTime(1_030_000);
      await listModels();
      expect(launchCount()).toBe(1);

      // Past the TTL: re-discovers, spawning the agent again.
      vi.setSystemTime(1_061_000);
      const refreshed = await listModels();
      expect(launchCount()).toBe(2);
      expect(refreshed).toMatchObject({
        models: [
          { id: "fake/default", isDefault: true },
          { id: "fake/strong", isDefault: false },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the synthetic model when ACP-native session discovery has no model option", async () => {
    const modelListId = sendRequest("model/list", {
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      primaryModels: [],
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
      selectedOnlyModels: [],
    });
  });

  it("fails model/list with a clear error when the list command is missing", async () => {
    const failingId = sendRequest("model/list", {
      listCommand: {
        command: "/nonexistent/acp-model-lister",
        args: ["--list-models"],
      },
      primaryModels: [],
    });
    const failingResponse = await waitForResponse(failingId);
    expect(failingResponse.error?.message).toMatch(
      /spawn \/nonexistent\/acp-model-lister ENOENT/,
    );
  });

  it("fails model/list when the list command reports ACP auth is required", async () => {
    const authId = sendRequest("model/list", {
      listCommand: {
        command: process.execPath,
        args: [
          "-e",
          [
            "console.error(\"Error: Authentication required. Run 'agent login', pass --api-key/--auth-token, or set CURSOR_API_KEY/CURSOR_AUTH_TOKEN.\");",
            "process.exit(1);",
          ].join(""),
        ],
      },
      primaryModels: [],
    });

    const response = await waitForResponse(authId);
    expect(response.error?.message).toBe("ACP agent is not authenticated.");
  });

  it("falls back to the synthetic model when the list command prints no models", async () => {
    const emptyId = sendRequest("model/list", {
      listCommand: {
        command: process.execPath,
        args: ["-e", 'console.log("no model lines here")'],
      },
      primaryModels: [],
    });
    expect((await waitForResponse(emptyId)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
    });
  });

  it("keeps CLI reasoning on the resolved model variant instead of ACP config", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);
    // Seed the bridge's catalog cache the way a picker would.
    const listCommand = {
      command: process.execPath,
      args: [
        "-e",
        'console.log("pinme-low - Pin Me Low\\npinme - Pin Me\\npinme-extra-high - Pin Me Extra High")',
      ],
    };
    await waitForResponse(
      sendRequest("model/list", { listCommand, primaryModels: [] }),
    );

    // The fake agent runs via its shebang so the bridge's leading
    // `--model <id>` lands in the agent's argv instead of node's.
    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: [] },
      modelSelection: {
        listCommand,
        selectFlag: "--model",
        model: "pinme",
        reasoningLevel: "xhigh",
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();
    expect(
      agentMessageTexts().some(
        (text) => text === "argv:--model pinme-extra-high",
      ),
    ).toBe(true);
  });

  it("selects ACP-native models with session/set_config_option before the first prompt", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_MODEL_CONFIG: "1" },
      modelSelection: { modelId: "fake/strong" },
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-selected-model", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-model:fake/strong");
  });

  it("falls back to session/set_model when the model config option errors", async () => {
    const { providerThreadId } = await startThread({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_SET_CONFIG_MODEL_ERROR: "1",
      },
      modelSelection: { modelId: "fake/strong" },
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-selected-model", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-model:fake/strong");
  });

  it("selects ACP-native models from session models state", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_MODELS_FIELD: "1" },
      modelSelection: { modelId: "fake/strong" },
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-selected-model", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-model:fake/strong");
  });

  it("selects ACP-native reasoning with session/set_config_option before the first prompt", async () => {
    const { providerThreadId } = await startThread({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
      },
      modelSelection: { modelId: "fake/strong", reasoningLevel: "max" },
    });

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-selected-effort", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-effort:xhigh");
  });

  it("keeps ACP-native models without thought_level at the single managed level", async () => {
    const modelListId = sendRequest("model/list", {
      agent: {
        command: process.execPath,
        args: [FAKE_AGENT_PATH],
        envVars: { FAKE_ACP_MODEL_CONFIG: "1" },
      },
      primaryModels: [],
    });

    const response = await waitForResponse(modelListId);
    const models = (
      response.result as {
        models: {
          id: string;
          supportedReasoningEfforts: { reasoningEffort: string }[];
        }[];
      }
    ).models;
    expect(
      models.find((model) => model.id === "fake/strong")
        ?.supportedReasoningEfforts,
    ).toEqual([{ reasoningEffort: "medium", description: expect.any(String) }]);
  });

  it("does not leak bridge-only Electron env to the spawned agent", async () => {
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    const { providerThreadId } = await startThread();

    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [
        { type: "text", text: "echo-electron-run-as-node", mentions: [] },
      ],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("electron-run-as-node:missing");
  });

  it("warns and launches the family id when a reasoning variant is missing", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);
    const listCommand = {
      command: process.execPath,
      args: ["-e", 'console.log("solo-2 - Solo Two")'],
    };
    await waitForResponse(
      sendRequest("model/list", { listCommand, primaryModels: [] }),
    );

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: [] },
      modelSelection: {
        listCommand,
        selectFlag: "--model",
        model: "solo-2",
        reasoningLevel: "max",
      },
    });
    sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();
    expect(
      agentMessageTexts().some((text) => text === "argv:--model solo-2"),
    ).toBe(true);
    const warning = notifications("acp/warning").at(-1);
    expect(warning?.params).toMatchObject({
      summary: expect.stringContaining("no max reasoning variant"),
    });
  });

  it("starts a session and runs a prompt turn end to end", async () => {
    const { bbThreadId, providerThreadId } = await startThread();
    expect(providerThreadId).toMatch(/^fake-sess-\d+$/);

    const identity = notifications("thread/identity").at(-1);
    expect(identity?.params).toEqual({
      threadId: bbThreadId,
      providerThreadId,
    });

    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "hello there", mentions: [] }],
    });
    await waitForResponse(turnId);

    const completed = await waitForTurnCompleted();
    expect(completed.params).toEqual({
      threadId: bbThreadId,
      stopReason: "end_turn",
    });
    expect(notifications("acp/turn/started")).toHaveLength(1);
    expect(agentMessageTexts()).toContain("echo:hello there");
  });

  it("passes dynamic tools to ACP sessions as an MCP server", async () => {
    const { providerThreadId } = await startThread({
      dynamicTools: [
        {
          name: "update_environment_directory",
          description: "Move this thread to another environment directory.",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });

    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-mcp-servers", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain(
      `mcp-servers:${ACP_BRIDGE_MCP_SERVER_NAME}`,
    );
  });

  it("forwards ACP dynamic tool calls through the runtime tool-call contract", async () => {
    const { bbThreadId, providerThreadId } = await startThread({
      dynamicTools: [
        {
          name: "update_environment_directory",
          description: "Move this thread to another environment directory.",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    });

    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "echo-mcp-server-config", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    const configPrefix = "mcp-server-config:";
    const configText = agentMessageTexts().find((text) =>
      text.startsWith(configPrefix),
    );
    if (!configText) {
      throw new Error("Fake ACP agent did not report MCP server config");
    }
    const [mcpServerConfig] = JSON.parse(
      configText.slice(configPrefix.length),
    ) as { env: { name: string; value: string }[]; name: string }[];
    if (!mcpServerConfig) {
      throw new Error("Fake ACP agent reported no MCP server config");
    }
    expect(mcpServerConfig?.name).toBe(ACP_BRIDGE_MCP_SERVER_NAME);
    const env = new Map(
      mcpServerConfig.env.map(({ name, value }) => [name, value]),
    );
    const host = env.get("BB_ACP_DYNAMIC_TOOL_HOST");
    const port = Number(env.get("BB_ACP_DYNAMIC_TOOL_PORT"));
    const threadId = env.get("BB_ACP_DYNAMIC_TOOL_THREAD_ID");
    const token = env.get("BB_ACP_DYNAMIC_TOOL_TOKEN");
    if (!host || !Number.isInteger(port) || !threadId || !token) {
      throw new Error("MCP server config is missing dynamic tool bridge env");
    }

    const bridgeCall = callDynamicToolBridge({
      callId: "test-dynamic-tool-call",
      host,
      port,
      threadId,
      token,
      tool: "update_environment_directory",
      toolArguments: { path: "/tmp/next-worktree" },
    });
    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (message) =>
            message.method === "item/tool/call" && message.id !== undefined,
        ),
      "forwarded dynamic tool call",
    );
    expect(forwarded.params).toMatchObject({
      arguments: { path: "/tmp/next-worktree" },
      providerThreadId,
      threadId: bbThreadId,
      tool: "update_environment_directory",
      turnId: null,
    });

    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: forwarded.id,
        result: {
          success: true,
          contentItems: [
            { type: "inputText", text: "environment directory updated" },
          ],
        },
      }),
    );

    await expect(bridgeCall).resolves.toEqual({
      content: "environment directory updated",
      isError: false,
      ok: true,
    });
  });

  it("prepends instructions to the first prompt only", async () => {
    const { providerThreadId } = await startThread({
      instructions: "Be terse.",
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "hi", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    const texts = agentMessageTexts();
    expect(texts.at(-1)).toBe(
      "echo:<system_instructions>\nBe terse.\n</system_instructions>\nhi",
    );
  });

  it("auto-allows permission requests in full mode", async () => {
    const { providerThreadId } = await startThread({ permissionMode: "full" });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "request-permission", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(notifications("acp/permission/request")).toHaveLength(0);
    expect(agentMessageTexts()).toContain("permission:yes");
  });

  it("forwards permission requests to the runtime in ask mode", async () => {
    const { bbThreadId, providerThreadId } = await startThread({
      permissionMode: "workspace-write",
      permissionEscalation: "ask",
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "request-permission", mentions: [] }],
    });
    await waitForResponse(turnId);

    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (message) =>
            message.method === "acp/permission/request" &&
            message.id !== undefined,
        ),
      "forwarded permission request",
    );
    expect(forwarded.params).toMatchObject({
      threadId: bbThreadId,
      providerThreadId,
      turnId: null,
      toolCall: {
        toolCallId: "perm-tool-1",
        kind: "execute",
        command: "rm -rf /tmp/scratch",
      },
    });

    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: forwarded.id,
        result: { decision: "deny" },
      }),
    );

    await waitForTurnCompleted();
    expect(agentMessageTexts()).toContain("permission:no");
  });

  it("answers session-grant decisions with the allow_always option", async () => {
    const { providerThreadId } = await startThread({
      permissionMode: "workspace-write",
      permissionEscalation: "ask",
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "request-permission", mentions: [] }],
    });
    await waitForResponse(turnId);
    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (message) =>
            message.method === "acp/permission/request" &&
            message.id !== undefined,
        ),
      "forwarded permission request",
    );
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: forwarded.id,
        result: { decision: "allow_for_session" },
      }),
    );
    await waitForTurnCompleted();
    expect(agentMessageTexts()).toContain("permission:always");
  });

  it("performs client fs writes inside the workspace and reports them", async () => {
    const targetPath = join(workspaceDir, "agent-output.txt");
    const { bbThreadId, providerThreadId } = await startThread({
      permissionMode: "workspace-write",
      permissionEscalation: "ask",
      envVars: { FAKE_ACP_WRITE_PATH: targetPath },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("write:ok");
    expect(readFileSync(targetPath, "utf8")).toBe("hello from agent\n");
    const fsWrite = notifications("acp/fs/write").at(-1);
    expect(fsWrite?.params).toMatchObject({
      threadId: bbThreadId,
      path: targetPath,
      kind: "add",
    });
  });

  it("denies client fs writes in readonly mode", async () => {
    const targetPath = join(workspaceDir, "denied.txt");
    const { providerThreadId } = await startThread({
      permissionMode: "readonly",
      permissionEscalation: "deny",
      envVars: { FAKE_ACP_WRITE_PATH: targetPath },
    });
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("write:denied");
    expect(existsSync(targetPath)).toBe(false);
    expect(notifications("acp/fs/write")).toHaveLength(0);
  });

  it("denies client fs writes outside the workspace in workspace-write mode", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "bb-acp-outside-"));
    const targetPath = join(outsideDir, "outside.txt");
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "workspace-write",
        permissionEscalation: "ask",
        envVars: { FAKE_ACP_WRITE_PATH: targetPath },
      });
      const turnId = sendRequest("turn/start", {
        threadId: providerThreadId,
        input: [{ type: "text", text: "write-file", mentions: [] }],
      });
      await waitForResponse(turnId);
      await waitForTurnCompleted();

      expect(agentMessageTexts()).toContain("write:denied");
      expect(existsSync(targetPath)).toBe(false);
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("chains steer input onto the active turn", async () => {
    const { providerThreadId } = await startThread();
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "slow first", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitFor(
      () =>
        agentMessageTexts().includes("echo:slow first") ? true : undefined,
      "first prompt echo",
    );

    const steerId = sendRequest("turn/steer", {
      threadId: providerThreadId,
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "steered", mentions: [] }],
    });
    await waitForResponse(steerId);

    await waitForTurnCompleted();
    expect(agentMessageTexts()).toContain("echo:steered");
    // One bb turn spans both prompts.
    expect(notifications("acp/turn/started")).toHaveLength(1);
    expect(notifications("acp/turn/completed")).toHaveLength(1);
  });

  it("rejects steers when no turn is active", async () => {
    const { providerThreadId } = await startThread();
    const steerId = sendRequest("turn/steer", {
      threadId: providerThreadId,
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "late", mentions: [] }],
    });
    const response = await waitForResponse(steerId);
    expect(response.error?.message).toMatch(/No active turn/);
  });

  it("cancels the active turn on thread/stop", async () => {
    const { bbThreadId, providerThreadId } = await startThread();
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "hang", mentions: [] }],
    });
    await waitForResponse(turnId);

    const stopId = sendRequest("thread/stop", { threadId: providerThreadId });
    const stopResponse = await waitForResponse(stopId);
    expect(stopResponse.result).toEqual({ ok: true });

    const completed = await waitForTurnCompleted();
    expect(completed.params).toEqual({
      threadId: bbThreadId,
      stopReason: "cancelled",
    });
    startedProviderThreadIds.pop();
  });

  it("resumes via session/load when the agent supports it", async () => {
    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.bbThreadId,
      providerThreadId: first.providerThreadId,
      cwd: workspaceDir,
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
    });
    expect(notifications("acp/warning")).toHaveLength(0);
    startedProviderThreadIds.push(first.providerThreadId);
  });

  it("re-applies ACP-native reasoning after session/load resume", async () => {
    const first = await startThread({
      envVars: {
        FAKE_ACP_LOAD_SESSION: "1",
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
      },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.bbThreadId,
      providerThreadId: first.providerThreadId,
      cwd: workspaceDir,
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      modelSelection: { modelId: "fake/strong", reasoningLevel: "high" },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
      envVars: {
        FAKE_ACP_LOAD_SESSION: "1",
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
      },
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
    });
    startedProviderThreadIds.push(first.providerThreadId);

    sendRequest("turn/start", {
      threadId: first.providerThreadId,
      input: [{ type: "text", text: "echo-selected-effort", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-effort:high");
  });

  it("falls back to a fresh session with a warning when load is unsupported", async () => {
    const resumeId = sendRequest("thread/resume", {
      threadId: "thread-resume-fallback",
      providerThreadId: "fake-sess-stale",
      cwd: workspaceDir,
      agent: { command: process.execPath, args: [FAKE_AGENT_PATH] },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
    });
    const response = await waitForResponse(resumeId);
    const result = response.result;
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result) ||
      typeof result.providerThreadId !== "string"
    ) {
      throw new Error("thread/resume did not return a providerThreadId");
    }
    expect(result.providerThreadId).not.toBe("fake-sess-stale");
    startedProviderThreadIds.push(result.providerThreadId);

    const warning = notifications("acp/warning").at(-1);
    expect(warning?.params).toMatchObject({
      threadId: "thread-resume-fallback",
    });
  });

  it("reports unexpected agent exits as a single provider error", async () => {
    const { bbThreadId, providerThreadId } = await startThread();
    const turnId = sendRequest("turn/start", {
      threadId: providerThreadId,
      input: [{ type: "text", text: "die", mentions: [] }],
    });
    await waitForResponse(turnId);

    const errors = await waitFor(() => {
      const errorNotifications = notifications("error");
      return errorNotifications.length > 0 ? errorNotifications : undefined;
    }, "agent exit error notification");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.params).toMatchObject({ threadId: bbThreadId });
    // The session is gone; a stop for it settles without error.
    startedProviderThreadIds.pop();
  });

  it("fails thread/start with a clear error when the agent command is missing", async () => {
    const id = sendRequest("thread/start", {
      threadId: "thread-missing-agent",
      cwd: workspaceDir,
      agent: { command: "definitely-not-a-real-binary-bb", args: [] },
      permissionMode: "full",
      permissionEscalation: null,
      workspaceWriteRoots: [workspaceDir],
    });
    const response = await waitForResponse(id);
    expect(response.error?.message).toMatch(/definitely-not-a-real-binary-bb/);
  });
});
