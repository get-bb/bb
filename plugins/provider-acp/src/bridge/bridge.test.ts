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
import { createStandaloneBuiltinCompactCommandInput } from "@bb/domain";
import type { DynamicTool, ReasoningLevel } from "@bb/domain";
import { PROVIDER_BRIDGE_PROTOCOL_VERSION } from "@bb/provider-bridge-protocol";
import {
  captureBridgeJsonRpcOutput,
  type BridgeJsonRpcOutputMessage,
  type CapturedBridgeJsonRpcOutput,
} from "@bb/provider-bridge-protocol/testing";
import { assembleCapturedThreadEvents } from "@bb/agent-runtime/test/bridge-delta-assembly";
import { handleLine } from "./bridge.js";
import { ACP_BRIDGE_NO_ACTIVE_TURN_ERROR_CODE } from "../bridge-protocol.js";
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

/**
 * The canonical thread events the bridge's output assembles to, oldest first.
 * The bridge emits `thread/delta` notifications; every session-scoped
 * assertion runs the full capture through a real runtime delta assembler
 * (the exact translation the bridge-protocol adapter performs). A fresh
 * assembler per call over the full ordered capture keeps ids deterministic.
 */
function threadEvents(): Record<string, unknown>[] {
  return assembleCapturedThreadEvents(output.messages, "acp") as unknown as
    Record<string, unknown>[];
}

function threadEventsOfType(type: string): Record<string, unknown>[] {
  return threadEvents().filter((event) => event.type === type);
}

/** The bb thread id a provider session id belongs to. */
const bbThreadIdByProviderThreadId = new Map<string, string>();

function bbThreadIdFor(providerThreadId: string): string {
  const recorded = bbThreadIdByProviderThreadId.get(providerThreadId);
  if (recorded !== undefined) {
    return recorded;
  }
  // Sessions started with a raw request are only visible through the identity
  // the bridge announced for them.
  for (const message of notifications("thread/identity")) {
    const params = message.params;
    if (
      typeof params === "object" &&
      params !== null &&
      !Array.isArray(params) &&
      params.providerThreadId === providerThreadId &&
      typeof params.threadId === "string"
    ) {
      return params.threadId;
    }
  }
  throw new Error(`No bb thread id recorded for ${providerThreadId}`);
}

const CLIENT_REQUEST_ID = "creq_abcdefghjk";

function executionOptions(args: {
  permissionMode?: "accept-edits" | "full";
  permissionEscalation?: "ask" | "deny" | null;
  envVars?: Record<string, string>;
  instructions?: string;
  model?: string;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: "default" | "fast";
  providerOptions?: Record<string, unknown>;
}): Record<string, unknown> {
  const permissionMode = args.permissionMode ?? "full";
  return {
    ...(permissionMode === "full"
      ? {
          permissionMode: "full",
          permissionScope: "full",
          approvalReviewer: null,
          permissionEscalation: null,
        }
      : {
          permissionMode: "accept-edits",
          permissionScope: "workspace",
          approvalReviewer: "user",
          permissionEscalation: args.permissionEscalation ?? "ask",
        }),
    ...(args.envVars ? { envVars: args.envVars } : {}),
    ...(args.instructions ? { instructions: args.instructions } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.reasoningLevel ? { reasoningLevel: args.reasoningLevel } : {}),
    ...(args.serviceTier ? { serviceTier: args.serviceTier } : {}),
    ...(args.providerOptions ? { providerOptions: args.providerOptions } : {}),
  };
}

interface AgentLaunchArgs {
  agent?: { command: string; args: string[] };
  envVars?: Record<string, string>;
  /** `listArgs` the agent binary itself understands (see the fake agent). */
  modelListArgs?: string[];
  selectFlag?: string;
  primaryModels?: string[];
  reasoningCli?: {
    flag: string;
    supportedLevels: ReasoningLevel[];
    levelValues?: Partial<Record<ReasoningLevel, string>>;
    defaultLevel?: ReasoningLevel;
  };
  nativeReasoning?: {
    configId: string;
    supportedLevels: ReasoningLevel[];
    levelValues?: Partial<Record<ReasoningLevel, string>>;
    defaultLevel?: ReasoningLevel;
  };
  permissionCli?: {
    full?: string[];
    workspaceWrite?: string[];
    readonly?: string[];
    insertAfterArgs?: number;
  };
}

/**
 * The ACP launch spec a request carries in `options.providerOptions`; the
 * bridge derives the agent command, model discovery, and every CLI flag set
 * from it.
 */
function acpLaunchSpec(args: AgentLaunchArgs): Record<string, unknown> {
  const agent = args.agent ?? {
    command: process.execPath,
    args: [FAKE_AGENT_PATH],
  };
  return {
    displayName: "Fake ACP",
    command: agent.command,
    args: agent.args,
    env: args.envVars ?? {},
    ...(args.modelListArgs
      ? {
          modelCli: {
            // The bridge runs the agent binary itself for model discovery, so
            // the list args replace the launch args entirely.
            listArgs: [...agent.args, ...args.modelListArgs],
            ...(args.selectFlag ? { selectFlag: args.selectFlag } : {}),
            primaryModels: args.primaryModels ?? [],
          },
        }
      : {}),
    ...(args.reasoningCli ? { reasoningCli: args.reasoningCli } : {}),
    ...(args.nativeReasoning ? { nativeReasoning: args.nativeReasoning } : {}),
    ...(args.permissionCli ? { permissionCli: args.permissionCli } : {}),
  };
}

interface StartThreadArgs extends AgentLaunchArgs {
  permissionMode?: "accept-edits" | "full";
  permissionEscalation?: "ask" | "deny" | null;
  instructions?: string;
  dynamicTools?: DynamicTool[];
  model?: string;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: "default" | "fast";
  additionalWorkspaceWriteRoots?: string[];
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
    instructionMode: "append",
    options: executionOptions({
      ...args,
      providerOptions: {
        acpLaunchSpec: acpLaunchSpec(args ?? {}),
        ...(args?.additionalWorkspaceWriteRoots
          ? {
              additionalWorkspaceWriteRoots: args.additionalWorkspaceWriteRoots,
            }
          : {}),
      },
    }),
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
  bbThreadIdByProviderThreadId.set(result.providerThreadId, bbThreadId);
  return { bbThreadId, providerThreadId: result.providerThreadId };
}

async function stopThread(providerThreadId: string): Promise<void> {
  const id = sendRequest("thread/stop", {
    threadId: bbThreadIdFor(providerThreadId),
    providerThreadId,
    intent: "interrupt",
    activeTurnId: null,
  });
  await waitForResponse(id);
}

/** Send a turn request in the canonical shape, keyed by provider session id. */
/** Send `model/list` with the launch spec the bridge derives everything from. */
function sendModelList(
  args: AgentLaunchArgs & { modelLines?: string } = {},
): number {
  const { modelLines, ...launch } = args;
  return sendRequest("model/list", {
    providerOptions: {
      acpLaunchSpec: acpLaunchSpec(
        modelLines === undefined
          ? launch
          : {
              ...launch,
              modelListArgs: launch.modelListArgs ?? ["--list-models"],
              envVars: {
                ...launch.envVars,
                FAKE_ACP_MODEL_LINES: modelLines,
              },
            },
      ),
    },
  });
}

function sendTurnRequest(
  method: "turn/start" | "turn/steer",
  providerThreadId: string,
  params: Record<string, unknown>,
): number {
  return sendRequest(method, {
    threadId: bbThreadIdFor(providerThreadId),
    providerThreadId,
    clientRequestId: CLIENT_REQUEST_ID,
    options: executionOptions({}),
    ...params,
  });
}

/**
 * The composer's standalone builtin `/compact` mention, as a turn/start input:
 * bb's manual-compaction request rides the ordinary turn path.
 */
function compactCommandInput(): unknown[] {
  return JSON.parse(
    JSON.stringify(createStandaloneBuiltinCompactCommandInput()),
  ) as unknown[];
}

/** Prompt texts the fake agent recorded, oldest first. */
function loggedPrompts(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string);
}

async function waitForTurnCompleted(): Promise<Record<string, unknown>> {
  return waitFor(
    () => threadEventsOfType("turn/completed").at(-1),
    "turn/completed thread event",
  );
}

/**
 * Assistant text as the runtime sees it: the agent-message items the
 * translator opened, with their streamed deltas applied.
 */
function agentMessageTexts(): string[] {
  const textsByItemId = new Map<string, string>();
  const order: string[] = [];
  const track = (itemId: string): void => {
    if (!textsByItemId.has(itemId)) {
      order.push(itemId);
      textsByItemId.set(itemId, "");
    }
  };
  for (const event of threadEvents()) {
    if (event.type === "item/agentMessage/delta") {
      const itemId = String(event.itemId);
      track(itemId);
      textsByItemId.set(
        itemId,
        (textsByItemId.get(itemId) ?? "") + String(event.delta ?? ""),
      );
      continue;
    }
    const item = event.item;
    if (
      event.type !== "item/completed" ||
      typeof item !== "object" ||
      item === null ||
      Array.isArray(item)
    ) {
      continue;
    }
    const typedItem = item as { id: string; type: string; text?: string };
    if (typedItem.type !== "agentMessage") {
      continue;
    }
    track(typedItem.id);
    textsByItemId.set(typedItem.id, typedItem.text ?? "");
  }
  return order.map((id) => textsByItemId.get(id) ?? "");
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
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      client: { name: "bb", version: "1.0.0" },
    });
    expect((await waitForResponse(initializeId)).result).toMatchObject({
      protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
      capabilities: { fork: "tip", approvalEnforcedBy: "runtime" },
    });

    const modelListId = sendModelList({
      modelLines:
        "Available models\n\nauto - Auto\ngrouped-1-low - Grouped One Low\ngrouped-1 - Grouped One\ngrouped-1-high - Grouped One High",
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
    const modelListId = sendModelList({
      // The agent could also answer session-discovery, but a list command
      // wins: it is one process instead of a whole ACP session.
      envVars: { FAKE_ACP_MODEL_CONFIG: "1" },
      modelLines: "cli-model - CLI Model",
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [{ id: "cli-model", displayName: "CLI Model", isDefault: true }],
      selectedOnlyModels: [],
    });
  });

  it("discovers ACP-native models and per-model reasoning from session configOptions", async () => {
    const modelListId = sendModelList({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
      },
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
    const modelListId = sendModelList({
      envVars: { FAKE_ACP_MODELS_FIELD: "1" },
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

  it("advertises launch-time reasoning CLI levels on ACP-native models", async () => {
    const modelListId = sendModelList({
      envVars: { FAKE_ACP_MODELS_FIELD: "1" },
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        defaultLevel: "high",
      },
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
        {
          id: "fake/strong",
          defaultReasoningEffort: "high",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("authenticates before ACP-native model discovery", async () => {
    const modelListId = sendModelList({
      envVars: {
        FAKE_ACP_AUTH_METHODS: "cached_token",
        FAKE_ACP_MODEL_CONFIG: "1",
      },
    });

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [
        {
          id: "fake/default",
          model: "fake/default",
          displayName: "Fake Default",
        },
        {
          id: "fake/strong",
          model: "fake/strong",
          displayName: "Fake Strong",
        },
      ],
      selectedOnlyModels: [],
    });
  });

  it("probes per-model reasoning across large catalogs instead of falling back", async () => {
    const modelListId = sendModelList({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
        FAKE_ACP_MODEL_COUNT: "60",
      },
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
    const modelListId = sendModelList({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
        FAKE_ACP_SET_CONFIG_MODEL_ERROR: "1",
      },
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
      modelListId = sendModelList({
        envVars: {
          FAKE_ACP_HANG_INITIALIZE: "1",
          FAKE_ACP_READY_FILE: readyFile,
          FAKE_ACP_SIGNAL_FILE: signalFile,
        },
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
    const discoveryEnv = {
      FAKE_ACP_MODEL_CONFIG: "1",
      FAKE_ACP_LAUNCH_LOG: launchLog,
    };
    const launchCount = () =>
      existsSync(launchLog)
        ? readFileSync(launchLog, "utf8").trim().split("\n").filter(Boolean)
            .length
        : 0;
    const listModels = async () =>
      (await waitForResponse(sendModelList({ envVars: discoveryEnv }))).result;

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
    const modelListId = sendModelList();

    expect((await waitForResponse(modelListId)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
      selectedOnlyModels: [],
    });
  });

  it("fails model/list with a clear error when the list command is missing", async () => {
    const failingId = sendModelList({
      agent: { command: "/nonexistent/acp-model-lister", args: [] },
      modelLines: "",
    });
    const failingResponse = await waitForResponse(failingId);
    expect(failingResponse.error?.message).toMatch(
      /spawn \/nonexistent\/acp-model-lister ENOENT/,
    );
  });

  it("fails model/list when the list command reports ACP auth is required", async () => {
    const authId = sendModelList({
      envVars: {
        FAKE_ACP_MODEL_LIST_STDERR:
          "Error: Authentication required. Run 'agent login', pass --api-key/--auth-token, or set CURSOR_API_KEY/CURSOR_AUTH_TOKEN.",
      },
      modelLines: "",
    });

    const response = await waitForResponse(authId);
    expect(response.error?.message).toBe("ACP agent is not authenticated.");
  });

  it("falls back to the synthetic model when the list command prints no models", async () => {
    const emptyId = sendModelList({ modelLines: "no model lines here" });
    expect((await waitForResponse(emptyId)).result).toMatchObject({
      models: [{ id: "acp-default", isDefault: true }],
    });
  });

  it("keeps CLI reasoning on the resolved model variant instead of ACP config", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);
    // Seed the bridge's catalog cache the way a picker would. The fake agent
    // runs via its shebang so the bridge's leading `--model <id>` lands in the
    // agent's argv instead of node's.
    const cliModelLaunch = {
      agent: { command: FAKE_AGENT_PATH, args: [] },
      modelListArgs: ["--list-models"],
      selectFlag: "--model",
      envVars: {
        FAKE_ACP_MODEL_LINES:
          "pinme-low - Pin Me Low\npinme - Pin Me\npinme-extra-high - Pin Me Extra High",
      },
    };
    await waitForResponse(sendModelList(cliModelLaunch));

    const { providerThreadId } = await startThread({
      ...cliModelLaunch,
      model: "pinme",
      reasoningLevel: "xhigh",
    });
    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();
    expect(
      agentMessageTexts().some(
        (text) => text === "argv:--model pinme-extra-high",
      ),
    ).toBe(true);
  });

  it("launches ACP agents with a configured reasoning CLI flag", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: [] },
      reasoningLevel: "xhigh",
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { xhigh: "high", max: "high" },
        defaultLevel: "high",
      },
    });
    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(
      agentMessageTexts().some(
        (text) => text === "argv:--reasoning-effort high",
      ),
    ).toBe(true);
  });

  it("launches full-mode ACP agents with configured permission CLI args", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: ["agent", "stdio"] },
      permissionMode: "full",
      permissionCli: {
        full: ["--always-approve"],
        insertAfterArgs: 1,
      },
    });
    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(
      agentMessageTexts().some(
        (text) => text === "argv:agent --always-approve stdio",
      ),
    ).toBe(true);
  });

  it("does not apply full-mode permission CLI args in workspace-write mode", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);

    const { providerThreadId } = await startThread({
      agent: { command: FAKE_AGENT_PATH, args: [] },
      permissionMode: "accept-edits",
      permissionCli: {
        full: ["--always-approve"],
      },
    });
    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("argv:");
  });

  it("uses modelCli only for model selection when reasoningCli owns effort", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);
    const cliModelLaunch: AgentLaunchArgs = {
      agent: { command: FAKE_AGENT_PATH, args: [] },
      modelListArgs: ["--list-models"],
      selectFlag: "--model",
      envVars: { FAKE_ACP_MODEL_LINES: "pinme - Pin Me" },
      reasoningCli: {
        flag: "--reasoning-effort",
        supportedLevels: ["low", "medium", "high"],
        levelValues: { max: "high" },
      },
    };
    await waitForResponse(sendModelList(cliModelLaunch));

    const { providerThreadId } = await startThread({
      ...cliModelLaunch,
      model: "pinme",
      reasoningLevel: "max",
    });
    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(
      agentMessageTexts().some(
        (text) => text === "argv:--model pinme --reasoning-effort high",
      ),
    ).toBe(true);
  });

  it("selects ACP-native models with session/set_config_option before the first prompt", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_MODEL_CONFIG: "1" },
      model: "fake/strong",
    });

    sendTurnRequest("turn/start", providerThreadId, {
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
      model: "fake/strong",
    });

    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-selected-model", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-model:fake/strong");
  });

  it("selects ACP-native models from session models state", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_MODELS_FIELD: "1" },
      model: "fake/strong",
    });

    sendTurnRequest("turn/start", providerThreadId, {
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
      model: "fake/strong",
      reasoningLevel: "max",
    });

    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-selected-effort", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-effort:xhigh");
  });

  it("applies configured native reasoning when the ACP agent does not advertise thought_level", async () => {
    const { providerThreadId } = await startThread({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_ACCEPT_NATIVE_REASONING: "1",
      },
      model: "fake/strong",
      reasoningLevel: "max",
      nativeReasoning: {
        configId: "reasoning_effort",
        supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultLevel: "medium",
      },
    });

    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-selected-effort", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-effort:max");
  });

  it("keeps ACP-native models without thought_level at the single managed level", async () => {
    const modelListId = sendModelList({
      envVars: { FAKE_ACP_MODEL_CONFIG: "1" },
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

  it("keeps reasoning empty when an ACP-native model advertises only unmapped thought levels", async () => {
    const modelListId = sendModelList({
      envVars: {
        FAKE_ACP_MODEL_CONFIG: "1",
        FAKE_ACP_UNMAPPED_REASONING_CONFIG: "1",
      },
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
    ).toEqual([]);
  });

  it("shows configured native reasoning for ACP-native models without thought_level", async () => {
    const modelListId = sendModelList({
      envVars: { FAKE_ACP_MODEL_CONFIG: "1" },
      nativeReasoning: {
        configId: "reasoning_effort",
        supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
        defaultLevel: "medium",
      },
    });

    const response = await waitForResponse(modelListId);
    const models = (
      response.result as {
        models: {
          id: string;
          supportedReasoningEfforts: { reasoningEffort: string }[];
          defaultReasoningEffort: string;
        }[];
      }
    ).models;
    const strong = models.find((model) => model.id === "fake/strong");
    expect(strong?.defaultReasoningEffort).toBe("medium");
    expect(strong?.supportedReasoningEfforts).toEqual([
      { reasoningEffort: "none", description: "No extended thinking" },
      { reasoningEffort: "low", description: "Low reasoning effort" },
      { reasoningEffort: "medium", description: "Medium reasoning effort" },
      { reasoningEffort: "high", description: "High reasoning effort" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning effort" },
      { reasoningEffort: "max", description: "Maximum reasoning effort" },
    ]);
  });

  it("does not leak bridge-only Electron env to the spawned agent", async () => {
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
    const { providerThreadId } = await startThread();

    sendTurnRequest("turn/start", providerThreadId, {
      input: [
        { type: "text", text: "echo-electron-run-as-node", mentions: [] },
      ],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("electron-run-as-node:missing");
  });

  it("preserves Electron Node mode for the dynamic-tool MCP process only", async () => {
    vi.stubEnv("ELECTRON_RUN_AS_NODE", "1");
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

    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-mcp-server-config", mentions: [] }],
    });
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
    ) as { env: { name: string; value: string }[] }[];
    expect(
      mcpServerConfig?.env.find(({ name }) => name === "ELECTRON_RUN_AS_NODE")
        ?.value,
    ).toBe("1");

    sendTurnRequest("turn/start", providerThreadId, {
      input: [
        { type: "text", text: "echo-electron-run-as-node", mentions: [] },
      ],
    });
    await waitFor(
      () =>
        agentMessageTexts().find(
          (text) => text === "electron-run-as-node:missing",
        ),
      "agent environment report",
    );
  });

  it("warns and launches the family id when a reasoning variant is missing", async () => {
    chmodSync(FAKE_AGENT_PATH, 0o755);
    const cliModelLaunch = {
      agent: { command: FAKE_AGENT_PATH, args: [] },
      modelListArgs: ["--list-models"],
      selectFlag: "--model",
      envVars: { FAKE_ACP_MODEL_LINES: "solo-2 - Solo Two" },
    };
    await waitForResponse(sendModelList(cliModelLaunch));

    const { providerThreadId } = await startThread({
      ...cliModelLaunch,
      model: "solo-2",
      reasoningLevel: "max",
    });
    sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-argv", mentions: [] }],
    });
    await waitForTurnCompleted();
    expect(
      agentMessageTexts().some((text) => text === "argv:--model solo-2"),
    ).toBe(true);
    expect(threadEventsOfType("provider/warning").at(-1)).toMatchObject({
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
      sessionRestorable: false,
    });

    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "hello there", mentions: [] }],
    });
    await waitForResponse(turnId);

    const completed = await waitForTurnCompleted();
    expect(completed).toMatchObject({ status: "completed" });
    expect(threadEventsOfType("turn/started")).toHaveLength(1);
    expect(agentMessageTexts()).toContain("echo:hello there");
  });

  it("authenticates ACP sessions with cached tokens when advertised", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_AUTH_METHODS: "cached_token" },
    });

    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-auth-method", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("auth-method:cached_token");
  });

  it("prefers xAI API-key auth when XAI_API_KEY is available", async () => {
    const { providerThreadId } = await startThread({
      envVars: {
        FAKE_ACP_AUTH_METHODS: "cached_token,xai.api_key",
        XAI_API_KEY: "xai-test-key",
      },
    });

    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "echo-auth-method", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("auth-method:xai.api_key");
  });

  it("lets agents surface their own error for unsupported advertised auth methods", async () => {
    nextThreadSerial += 1;
    const id = sendRequest("thread/start", {
      threadId: `thread-${nextThreadSerial}`,
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: { FAKE_ACP_AUTH_METHODS: "agent.login" },
          }),
        },
      }),
    });
    const response = await waitForResponse(id);

    expect(response.error?.message).toContain("Authentication required");
    expect(response.error?.message).not.toContain("does not support");
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

    const turnId = sendTurnRequest("turn/start", providerThreadId, {
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

    const turnId = sendTurnRequest("turn/start", providerThreadId, {
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

  // Canonical sessions carry no skill roots in their options; the roots the
  // runtime configures once per process must reach the session instructions of
  // every session built afterwards, or injected skills are silently dropped.
  it("lists skills/configure roots in canonical session instructions", async () => {
    const configureId = sendRequest("skills/configure", {
      roots: [
        {
          id: "root_a",
          path: "/staged/acp-skills",
          skills: [{ name: "deploy", description: "Ship the app." }],
        },
      ],
    });
    expect((await waitForResponse(configureId)).error).toBeUndefined();

    const promptLog = join(workspaceDir, "canonical-skills-prompt-log.jsonl");
    const threadId = "thread-canonical-skills";
    const startId = sendRequest("thread/start", {
      threadId,
      cwd: workspaceDir,
      instructionMode: "append",
      options: {
        instructions: "Be terse.",
        envVars: { FAKE_ACP_PROMPT_LOG: promptLog },
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
        providerOptions: {
          acpLaunchSpec: {
            displayName: "Fake ACP Agent",
            command: process.execPath,
            args: [FAKE_AGENT_PATH],
            env: {},
          },
        },
      },
    });
    const startResponse = await waitForResponse(startId);
    expect(startResponse.error).toBeUndefined();
    const providerThreadId =
      typeof startResponse.result === "object" &&
      startResponse.result !== null &&
      !Array.isArray(startResponse.result) &&
      typeof startResponse.result.providerThreadId === "string"
        ? startResponse.result.providerThreadId
        : "";
    startedProviderThreadIds.push(providerThreadId);

    const turnId = sendRequest("turn/start", {
      threadId,
      providerThreadId,
      clientRequestId: "creq_abcdefghjk",
      input: [{ type: "text", text: "hi", mentions: [] }],
      options: {
        permissionMode: "full",
        permissionScope: "full",
        approvalReviewer: null,
        permissionEscalation: null,
      },
    });
    await waitForResponse(turnId);
    await waitForFileWithRealTimer(promptLog);

    const prompt: unknown = JSON.parse(
      readFileSync(promptLog, "utf8").trim().split("\n")[0] ?? "null",
    );
    expect(prompt).toContain("Available bb skills:");
    expect(prompt).toContain(
      "- deploy: Ship the app. (SKILL.md: /staged/acp-skills/deploy/SKILL.md)",
    );
    // The latch is process-scoped; clear it so later tests see no skills.
    await waitForResponse(sendRequest("skills/configure", { roots: [] }));
  });

  it("prepends instructions to the first prompt only", async () => {
    const { providerThreadId } = await startThread({
      instructions: "Be terse.",
    });
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
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
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "request-permission", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(
      output.messages.filter(
        (message) => message.method === "interaction/request",
      ),
    ).toHaveLength(0);
    expect(agentMessageTexts()).toContain("permission:yes");
  });

  it("forwards permission requests to the runtime in ask mode", async () => {
    const { bbThreadId, providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
    });
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "request-permission", mentions: [] }],
    });
    await waitForResponse(turnId);

    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (message) =>
            message.method === "interaction/request" &&
            message.id !== undefined,
        ),
      "forwarded permission request",
    );
    // The canonical interaction carries the approval payload; the turn id is
    // runtime-stamped under the narrow grammar, so the bridge sends the
    // wire contract's unresolved marker (null) and the runtime attaches its
    // active turn for the thread.
    expect(forwarded.params).toMatchObject({
      threadId: bbThreadId,
      providerThreadId,
      turnId: null,
      payload: {
        kind: "approval",
        subject: expect.objectContaining({ command: "rm -rf /tmp/scratch" }),
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

  it("presents an external-directory write permission as a file-change approval", async () => {
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
    });
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [
        {
          type: "text",
          text: "request-external-directory-permission",
          mentions: [],
        },
      ],
    });
    await waitForResponse(turnId);
    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (message) =>
            message.method === "interaction/request" &&
            message.id !== undefined,
        ),
      "forwarded permission request",
    );
    // The permission's own tool call is the generic kind "other" with a bare
    // directory title; the in-flight edit tool call with the same id makes it
    // a file-change approval bounded by the named directory.
    expect(forwarded.params).toMatchObject({
      payload: {
        kind: "approval",
        subject: {
          kind: "file_change",
          itemId: "write-tool-1",
          writeScope: "/tmp/qa-1719",
        },
      },
    });
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: forwarded.id,
        result: { decision: "allow_once", grantedPermissions: null },
      }),
    );
    await waitForTurnCompleted();
    expect(agentMessageTexts()).toContain("permission:yes");
  });

  it("answers session-grant decisions with the allow_always option", async () => {
    const { providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
    });
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "request-permission", mentions: [] }],
    });
    await waitForResponse(turnId);
    const forwarded = await waitFor(
      () =>
        output.messages.find(
          (message) =>
            message.method === "interaction/request" &&
            message.id !== undefined,
        ),
      "forwarded permission request",
    );
    handleLine(
      JSON.stringify({
        jsonrpc: "2.0",
        id: forwarded.id,
        result: { decision: "allow_for_session", grantedPermissions: null },
      }),
    );
    await waitForTurnCompleted();
    expect(agentMessageTexts()).toContain("permission:always");
  });

  it("performs client fs writes inside the workspace and reports them", async () => {
    const targetPath = join(workspaceDir, "agent-output.txt");
    const { bbThreadId, providerThreadId } = await startThread({
      permissionMode: "accept-edits",
      permissionEscalation: "ask",
      envVars: { FAKE_ACP_WRITE_PATH: targetPath },
    });
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "write-file", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("write:ok");
    expect(readFileSync(targetPath, "utf8")).toBe("hello from agent\n");
    expect(
      threadEventsOfType("item/completed").map((event) => event.item),
    ).toContainEqual(
      expect.objectContaining({
        type: "fileChange",
        changes: [expect.objectContaining({ path: targetPath, kind: "add" })],
      }),
    );
  });

  it("denies client fs writes outside the workspace in accept-edits mode", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "bb-acp-outside-"));
    const targetPath = join(outsideDir, "outside.txt");
    try {
      const { providerThreadId } = await startThread({
        permissionMode: "accept-edits",
        permissionEscalation: "ask",
        envVars: { FAKE_ACP_WRITE_PATH: targetPath },
      });
      const turnId = sendTurnRequest("turn/start", providerThreadId, {
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

  // The canonical wire has no core field for the daemon's extra write roots;
  // they ride the provider-scoped options bag. Without them a canonical
  // accept-edits session sandboxes to cwd alone and denies writes the legacy
  // dialect allowed (thread storage, a second workspace root).
  it("allows canonical accept-edits writes into a configured extra write root", async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), "bb-acp-extra-root-"));
    const targetPath = join(outsideDir, "outside.txt");
    try {
      const threadId = "thread-canonical-extra-root";
      const startId = sendRequest("thread/start", {
        threadId,
        cwd: workspaceDir,
        instructionMode: "append",
        options: {
          envVars: { FAKE_ACP_WRITE_PATH: targetPath },
          permissionMode: "accept-edits",
          permissionScope: "workspace",
          approvalReviewer: "user",
          permissionEscalation: "ask",
          providerOptions: {
            additionalWorkspaceWriteRoots: [outsideDir],
            acpLaunchSpec: {
              displayName: "Fake ACP Agent",
              command: process.execPath,
              args: [FAKE_AGENT_PATH],
              env: {},
            },
          },
        },
      });
      const startResponse = await waitForResponse(startId);
      expect(startResponse.error).toBeUndefined();
      const providerThreadId =
        typeof startResponse.result === "object" &&
        startResponse.result !== null &&
        !Array.isArray(startResponse.result) &&
        typeof startResponse.result.providerThreadId === "string"
          ? startResponse.result.providerThreadId
          : "";
      startedProviderThreadIds.push(providerThreadId);

      const turnId = sendRequest("turn/start", {
        threadId,
        providerThreadId,
        clientRequestId: "creq_abcdefghjk",
        input: [{ type: "text", text: "write-file", mentions: [] }],
        options: {
          permissionMode: "accept-edits",
          permissionScope: "workspace",
          approvalReviewer: "user",
          permissionEscalation: "ask",
        },
      });
      await waitForResponse(turnId);
      const completed = await waitForTurnCompleted();

      expect(completed).toMatchObject({ status: "completed" });
      expect(agentMessageTexts()).toContain("write:ok");
      expect(readFileSync(targetPath, "utf8")).toBe("hello from agent\n");
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it("cancels a hung prompt and continues the same turn with steer input", async () => {
    const { bbThreadId, providerThreadId } = await startThread();
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "hang", mentions: [] }],
    });
    await waitForResponse(turnId);

    const steerId = sendTurnRequest("turn/steer", providerThreadId, {
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "steered", mentions: [] }],
    });
    await waitForResponse(steerId);

    const completed = await waitForTurnCompleted();
    expect(completed).toMatchObject({ status: "completed" });
    expect(agentMessageTexts()).toContain("echo:steered");
    expect(agentMessageTexts()).not.toContain("echo:hang");
    expect(threadEventsOfType("turn/started")).toHaveLength(1);
    expect(threadEventsOfType("turn/completed")).toHaveLength(1);
  });

  it("keeps partial output from the cancelled prompt then continues", async () => {
    const { bbThreadId, providerThreadId } = await startThread();
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "slow first", mentions: [] }],
    });
    await waitForResponse(turnId);
    await waitFor(
      () =>
        agentMessageTexts().includes("echo:slow first") ? true : undefined,
      "first prompt echo",
    );

    const steerId = sendTurnRequest("turn/steer", providerThreadId, {
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "steered", mentions: [] }],
    });
    await waitForResponse(steerId);

    const completed = await waitForTurnCompleted();
    expect(completed).toMatchObject({ status: "completed" });
    // The cancelled prompt's partial output and the steered continuation
    // stream into the same assistant item.
    expect(agentMessageTexts().join("")).toContain("echo:slow first");
    expect(agentMessageTexts().join("")).toContain("echo:steered");
    expect(threadEventsOfType("turn/started")).toHaveLength(1);
    expect(threadEventsOfType("turn/completed")).toHaveLength(1);
  });

  it("delivers stacked steers on the same turn", async () => {
    const { bbThreadId, providerThreadId } = await startThread();
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "hang", mentions: [] }],
    });
    await waitForResponse(turnId);

    const firstSteerId = sendTurnRequest("turn/steer", providerThreadId, {
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "first-steer", mentions: [] }],
    });
    const secondSteerId = sendTurnRequest("turn/steer", providerThreadId, {
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "second-steer", mentions: [] }],
    });
    await waitForResponse(firstSteerId);
    await waitForResponse(secondSteerId);

    const completed = await waitForTurnCompleted();
    expect(completed).toMatchObject({ status: "completed" });
    expect(agentMessageTexts().join("")).toContain("echo:first-steer");
    expect(agentMessageTexts().join("")).toContain("echo:second-steer");
    expect(threadEventsOfType("turn/started")).toHaveLength(1);
    expect(threadEventsOfType("turn/completed")).toHaveLength(1);
  });

  it("cancels a stacked steer prompt that also hangs", async () => {
    const { bbThreadId, providerThreadId } = await startThread();
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "hang", mentions: [] }],
    });
    await waitForResponse(turnId);

    // The first steer also hangs, so the second steer must trigger a second
    // cancel instead of waiting for a prompt that never finishes.
    const firstSteerId = sendTurnRequest("turn/steer", providerThreadId, {
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "hang again", mentions: [] }],
    });
    const secondSteerId = sendTurnRequest("turn/steer", providerThreadId, {
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "second-steer", mentions: [] }],
    });
    await waitForResponse(firstSteerId);
    await waitForResponse(secondSteerId);

    const completed = await waitForTurnCompleted();
    expect(completed).toMatchObject({ status: "completed" });
    expect(agentMessageTexts()).toContain("echo:second-steer");
    expect(threadEventsOfType("turn/started")).toHaveLength(1);
    expect(threadEventsOfType("turn/completed")).toHaveLength(1);
  });

  it("runs the builtin /compact command as compaction, not as a prompt", async () => {
    const promptLog = join(workspaceDir, "compact-prompt-log.jsonl");
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_PROMPT_LOG: promptLog },
    });

    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: compactCommandInput(),
    });
    expect((await waitForResponse(turnId)).error).toBeUndefined();

    const completed = await waitForTurnCompleted();
    expect(completed).toMatchObject({ status: "completed" });
    // The compaction turn is a context-maintenance turn, not model input: the
    // agent ran its own /compact command and the thread reports compaction.
    expect(threadEventsOfType("thread/compacted")).toHaveLength(1);
    expect(
      threadEvents().filter(
        (event) =>
          event.type === "item/started" &&
          (event.item as { type?: string } | undefined)?.type ===
            "contextCompaction",
      ),
    ).toHaveLength(1);
    expect(loggedPrompts(promptLog)).toEqual(["/compact"]);
    expect(agentMessageTexts()).not.toContain("echo:/compact");
  });

  it("fails the compaction turn legibly when the agent rejects the request", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_PROMPT_ERROR: "1" },
    });

    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: compactCommandInput(),
    });
    expect((await waitForResponse(turnId)).error).toBeUndefined();

    // The agent's own reason reaches the thread, and a rejected maintenance
    // prompt never reports a shrunk context.
    const completed = await waitForTurnCompleted();
    expect(completed).toMatchObject({
      status: "failed",
      error: { message: "Fake prompt failure" },
    });
    expect(threadEventsOfType("thread/compacted")).toEqual([]);
  });

  it("does not report an ACP refusal as successful compaction", async () => {
    const { providerThreadId } = await startThread({
      envVars: { FAKE_ACP_COMPACT_STOP_REASON: "refusal" },
    });

    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: compactCommandInput(),
    });
    expect((await waitForResponse(turnId)).error).toBeUndefined();

    const completed = await waitForTurnCompleted();
    expect(completed).toMatchObject({
      status: "failed",
      error: { message: "Agent stopped compaction: refusal" },
    });
    expect(threadEventsOfType("thread/compacted")).toEqual([]);
  });

  it("rejects steers when no turn is active", async () => {
    const { providerThreadId } = await startThread();
    const steerId = sendTurnRequest("turn/steer", providerThreadId, {
      expectedTurnId: "turn-1",
      input: [{ type: "text", text: "late", mentions: [] }],
    });
    const response = await waitForResponse(steerId);
    expect(response.error?.code).toBe(ACP_BRIDGE_NO_ACTIVE_TURN_ERROR_CODE);
    expect(response.error?.message).toMatch(/No active turn/);
  });

  it("cancels the active turn on thread/stop", async () => {
    const { bbThreadId, providerThreadId } = await startThread();
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
      input: [{ type: "text", text: "hang", mentions: [] }],
    });
    await waitForResponse(turnId);

    const stopId = sendRequest("thread/stop", {
      threadId: bbThreadIdFor(providerThreadId),
      providerThreadId,
      intent: "interrupt",
      activeTurnId: null,
    });
    const stopResponse = await waitForResponse(stopId);
    expect(stopResponse.result).toEqual({ ok: true });

    const completed = await waitForTurnCompleted();
    expect(completed).toMatchObject({ status: "interrupted" });
    startedProviderThreadIds.pop();
  });

  it("forks an advertised ACP session with the target cwd and MCP servers", async () => {
    const forkLog = join(workspaceDir, "fork-params.json");
    const forkId = sendRequest("thread/fork", {
      threadId: "thread-fork",
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        model: "fake/strong",
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: {
              FAKE_ACP_FORK_SESSION: "1",
              FAKE_ACP_FORK_LOG: forkLog,
              FAKE_ACP_MODELS_FIELD: "1",
            },
          }),
        },
      }),
      dynamicTools: [
        {
          name: "fork_tool",
          description: "Tool available to the fork",
          inputSchema: { type: "object" },
        },
      ],
      sourceProviderThreadId: "source-session",
    });
    const response = await waitForResponse(forkId);
    const result = response.result;
    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result) ||
      typeof result.providerThreadId !== "string"
    ) {
      throw new Error("thread/fork did not return a providerThreadId");
    }
    startedProviderThreadIds.push(result.providerThreadId);
    expect(result.providerThreadId).toMatch(/^fake-fork-/u);

    await waitForFileWithRealTimer(forkLog);
    expect(JSON.parse(readFileSync(forkLog, "utf8"))).toMatchObject({
      sessionId: "source-session",
      cwd: workspaceDir,
      mcpServers: [{ name: ACP_BRIDGE_MCP_SERVER_NAME }],
    });
    expect(notifications("thread/identity").at(-1)?.params).toEqual({
      threadId: "thread-fork",
      providerThreadId: result.providerThreadId,
      sessionRestorable: false,
    });

    sendTurnRequest("turn/start", result.providerThreadId, {
      input: [{ type: "text", text: "echo-mcp-servers", mentions: [] }],
    });
    await waitForTurnCompleted();
    expect(agentMessageTexts()).toContain(
      `mcp-servers:${ACP_BRIDGE_MCP_SERVER_NAME}`,
    );

    const completedTurnCount = threadEventsOfType("turn/completed").length;
    sendTurnRequest("turn/start", result.providerThreadId, {
      input: [{ type: "text", text: "echo-selected-model", mentions: [] }],
    });
    await waitFor(
      () =>
        threadEventsOfType("turn/completed").length > completedTurnCount
          ? threadEventsOfType("turn/completed").at(-1)
          : undefined,
      "second acp/turn/completed notification",
    );
    expect(agentMessageTexts()).toContain("selected-model:fake/strong");
  });

  it("rejects a checkpoint fork before session/fork", async () => {
    const forkLog = join(workspaceDir, "checkpoint-fork-params.json");
    const forkId = sendRequest("thread/fork", {
      threadId: "thread-checkpoint-fork",
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: { FAKE_ACP_FORK_SESSION: "1", FAKE_ACP_FORK_LOG: forkLog },
          }),
        },
      }),
      sourceProviderThreadId: "source-session",
      sourceProviderCheckpointId: "message-7",
    });

    const response = await waitForResponse(forkId);
    expect(response.error?.message).toMatch(/cannot fork at a checkpoint/u);
    expect(existsSync(forkLog)).toBe(false);
    expect(notifications("thread/identity")).toEqual([]);
  });

  it("rejects a fork result that reuses the source session id", async () => {
    const forkId = sendRequest("thread/fork", {
      threadId: "thread-colliding-fork",
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: {
              FAKE_ACP_FORK_SESSION: "1",
              FAKE_ACP_FORK_REUSE_SOURCE_ID: "1",
            },
          }),
        },
      }),
      sourceProviderThreadId: "source-session",
    });

    const response = await waitForResponse(forkId);
    expect(response.error?.message).toMatch(
      /returned an active session ID for session\/fork/u,
    );
    expect(notifications("thread/identity")).toEqual([]);
  });

  it("rejects fork before session/fork when the agent omits the capability", async () => {
    const forkLog = join(workspaceDir, "unsupported-fork-params.json");
    const forkId = sendRequest("thread/fork", {
      threadId: "thread-unsupported-fork",
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: { FAKE_ACP_FORK_LOG: forkLog },
          }),
        },
      }),
      sourceProviderThreadId: "source-session",
    });

    const response = await waitForResponse(forkId);
    expect(response.error?.message).toMatch(
      /does not advertise session\/fork support/u,
    );
    expect(existsSync(forkLog)).toBe(false);
    expect(notifications("thread/identity")).toEqual([]);
  });

  it("resumes via session/load when the agent supports it", async () => {
    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.bbThreadId,
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: { FAKE_ACP_LOAD_SESSION: "1" },
          }),
        },
      }),
      providerThreadId: first.providerThreadId,
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
      sessionRestorable: true,
    });
    expect(threadEventsOfType("provider/warning")).toHaveLength(0);
    startedProviderThreadIds.push(first.providerThreadId);
  });

  it("emits session.reset after identity at every construction (start, resume, fork)", async () => {
    // Without the reset, the shared assembler would keep settled item keys and
    // usage totals across a session replacement on the same thread.
    const resetIndexesFor = (threadId: string): number[] =>
      output.messages.flatMap((message, index) => {
        if (message.method !== "thread/delta") {
          return [];
        }
        const params = message.params as {
          threadId?: unknown;
          deltas?: unknown;
        };
        return params.threadId === threadId &&
          Array.isArray(params.deltas) &&
          params.deltas.some(
            (delta) =>
              (delta as { kind?: unknown }).kind === "session.reset",
          )
          ? [index]
          : [];
      });
    const identityIndexesFor = (threadId: string): number[] =>
      output.messages.flatMap((message, index) =>
        message.method === "thread/identity" &&
        (message.params as { threadId?: unknown }).threadId === threadId
          ? [index]
          : [],
      );

    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    expect(resetIndexesFor(first.bbThreadId)).toHaveLength(1);

    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();
    const resumeId = sendRequest("thread/resume", {
      threadId: first.bbThreadId,
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: { FAKE_ACP_LOAD_SESSION: "1" },
          }),
        },
      }),
      providerThreadId: first.providerThreadId,
    });
    const resumeResponse = await waitForResponse(resumeId);
    expect(resumeResponse.error).toBeUndefined();
    startedProviderThreadIds.push(first.providerThreadId);
    // One reset per construction, each after its own identity announcement.
    const resets = resetIndexesFor(first.bbThreadId);
    const identities = identityIndexesFor(first.bbThreadId);
    expect(resets).toHaveLength(2);
    expect(identities).toHaveLength(2);
    expect(resets[0]).toBeGreaterThan(identities[0] ?? Infinity);
    expect(resets[1]).toBeGreaterThan(identities[1] ?? Infinity);

    const forkId = sendRequest("thread/fork", {
      threadId: "thread-fork-reset",
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: { FAKE_ACP_FORK_SESSION: "1" },
          }),
        },
      }),
      sourceProviderThreadId: "source-session",
    });
    const forkResponse = await waitForResponse(forkId);
    const forkResult = forkResponse.result;
    if (
      typeof forkResult !== "object" ||
      forkResult === null ||
      Array.isArray(forkResult) ||
      typeof forkResult.providerThreadId !== "string"
    ) {
      throw new Error("thread/fork did not return a providerThreadId");
    }
    startedProviderThreadIds.push(forkResult.providerThreadId);
    bbThreadIdByProviderThreadId.set(
      forkResult.providerThreadId,
      "thread-fork-reset",
    );
    const forkResets = resetIndexesFor("thread-fork-reset");
    const forkIdentities = identityIndexesFor("thread-fork-reset");
    expect(forkResets).toHaveLength(1);
    expect(forkResets[0]).toBeGreaterThan(forkIdentities[0] ?? Infinity);
  });

  it("forwards context usage reported during session/load", async () => {
    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.bbThreadId,
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: {
              FAKE_ACP_LOAD_SESSION: "1",
              FAKE_ACP_USAGE_ON_LOAD: "1",
            },
          }),
        },
      }),
      providerThreadId: first.providerThreadId,
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
      sessionRestorable: true,
    });
    expect(
      threadEventsOfType("thread/contextWindowUsage/updated").at(-1),
    ).toMatchObject({
      contextWindowUsage: {
        usedTokens: 24_000,
        modelContextWindow: 128_000,
        estimated: false,
      },
    });
    startedProviderThreadIds.push(first.providerThreadId);
  });

  it("ignores load-time context usage for a different session", async () => {
    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.bbThreadId,
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: {
              FAKE_ACP_LOAD_SESSION: "1",
              FAKE_ACP_USAGE_ON_LOAD: "1",
              FAKE_ACP_USAGE_SESSION_ID: "different-session",
            },
          }),
        },
      }),
      providerThreadId: first.providerThreadId,
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
      sessionRestorable: true,
    });
    expect(threadEventsOfType("thread/contextWindowUsage/updated")).toEqual([]);
    startedProviderThreadIds.push(first.providerThreadId);
  });

  it("discards load-time context usage when session/load fails", async () => {
    const first = await startThread({
      envVars: { FAKE_ACP_LOAD_SESSION: "1" },
    });
    await stopThread(first.providerThreadId);
    startedProviderThreadIds.pop();

    const resumeId = sendRequest("thread/resume", {
      threadId: first.bbThreadId,
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: {
              FAKE_ACP_FAIL_LOAD: "1",
              FAKE_ACP_USAGE_ON_LOAD: "1",
            },
          }),
        },
      }),
      providerThreadId: first.providerThreadId,
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
    expect(result.providerThreadId).not.toBe(first.providerThreadId);
    expect(threadEventsOfType("thread/contextWindowUsage/updated")).toEqual([]);
    expect(threadEventsOfType("provider/warning")).not.toHaveLength(0);
    startedProviderThreadIds.push(result.providerThreadId);
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
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        model: "fake/strong",
        reasoningLevel: "high",
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            envVars: {
              FAKE_ACP_LOAD_SESSION: "1",
              FAKE_ACP_MODEL_CONFIG: "1",
              FAKE_ACP_THOUGHT_LEVEL_CONFIG: "1",
            },
          }),
        },
      }),
      providerThreadId: first.providerThreadId,
    });
    const response = await waitForResponse(resumeId);
    expect(response.result).toEqual({
      providerThreadId: first.providerThreadId,
      sessionRestorable: true,
    });
    startedProviderThreadIds.push(first.providerThreadId);

    sendTurnRequest("turn/start", first.providerThreadId, {
      input: [{ type: "text", text: "echo-selected-effort", mentions: [] }],
    });
    await waitForTurnCompleted();

    expect(agentMessageTexts()).toContain("selected-effort:high");
  });

  it("falls back to a fresh session with a warning when load is unsupported", async () => {
    const resumeId = sendRequest("thread/resume", {
      threadId: "thread-resume-fallback",
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({}),
        },
      }),
      providerThreadId: "fake-sess-stale",
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

    expect(threadEventsOfType("provider/warning")).not.toHaveLength(0);
  });

  it("reports unexpected agent exits as a single provider error", async () => {
    const { bbThreadId, providerThreadId } = await startThread();
    const turnId = sendTurnRequest("turn/start", providerThreadId, {
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
      instructionMode: "append",
      options: executionOptions({
        providerOptions: {
          acpLaunchSpec: acpLaunchSpec({
            agent: { command: "definitely-not-a-real-binary-bb", args: [] },
          }),
        },
      }),
    });
    const response = await waitForResponse(id);
    expect(response.error?.message).toMatch(/definitely-not-a-real-binary-bb/);
  });

  // Session construction is the one place the bridge cannot degrade: without a
  // launch spec it has no agent to speak to at all.
  it("rejects thread/start without an ACP launch spec", async () => {
    const id = sendRequest("thread/start", {
      threadId: "thread-no-launch-spec",
      cwd: workspaceDir,
      instructionMode: "append",
      options: executionOptions({}),
    });
    expect((await waitForResponse(id)).error).toMatchObject({
      code: -32602,
      message: expect.stringContaining("acpLaunchSpec"),
    });
  });
});
