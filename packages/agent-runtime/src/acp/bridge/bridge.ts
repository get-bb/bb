#!/usr/bin/env node

/**
 * Generic ACP bridge.
 *
 * Speaks bb's runtime JSON-RPC on stdio and acts as the ACP *client* for the
 * configured agent (Cursor): one agent subprocess and
 * one ACP session per bb thread. The bridge owns the cooperative permission
 * policy — it answers `session/request_permission` per bb's permission mode
 * (forwarding to the runtime when escalation is "ask") and enforces the
 * workspace write policy on client `fs/write_text_file` requests.
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  reasoningEffortsForLevels,
  type AvailableModel,
  type PromptInput,
  type ReasoningLevel,
} from "@bb/domain";
import { buildEditDiff } from "../../shared/adapter-utils.js";
import {
  createBridgeIo,
  createBridgeLineHandler,
  isMainModule,
  runBridgeRequest,
  startBridgeStdio,
} from "../../shared/bridge-harness.js";
import {
  decodeToolCallResponsePayload,
  type BridgeJsonRpcResponse,
  decodeBridgeJsonRpcResponse,
  jsonRpcEnvelopeSchema,
} from "../../shared/bridge-tool-calls.js";
import { withoutBridgeRuntimeEnv } from "../../shared/bridge-runtime-env.js";
import { mimeTypeFromExtension } from "../../shared/mime-types.js";
import {
  ACP_COMPACTION_COMPLETED_METHOD,
  ACP_COMPACTION_STARTED_METHOD,
  ACP_BRIDGE_NO_ACTIVE_TURN_ERROR_CODE,
  ACP_DEFAULT_MODEL_ID,
  ACP_FS_WRITE_METHOD,
  ACP_PERMISSION_REQUEST_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
  ACP_WARNING_METHOD,
  acpBridgeCommandSchema,
  acpPermissionResponseSchema,
  type AcpBridgeAgentCommand,
  type AcpBridgeCommand,
  type AcpBridgeNativeReasoning,
  type AcpBridgePermissionCli,
  type AcpBridgeReasoningCli,
  type AcpBridgeThreadForkParams,
  type AcpBridgeThreadResumeParams,
  type AcpBridgeThreadStartParams,
} from "../bridge-protocol.js";
import {
  ACP_PROTOCOL_VERSION,
  type AcpConfigOption,
  acpConfigStateResultSchema,
  acpInitializeResultSchema,
  acpPromptResultSchema,
  acpReadTextFileParamsSchema,
  acpRequestPermissionParamsSchema,
  acpSessionForkResultSchema,
  acpSessionNewResultSchema,
  acpSessionNotificationParamsSchema,
  acpUsageUpdateSchema,
  type AcpConfigStateResult,
  type AcpSessionModels,
  type AcpUsageUpdate,
  acpStopReasonSchema,
  acpWriteTextFileParamsSchema,
  type AcpContentBlock,
  type AcpPermissionOption,
} from "../wire.js";
import {
  createAcpAgentConnection,
  type AcpAgentConnection,
  type AcpAgentRequestResponder,
} from "./agent-connection.js";
import {
  buildAgentModelCatalog,
  buildAcpNativeReasoningSupport,
  buildModelCatalogFromConfigOptions,
  buildModelCatalogFromSessionModels,
  acpNativeReasoningLevelToValue,
  findAcpModelConfigOption,
  findAcpThoughtLevelConfigOption,
  parseAgentModelLines,
  splitPrimaryModels,
  type AcpNativeReasoningSupport,
  type AgentModelCatalog,
} from "./model-catalog.js";
import {
  buildAcpMcpServerConfig,
  runAcpDynamicToolMcpServer,
  type AcpMcpServerConfig,
} from "./tool-proxy-mcp.js";

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface AcpSessionPolicy {
  permissionMode: "accept-edits" | "full";
  permissionEscalation: "ask" | "deny" | null;
  workspaceWriteRoots: string[];
}

interface PendingAcpPermission {
  responder: AcpAgentRequestResponder;
  options: AcpPermissionOption[];
}

interface AcpThreadSession {
  bbThreadId: string;
  providerThreadId: string;
  connection: AcpAgentConnection;
  agentLabel: string;
  supportsImageInput: boolean;
  supportsLoadSession: boolean;
  policy: AcpSessionPolicy;
  cwd: string;
  pendingInstructions: string | undefined;
  activePromptKind: "turn" | "compaction" | null;
  queuedInputs: PromptInput[][];
  /** True while a session/prompt request is outstanding. */
  promptRequestPending: boolean;
  /** True after a steer sent session/cancel for the current prompt. */
  cancelRequested: boolean;
  loading: boolean;
  loadingSessionId: string | undefined;
  pendingLoadUsageUpdate: AcpUsageUpdate | undefined;
  stopping: boolean;
  /** Resolves when the in-flight turn or maintenance prompt fully settles. */
  turnSettled: Promise<void> | undefined;
  pendingPermissions: Set<PendingAcpPermission>;
}

const sessionsByBbThreadId = new Map<string, AcpThreadSession>();
const bbThreadIdByProviderThreadId = new Map<string, string>();
const pendingRuntimeRequests = new Map<
  number,
  (response: BridgeJsonRpcResponse) => void
>();
let runtimeRequestIdCounter = 0;
let dynamicToolBridgePromise: Promise<AcpDynamicToolBridge> | null = null;

// Runtime waits on thread/stop until the agent settles the cancelled prompt or
// this timeout forces disposal. Stop remains a best-effort success boundary.
const THREAD_STOP_CANCEL_TIMEOUT_MS = 4_000;

// ---------------------------------------------------------------------------
// stdout helpers (bridge → runtime)
// ---------------------------------------------------------------------------

interface BridgeNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

interface BridgeRuntimeRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

const { send, sendResult, sendError } = createBridgeIo<
  BridgeNotification | BridgeRuntimeRequest
>();

function sendNotification(
  method: string,
  params: Record<string, unknown>,
): void {
  send({ jsonrpc: "2.0", method, params });
}

function sendRuntimeRequest(
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  runtimeRequestIdCounter += 1;
  const requestId = runtimeRequestIdCounter;
  const responsePromise = new Promise<unknown>(
    (resolveResponse, rejectResponse) => {
      pendingRuntimeRequests.set(requestId, (response) => {
        if ("error" in response) {
          rejectResponse(
            new Error(response.error.message ?? "Runtime request failed"),
          );
          return;
        }
        resolveResponse(response.result);
      });
    },
  );
  send({
    jsonrpc: "2.0",
    id: requestId,
    method,
    params,
  });
  return responsePromise;
}

function resolveBridgeProcessArgsForMcpServer(): string[] {
  const entryPoint = process.argv[1]
    ? resolve(process.argv[1])
    : fileURLToPath(import.meta.url);
  return [...process.execArgv, entryPoint, "--mcp-stdio"];
}

function resolveBridgeProcessEnvForMcpServer(): AcpMcpServerConfig["env"] {
  const electronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  if (electronRunAsNode === undefined) {
    return [];
  }

  // The ACP agent must not inherit Electron's Node mode, but this MCP process
  // re-executes the packaged bridge and therefore needs it restored.
  return [{ name: "ELECTRON_RUN_AS_NODE", value: electronRunAsNode }];
}

async function forwardDynamicToolCall(args: {
  arguments: Record<string, unknown>;
  callId: string;
  threadId: string;
  tool: string;
}): Promise<
  | { ok: true; content: string; isError?: boolean }
  | { ok: false; error: string }
> {
  const session = sessionsByBbThreadId.get(args.threadId);
  if (!session || !session.providerThreadId || session.stopping) {
    return { ok: false, error: "No active ACP session for dynamic tool call." };
  }

  try {
    const result = await sendRuntimeRequest("item/tool/call", {
      providerThreadId: session.providerThreadId,
      threadId: session.bbThreadId,
      turnId: null,
      callId: args.callId,
      tool: args.tool,
      arguments: args.arguments,
    });
    return { ok: true, ...decodeToolCallResponsePayload(result) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function handleDynamicToolBridgeSocket(
  bridge: AcpDynamicToolBridge,
  socket: Socket,
): void {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    buffer += chunk;
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) {
      return;
    }
    const line = buffer.slice(0, newlineIndex);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      socket.end(`${JSON.stringify({ ok: false, error: "Invalid JSON" })}\n`);
      return;
    }
    const request = dynamicToolBridgeRequestSchema.safeParse(parsed);
    if (!request.success || request.data.token !== bridge.token) {
      socket.end(
        `${JSON.stringify({ ok: false, error: "Invalid dynamic tool request" })}\n`,
      );
      return;
    }
    void forwardDynamicToolCall(request.data).then((response) => {
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
}

async function ensureDynamicToolBridge(): Promise<AcpDynamicToolBridge> {
  if (dynamicToolBridgePromise) {
    return dynamicToolBridgePromise;
  }

  dynamicToolBridgePromise = new Promise((resolveBridge, rejectBridge) => {
    const host = "127.0.0.1";
    const server = createServer((socket) => {
      void dynamicToolBridgePromise?.then((bridge) => {
        handleDynamicToolBridgeSocket(bridge, socket);
      });
    });
    server.once("error", rejectBridge);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        rejectBridge(
          new Error("ACP dynamic tool bridge did not bind a TCP port"),
        );
        return;
      }
      resolveBridge({
        host,
        port: address.port,
        server,
        token: randomBytes(32).toString("hex"),
      });
    });
  });

  return dynamicToolBridgePromise;
}

async function buildSessionMcpServers(
  params: AcpBridgeThreadStartParams,
): Promise<AcpMcpServerConfig[]> {
  const dynamicTools = params.dynamicTools ?? [];
  if (dynamicTools.length === 0) {
    return [];
  }
  const bridge = await ensureDynamicToolBridge();
  return [
    buildAcpMcpServerConfig({
      bridgeArgs: resolveBridgeProcessArgsForMcpServer(),
      command: process.execPath,
      dynamicTools,
      host: bridge.host,
      port: bridge.port,
      runtimeEnv: resolveBridgeProcessEnvForMcpServer(),
      threadId: params.threadId,
      token: bridge.token,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Model catalog — parsed from the agent CLI's list command, with the
// synthetic "Agent default" entry as the resilience fallback
// ---------------------------------------------------------------------------

const ACP_DEFAULT_MODEL: AvailableModel = {
  id: ACP_DEFAULT_MODEL_ID,
  model: ACP_DEFAULT_MODEL_ID,
  displayName: "Agent default",
  description: "Model selection is managed by the connected ACP agent.",
  supportedReasoningEfforts: [
    {
      reasoningEffort: "medium",
      description: "Reasoning effort is managed by the connected ACP agent.",
    },
  ],
  defaultReasoningEffort: "medium",
  isDefault: true,
};

const MODEL_LIST_TIMEOUT_MS = 30_000;
const ACP_NATIVE_REASONING_DISCOVERY_TIMEOUT_MS = 5_000;
const AUTH_REQUIRED_MODEL_LIST_ERROR_MESSAGE =
  "ACP agent is not authenticated.";

function reasoningSupportFromCli(
  reasoningCli: AcpBridgeReasoningCli | undefined,
):
  | Pick<AvailableModel, "supportedReasoningEfforts" | "defaultReasoningEffort">
  | undefined {
  if (reasoningCli === undefined) {
    return undefined;
  }
  const supportedLevels = reasoningCli.supportedLevels;
  const defaultReasoningEffort =
    reasoningCli.defaultLevel !== undefined &&
    supportedLevels.includes(reasoningCli.defaultLevel)
      ? reasoningCli.defaultLevel
      : supportedLevels.includes("medium")
        ? "medium"
        : supportedLevels[0];
  return {
    supportedReasoningEfforts: reasoningEffortsForLevels(supportedLevels),
    defaultReasoningEffort,
  };
}

function reasoningSupportFromNativeHint(
  nativeReasoning: AcpBridgeNativeReasoning | undefined,
):
  | Pick<AvailableModel, "supportedReasoningEfforts" | "defaultReasoningEffort">
  | undefined {
  if (nativeReasoning === undefined) {
    return undefined;
  }
  const supportedLevels = nativeReasoning.supportedLevels;
  const defaultReasoningEffort =
    nativeReasoning.defaultLevel !== undefined &&
    supportedLevels.includes(nativeReasoning.defaultLevel)
      ? nativeReasoning.defaultLevel
      : supportedLevels.includes("medium")
        ? "medium"
        : supportedLevels[0];
  return {
    supportedReasoningEfforts: reasoningEffortsForLevels(supportedLevels),
    defaultReasoningEffort,
  };
}

function applyReasoningCliToModel(
  model: AvailableModel,
  reasoningCli: AcpBridgeReasoningCli | undefined,
): AvailableModel {
  const reasoningSupport = reasoningSupportFromCli(reasoningCli);
  return reasoningSupport === undefined
    ? model
    : {
        ...model,
        ...reasoningSupport,
      };
}

function modelHasOnlyAgentManagedReasoning(model: AvailableModel): boolean {
  return (
    model.supportedReasoningEfforts.length === 1 &&
    model.supportedReasoningEfforts[0]?.reasoningEffort === "medium" &&
    model.defaultReasoningEffort === "medium"
  );
}

function applyNativeReasoningHintToModel(
  model: AvailableModel,
  nativeReasoning: AcpBridgeNativeReasoning | undefined,
): AvailableModel {
  const reasoningSupport = reasoningSupportFromNativeHint(nativeReasoning);
  return reasoningSupport === undefined ||
    !modelHasOnlyAgentManagedReasoning(model)
    ? model
    : {
        ...model,
        ...reasoningSupport,
      };
}

function applyConfiguredReasoningToModel(
  model: AvailableModel,
  args: {
    reasoningCli: AcpBridgeReasoningCli | undefined;
    nativeReasoning: AcpBridgeNativeReasoning | undefined;
  },
): AvailableModel {
  return args.reasoningCli !== undefined
    ? applyReasoningCliToModel(model, args.reasoningCli)
    : applyNativeReasoningHintToModel(model, args.nativeReasoning);
}

function applyConfiguredReasoningToModels(
  models: readonly AvailableModel[],
  args: {
    reasoningCli: AcpBridgeReasoningCli | undefined;
    nativeReasoning: AcpBridgeNativeReasoning | undefined;
  },
): AvailableModel[] {
  return models.map((model) => applyConfiguredReasoningToModel(model, args));
}

function resolveReasoningCliValue(args: {
  reasoningCli: AcpBridgeReasoningCli;
  reasoningLevel: ReasoningLevel;
}): string | undefined {
  const override = args.reasoningCli.levelValues?.[args.reasoningLevel];
  if (override !== undefined) {
    return override;
  }
  return args.reasoningCli.supportedLevels.includes(args.reasoningLevel)
    ? args.reasoningLevel
    : undefined;
}

function nativeReasoningLevelToValue(args: {
  nativeReasoning: AcpBridgeNativeReasoning;
  reasoningLevel: ReasoningLevel;
}): string | undefined {
  const override = args.nativeReasoning.levelValues?.[args.reasoningLevel];
  if (override !== undefined) {
    return override;
  }
  return args.nativeReasoning.supportedLevels.includes(args.reasoningLevel)
    ? args.reasoningLevel
    : undefined;
}

function nativeReasoningToThoughtLevelOption(
  nativeReasoning: AcpBridgeNativeReasoning | undefined,
): AcpConfigOption | undefined {
  if (nativeReasoning === undefined) {
    return undefined;
  }
  const options = nativeReasoning.supportedLevels.flatMap((level) => {
    const value = nativeReasoningLevelToValue({
      nativeReasoning,
      reasoningLevel: level,
    });
    return value === undefined
      ? []
      : [
          {
            value,
            name: value,
          },
        ];
  });
  const currentValue =
    nativeReasoning.defaultLevel === undefined
      ? undefined
      : nativeReasoningLevelToValue({
          nativeReasoning,
          reasoningLevel: nativeReasoning.defaultLevel,
        });
  return {
    id: nativeReasoning.configId,
    category: "thought_level",
    type: "select",
    ...(currentValue !== undefined ? { currentValue } : {}),
    options,
  };
}

function permissionCliArgsForMode(
  permissionCli: AcpBridgePermissionCli | undefined,
  permissionMode: AcpSessionPolicy["permissionMode"],
): string[] {
  if (permissionCli === undefined) {
    return [];
  }
  switch (permissionMode) {
    case "full":
      return permissionCli.full ?? [];
    case "accept-edits":
      return permissionCli.workspaceWrite ?? [];
  }
}

function applyPermissionCliArgs(
  agentArgs: readonly string[],
  permissionCli: AcpBridgePermissionCli | undefined,
  permissionMode: AcpSessionPolicy["permissionMode"],
): string[] {
  const permissionArgs = permissionCliArgsForMode(
    permissionCli,
    permissionMode,
  );
  if (permissionArgs.length === 0) {
    return [...agentArgs];
  }
  const insertAfterArgs = Math.min(
    permissionCli?.insertAfterArgs ?? 0,
    agentArgs.length,
  );
  return [
    ...agentArgs.slice(0, insertAfterArgs),
    ...permissionArgs,
    ...agentArgs.slice(insertAfterArgs),
  ];
}

interface AcpDynamicToolBridge {
  host: string;
  port: number;
  server: Server;
  token: string;
}

const dynamicToolBridgeRequestSchema = z.object({
  arguments: z.record(z.string(), z.unknown()).default({}),
  callId: z.string().min(1),
  threadId: z.string().min(1),
  token: z.string().min(1),
  tool: z.string().min(1),
});

let cachedModelCatalog: { key: string; catalog: AgentModelCatalog } | null =
  null;
// ACP-native model discovery spawns a throwaway session, so its result is
// cached. Unlike the CLI list (which re-runs every call), discovery is too
// expensive to repeat per picker open — but a short TTL lets external changes
// to the agent (auth, added model providers) surface on the next open.
const SESSION_MODEL_DISCOVERY_TTL_MS = 60_000;
let cachedSessionDiscoveredModels: {
  key: string;
  models: AvailableModel[];
  fetchedAt: number;
} | null = null;

function resolveAcpAuthMethodId(
  authMethods: readonly { id: string }[] | undefined,
  env: Record<string, string | undefined>,
): string | undefined {
  // Grok is currently the only known ACP agent that advertises auth methods.
  // Keep this preference local until another authenticated ACP provider needs
  // a data-driven policy; cached_token is an ACP-side local-login flow.
  const methodIds = new Set((authMethods ?? []).map((method) => method.id));
  if (methodIds.size === 0) {
    return undefined;
  }
  if (env.XAI_API_KEY && methodIds.has("xai.api_key")) {
    return "xai.api_key";
  }
  if (methodIds.has("cached_token")) {
    return "cached_token";
  }
  return undefined;
}

async function authenticateAcpAgent(args: {
  connection: AcpAgentConnection;
  env: Record<string, string | undefined>;
  initializeResult: { authMethods?: readonly { id: string }[] };
}): Promise<void> {
  const methodId = resolveAcpAuthMethodId(
    args.initializeResult.authMethods,
    args.env,
  );
  if (methodId === undefined) {
    return;
  }
  await args.connection.request({
    method: "authenticate",
    params: { methodId, _meta: { headless: true } },
    resultSchema: z.unknown(),
  });
}

/**
 * Run the agent's model list command and build the variant catalog, cached
 * per list command for the bridge's lifetime (model/list refreshes it on the
 * next picker open; session starts reuse it for variant resolution). Returns
 * null when the command fails or lists nothing so callers can fall back —
 * the picker to the synthetic entry, session starts to the unresolved id.
 */
async function loadAgentModelCatalog(
  listCommand: AcpBridgeAgentCommand,
): Promise<AgentModelCatalog | null> {
  const stdout = await new Promise<string | null>((resolveExec, rejectExec) => {
    execFile(
      listCommand.command,
      listCommand.args,
      {
        ...(listCommand.cwd !== undefined ? { cwd: listCommand.cwd } : {}),
        env: {
          ...withoutBridgeRuntimeEnv(process.env),
          ...(listCommand.envVars ?? {}),
        },
        timeout: MODEL_LIST_TIMEOUT_MS,
      },
      (error, out, stderr) => {
        if (!error) {
          resolveExec(out);
          return;
        }
        if (isMissingExecutableError(error)) {
          rejectExec(error);
          return;
        }
        if (isAuthRequiredModelListError(error, out, stderr)) {
          rejectExec(new AcpModelListAuthRequiredError());
          return;
        }
        resolveExec(null);
      },
    );
  });
  const key = JSON.stringify(listCommand);
  if (stdout === null) {
    process.stderr.write(
      `acp bridge: model list command "${listCommand.command}" failed\n`,
    );
    return cachedModelCatalog?.key === key ? cachedModelCatalog.catalog : null;
  }
  const catalog = buildAgentModelCatalog(parseAgentModelLines(stdout));
  if (!catalog) {
    process.stderr.write(
      `acp bridge: model list command "${listCommand.command}" printed no models\n`,
    );
    return cachedModelCatalog?.key === key ? cachedModelCatalog.catalog : null;
  }
  cachedModelCatalog = { key, catalog };
  return catalog;
}

async function loadSessionDiscoveredModels(
  agent: AcpBridgeAgentCommand,
): Promise<AvailableModel[] | null> {
  const key = JSON.stringify(agent);
  if (
    cachedSessionDiscoveredModels?.key === key &&
    Date.now() - cachedSessionDiscoveredModels.fetchedAt <
      SESSION_MODEL_DISCOVERY_TTL_MS
  ) {
    return cachedSessionDiscoveredModels.models;
  }

  const childEnv = {
    ...withoutBridgeRuntimeEnv(process.env),
    ...(agent.envVars ?? {}),
  };
  const connection = createAcpAgentConnection({
    command: agent.command,
    args: agent.args,
    cwd: agent.cwd ?? process.cwd(),
    env: childEnv,
    onNotification: () => {},
    onRequest: (_method, _params, responder) => {
      responder.error(-32601, "ACP model discovery does not support requests");
    },
    onExit: () => {},
  });

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutReached = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      connection.kill();
      reject(
        new Error(
          `ACP-native model discovery timed out after ${MODEL_LIST_TIMEOUT_MS}ms`,
        ),
      );
    }, MODEL_LIST_TIMEOUT_MS);
  });

  try {
    const newSession = await Promise.race([
      (async () => {
        const initializeResult = await connection.request({
          method: "initialize",
          params: {
            protocolVersion: ACP_PROTOCOL_VERSION,
            clientInfo: { name: "bb", version: "1.0.0" },
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
          },
          resultSchema: acpInitializeResultSchema,
        });
        await authenticateAcpAgent({
          connection,
          env: childEnv,
          initializeResult,
        });
        return await connection.request({
          method: "session/new",
          params: { cwd: agent.cwd ?? process.cwd(), mcpServers: [] },
          resultSchema: acpSessionNewResultSchema,
        });
      })(),
      timeoutReached,
    ]);
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeout = undefined;
    }

    const modelOption = findAcpModelConfigOption(newSession.configOptions);
    const configOptionModels = buildModelCatalogFromConfigOptions(modelOption);
    const sessionModels = buildModelCatalogFromSessionModels(newSession.models);
    if (configOptionModels.length === 0 && sessionModels.length === 0) {
      return null;
    }

    if (configOptionModels.length === 0) {
      cachedSessionDiscoveredModels = {
        key,
        models: sessionModels,
        fetchedAt: Date.now(),
      };
      return sessionModels;
    }

    const reasoningByModel = await discoverAcpNativeReasoningByModel({
      connection,
      sessionId: newSession.sessionId,
      modelOption,
    });
    const models =
      reasoningByModel === null
        ? configOptionModels
        : buildModelCatalogFromConfigOptions(modelOption, reasoningByModel);
    cachedSessionDiscoveredModels = {
      key,
      models,
      fetchedAt: Date.now(),
    };
    return models;
  } catch (error) {
    process.stderr.write(
      `acp bridge: ACP-native model discovery for "${agent.command}" failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return null;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    connection.kill();
  }
}

async function discoverAcpNativeReasoningByModel(args: {
  connection: AcpAgentConnection;
  sessionId: string;
  modelOption: AcpConfigOption | undefined;
}): Promise<ReadonlyMap<string, AcpNativeReasoningSupport> | null> {
  const modelOptions = args.modelOption?.options ?? [];
  if (!args.modelOption || modelOptions.length === 0) {
    return null;
  }
  const modelOption = args.modelOption;

  // Each probe is one set_config_option round trip to the local agent, so
  // work is bounded by the time budget rather than a model-count cutoff
  // (omp's catalog alone is ~90 models). On timeout or a mid-probe error the
  // partial map is kept: probed models surface their real reasoning levels
  // and unprobed models fall back to the agent-managed default.
  const supportByModel = new Map<string, AcpNativeReasoningSupport>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutReached = new Promise<
    ReadonlyMap<string, AcpNativeReasoningSupport>
  >((resolve) => {
    timeout = setTimeout(() => {
      args.connection.kill();
      resolve(supportByModel);
    }, ACP_NATIVE_REASONING_DISCOVERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      (async () => {
        for (const model of modelOptions) {
          const configState = await args.connection.request({
            method: "session/set_config_option",
            params: {
              sessionId: args.sessionId,
              configId: modelOption.id,
              value: model.value,
            },
            resultSchema: acpConfigStateResultSchema,
          });
          supportByModel.set(
            model.value,
            buildAcpNativeReasoningSupport(
              findAcpThoughtLevelConfigOption(configState.configOptions),
            ),
          );
        }
        return supportByModel;
      })(),
      timeoutReached,
    ]);
  } catch {
    return supportByModel.size > 0 ? supportByModel : null;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function isMissingExecutableError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT" &&
    "syscall" in error &&
    typeof error.syscall === "string" &&
    error.syscall.startsWith("spawn")
  );
}

class AcpModelListAuthRequiredError extends Error {
  readonly code = "auth_required";

  constructor() {
    super(AUTH_REQUIRED_MODEL_LIST_ERROR_MESSAGE);
    this.name = "AcpModelListAuthRequiredError";
  }
}

function isAuthRequiredModelListError(
  error: unknown,
  stdout: string,
  stderr: string,
): boolean {
  const text = [
    error instanceof Error ? error.message : String(error),
    stdout,
    stderr,
  ].join("\n");
  return (
    text.includes("Authentication required") &&
    (text.includes("agent login") ||
      text.includes("CURSOR_API_KEY") ||
      text.includes("CURSOR_AUTH_TOKEN") ||
      text.includes("auth token") ||
      text.includes("api key") ||
      text.includes("login"))
  );
}

/**
 * Resolve the session's model pin to the exact raw agent id and compose global
 * launch args before the ACP subcommand. CLI model selection still resolves
 * reasoning by model-id variant; agents such as Grok can additionally receive
 * reasoning as a separate global flag (`grok --reasoning-effort high agent
 * stdio`).
 */
async function resolveAgentLaunchArgs(
  params: AcpBridgeThreadStartParams,
): Promise<{ args: string[]; warning: string | undefined }> {
  const selection = params.modelSelection;
  const agentArgs = applyPermissionCliArgs(
    params.agent.args,
    params.permissionCli,
    params.permissionMode,
  );
  const prefixArgs: string[] = [];
  let warning: string | undefined;

  if (selection && "selectFlag" in selection) {
    let resolved: string | undefined;
    const variantReasoningLevel =
      params.reasoningCli === undefined ? selection.reasoningLevel : undefined;
    // Resolve whenever the selection narrows the raw id: an explicit reasoning
    // effort, or Fast mode (which picks the model's `-fast` twin).
    if (
      variantReasoningLevel !== undefined ||
      selection.serviceTier === "fast"
    ) {
      // Prefer the catalog cached by the last model/list (the picker the
      // selection came from) over re-running the list command per spawn.
      const key = JSON.stringify(selection.listCommand);
      const catalog =
        cachedModelCatalog?.key === key
          ? cachedModelCatalog.catalog
          : await loadAgentModelCatalog(selection.listCommand);
      resolved = catalog?.resolveVariant({
        model: selection.model,
        reasoningLevel: variantReasoningLevel,
        serviceTier: selection.serviceTier,
      });
      if (resolved === undefined && variantReasoningLevel !== undefined) {
        warning = `Model "${selection.model}" has no ${variantReasoningLevel} reasoning variant; launching it at its default effort.`;
      }
    }
    prefixArgs.push(selection.selectFlag, resolved ?? selection.model);
  }

  if (
    params.reasoningCli !== undefined &&
    params.launchReasoningLevel !== undefined
  ) {
    const reasoningValue = resolveReasoningCliValue({
      reasoningCli: params.reasoningCli,
      reasoningLevel: params.launchReasoningLevel,
    });
    if (reasoningValue !== undefined) {
      prefixArgs.push(params.reasoningCli.flag, reasoningValue);
    } else if (warning === undefined) {
      warning = `Reasoning level "${params.launchReasoningLevel}" is not supported by this ACP agent's launch flag; launching it at its default effort.`;
    }
  }

  return {
    args: [...prefixArgs, ...agentArgs],
    warning,
  };
}

async function selectAcpNativeModel(args: {
  connection: AcpAgentConnection;
  sessionId: string;
  configOptions: readonly AcpConfigOption[] | undefined;
  models: AcpSessionModels | undefined;
  modelSelection: AcpBridgeThreadStartParams["modelSelection"];
  nativeReasoning: AcpBridgeNativeReasoning | undefined;
}): Promise<void> {
  const selection = args.modelSelection;
  if (!selection || !("modelId" in selection)) {
    return;
  }
  let configOptions = args.configOptions;
  const modelOption = findAcpModelConfigOption(args.configOptions);
  const availableSessionModels = args.models?.availableModels ?? [];
  const sessionModelsIncludeSelection = availableSessionModels.some(
    (model) => model.modelId === selection.modelId,
  );
  const shouldSetModel =
    (modelOption && modelOption.currentValue !== selection.modelId) ||
    (!modelOption &&
      sessionModelsIncludeSelection &&
      args.models?.currentModelId !== selection.modelId);
  if (shouldSetModel) {
    // Agents that surface a "model" config option (e.g. omp) pin the model via
    // the standard session/set_config_option and may not implement the legacy
    // session/set_model method, while agents that only report session models
    // state (e.g. opencode) support only session/set_model. Prefer the config
    // option when the agent advertises one and fall back to set_model so
    // option-advertising agents that only implement the legacy method keep
    // working.
    let configState: AcpConfigStateResult | null = null;
    let setModel = true;
    if (modelOption) {
      try {
        configState = await args.connection.request({
          method: "session/set_config_option",
          params: {
            sessionId: args.sessionId,
            configId: modelOption.id,
            value: selection.modelId,
          },
          resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
        });
        setModel = false;
      } catch {
        setModel = true;
      }
    }
    if (setModel) {
      configState = await args.connection.request({
        method: "session/set_model",
        params: { sessionId: args.sessionId, modelId: selection.modelId },
        resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
      });
    }
    configOptions = configState?.configOptions ?? configOptions;
  }
  await selectAcpNativeReasoning({
    connection: args.connection,
    sessionId: args.sessionId,
    configOptions,
    modelSelection: selection,
    nativeReasoning: args.nativeReasoning,
  });
}

async function selectAcpNativeReasoning(args: {
  connection: AcpAgentConnection;
  sessionId: string;
  configOptions: readonly AcpConfigOption[] | undefined;
  modelSelection: Extract<
    AcpBridgeThreadStartParams["modelSelection"],
    { modelId: string }
  >;
  nativeReasoning: AcpBridgeNativeReasoning | undefined;
}): Promise<void> {
  const reasoningLevel = args.modelSelection.reasoningLevel;
  if (reasoningLevel === undefined) {
    return;
  }
  const thoughtLevelOption =
    findAcpThoughtLevelConfigOption(args.configOptions) ??
    nativeReasoningToThoughtLevelOption(args.nativeReasoning);
  if (!thoughtLevelOption) {
    return;
  }
  const value = acpNativeReasoningLevelToValue(
    reasoningLevel,
    thoughtLevelOption,
  );
  if (value === undefined) {
    return;
  }
  try {
    await args.connection.request({
      method: "session/set_config_option",
      params: {
        sessionId: args.sessionId,
        configId: thoughtLevelOption.id,
        value,
      },
      resultSchema: acpConfigStateResultSchema,
    });
  } catch {
    // Unsupported or stale thought levels should leave the agent default intact.
  }
}

// ---------------------------------------------------------------------------
// Prompt content
// ---------------------------------------------------------------------------

function buildPromptContentBlocks(
  session: AcpThreadSession,
  input: PromptInput[],
): AcpContentBlock[] {
  const blocks: AcpContentBlock[] = [];

  const instructions = session.pendingInstructions;
  if (instructions) {
    session.pendingInstructions = undefined;
    blocks.push({
      type: "text",
      text: `<system_instructions>\n${instructions}\n</system_instructions>`,
    });
  }

  for (const item of input) {
    switch (item.type) {
      case "text":
        blocks.push({ type: "text", text: item.text });
        break;
      case "image":
        blocks.push({ type: "text", text: `[image attachment: ${item.url}]` });
        break;
      case "localImage": {
        if (!session.supportsImageInput) {
          blocks.push({
            type: "text",
            text: `[image attachment on disk: ${item.path}]`,
          });
          break;
        }
        try {
          const data = readFileSync(item.path).toString("base64");
          blocks.push({
            type: "image",
            data,
            mimeType: mimeTypeFromExtension(item.path),
          });
        } catch {
          blocks.push({
            type: "text",
            text: `[unreadable image attachment: ${item.path}]`,
          });
        }
        break;
      }
      case "localFile":
        blocks.push({
          type: "resource_link",
          uri: `file://${item.path}`,
          name: item.name ?? basename(item.path),
        });
        break;
    }
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Permission policy
// ---------------------------------------------------------------------------

function findOptionIdByKinds(
  options: AcpPermissionOption[],
  kinds: AcpPermissionOption["kind"][],
): string | undefined {
  for (const kind of kinds) {
    const option = options.find((candidate) => candidate.kind === kind);
    if (option) {
      return option.optionId;
    }
  }
  return undefined;
}

function pickPermissionOptionId(
  options: AcpPermissionOption[],
  decision: "allow_once" | "allow_for_session" | "deny",
): string | undefined {
  switch (decision) {
    case "allow_once":
      return findOptionIdByKinds(options, ["allow_once", "allow_always"]);
    case "allow_for_session":
      return findOptionIdByKinds(options, ["allow_always", "allow_once"]);
    case "deny":
      return findOptionIdByKinds(options, ["reject_once", "reject_always"]);
  }
}

function respondPermission(
  pending: PendingAcpPermission,
  decision: "allow_once" | "allow_for_session" | "deny" | null,
): void {
  if (decision === null) {
    pending.responder.result({ outcome: { outcome: "cancelled" } });
    return;
  }
  const optionId = pickPermissionOptionId(pending.options, decision);
  if (optionId === undefined) {
    pending.responder.result({ outcome: { outcome: "cancelled" } });
    return;
  }
  pending.responder.result({ outcome: { outcome: "selected", optionId } });
}

function cancelPendingPermissions(session: AcpThreadSession): void {
  for (const pending of session.pendingPermissions) {
    pending.responder.result({ outcome: { outcome: "cancelled" } });
  }
  session.pendingPermissions.clear();
}

const acpRawInputCommandSchema = z
  .object({ command: z.string() })
  .passthrough();

function handlePermissionRequest(
  session: AcpThreadSession,
  params: unknown,
  responder: AcpAgentRequestResponder,
): void {
  const parsed = acpRequestPermissionParamsSchema.safeParse(params);
  if (!parsed.success) {
    responder.error(-32602, "Invalid session/request_permission params");
    return;
  }

  if (
    session.stopping ||
    session.cancelRequested ||
    session.activePromptKind !== "turn"
  ) {
    responder.result({ outcome: { outcome: "cancelled" } });
    return;
  }

  const pending: PendingAcpPermission = {
    responder,
    options: parsed.data.options,
  };

  if (session.policy.permissionMode === "full") {
    respondPermission(pending, "allow_once");
    return;
  }

  session.pendingPermissions.add(pending);

  const toolCall = parsed.data.toolCall;
  const rawInputCommand = acpRawInputCommandSchema.safeParse(
    toolCall?.rawInput,
  );
  void sendRuntimeRequest(ACP_PERMISSION_REQUEST_METHOD, {
    threadId: session.bbThreadId,
    providerThreadId: session.providerThreadId,
    turnId: null,
    ...(toolCall?.toolCallId
      ? {
          toolCall: {
            toolCallId: toolCall.toolCallId,
            ...(toolCall.title ? { title: toolCall.title } : {}),
            ...(toolCall.kind ? { kind: toolCall.kind } : {}),
            ...(rawInputCommand.success
              ? { command: rawInputCommand.data.command }
              : {}),
          },
        }
      : {}),
    options: parsed.data.options,
  })
    .then((result) => {
      if (!session.pendingPermissions.delete(pending)) {
        // Already settled as cancelled (stop/cancel raced the user's decision).
        return;
      }
      const decision = acpPermissionResponseSchema.safeParse(result);
      respondPermission(
        pending,
        decision.success ? decision.data.decision : null,
      );
    })
    .catch(() => {
      if (!session.pendingPermissions.delete(pending)) {
        return;
      }
      respondPermission(pending, null);
    });
}

// ---------------------------------------------------------------------------
// Client fs methods
// ---------------------------------------------------------------------------

function isPathInsideRoots(targetPath: string, roots: string[]): boolean {
  const resolvedTarget = resolve(targetPath);
  return roots.some((root) => {
    const relativePath = relative(resolve(root), resolvedTarget);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !isAbsolute(relativePath))
    );
  });
}

function sliceFileContent(
  content: string,
  line: number | null | undefined,
  limit: number | null | undefined,
): string {
  if (line == null && limit == null) {
    return content;
  }
  const lines = content.split("\n");
  const startIndex = line == null ? 0 : Math.max(0, line - 1);
  const endIndex = limit == null ? lines.length : startIndex + limit;
  return lines.slice(startIndex, endIndex).join("\n");
}

async function handleFsReadTextFile(
  params: unknown,
  responder: AcpAgentRequestResponder,
): Promise<void> {
  const parsed = acpReadTextFileParamsSchema.safeParse(params);
  if (!parsed.success) {
    responder.error(-32602, "Invalid fs/read_text_file params");
    return;
  }
  try {
    const content = await fs.readFile(parsed.data.path, "utf8");
    responder.result({
      content: sliceFileContent(content, parsed.data.line, parsed.data.limit),
    });
  } catch (error) {
    responder.error(
      -32603,
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function handleFsWriteTextFile(
  session: AcpThreadSession,
  params: unknown,
  responder: AcpAgentRequestResponder,
): Promise<void> {
  const parsed = acpWriteTextFileParamsSchema.safeParse(params);
  if (!parsed.success) {
    responder.error(-32602, "Invalid fs/write_text_file params");
    return;
  }

  if (
    session.policy.permissionMode === "accept-edits" &&
    !isPathInsideRoots(parsed.data.path, session.policy.workspaceWriteRoots)
  ) {
    responder.error(
      -32000,
      `File writes outside the workspace are denied by BB's accept-edits permission mode: ${parsed.data.path}`,
    );
    return;
  }

  try {
    let oldText: string | undefined;
    try {
      oldText = await fs.readFile(parsed.data.path, "utf8");
    } catch {
      oldText = undefined;
    }
    await fs.mkdir(dirname(parsed.data.path), { recursive: true });
    await fs.writeFile(parsed.data.path, parsed.data.content, "utf8");

    const diff = buildEditDiff(parsed.data.path, oldText, parsed.data.content);
    sendNotification(ACP_FS_WRITE_METHOD, {
      threadId: session.bbThreadId,
      path: parsed.data.path,
      kind: oldText === undefined ? "add" : "update",
      ...(diff ? { diff } : {}),
    });
    responder.result(null);
  } catch (error) {
    responder.error(
      -32603,
      error instanceof Error ? error.message : String(error),
    );
  }
}

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

function removeSession(session: AcpThreadSession): void {
  if (sessionsByBbThreadId.get(session.bbThreadId) === session) {
    sessionsByBbThreadId.delete(session.bbThreadId);
  }
  if (
    bbThreadIdByProviderThreadId.get(session.providerThreadId) ===
    session.bbThreadId
  ) {
    bbThreadIdByProviderThreadId.delete(session.providerThreadId);
  }
}

function getSessionByProviderThreadId(
  providerThreadId: string,
): AcpThreadSession | undefined {
  const bbThreadId = bbThreadIdByProviderThreadId.get(providerThreadId);
  return bbThreadId ? sessionsByBbThreadId.get(bbThreadId) : undefined;
}

type AcpSessionStartParams =
  | { kind: "start"; params: AcpBridgeThreadStartParams }
  | { kind: "resume"; params: AcpBridgeThreadResumeParams }
  | { kind: "fork"; params: AcpBridgeThreadForkParams };

async function startAgentSession(
  request: AcpSessionStartParams,
): Promise<AcpThreadSession> {
  const params = request.params;
  const bbThreadId = params.threadId;

  const existing = sessionsByBbThreadId.get(bbThreadId);
  if (existing) {
    await stopSession(existing);
  }

  const launch = await resolveAgentLaunchArgs(params);
  if (launch.warning) {
    sendNotification(ACP_WARNING_METHOD, {
      threadId: bbThreadId,
      summary: launch.warning,
    });
  }
  const agentLabel = [params.agent.command, ...params.agent.args].join(" ");
  // The connection handlers close over `session`; they only fire after the
  // child process emits events, by which point the session is constructed.
  let session: AcpThreadSession;
  const childEnv = {
    ...withoutBridgeRuntimeEnv(process.env),
    ...params.envVars,
  };
  const connection = createAcpAgentConnection({
    command: params.agent.command,
    args: launch.args,
    cwd: params.cwd,
    env: childEnv,
    onNotification: (method, notificationParams) =>
      handleAgentNotification(session, method, notificationParams),
    onRequest: (method, requestParams, responder) =>
      handleAgentRequest(session, method, requestParams, responder),
    onExit: (info) => {
      const wasCurrent = sessionsByBbThreadId.get(bbThreadId) === session;
      cancelPendingPermissions(session);
      removeSession(session);
      if (!wasCurrent || session.stopping) {
        return;
      }
      sendNotification("error", {
        threadId: bbThreadId,
        message:
          `ACP agent "${agentLabel}" exited unexpectedly` +
          `${info.code !== null ? ` (code ${info.code})` : ""}` +
          `${info.stderrTail ? `: ${info.stderrTail}` : ""}`,
      });
    },
  });
  session = {
    bbThreadId,
    providerThreadId: "",
    connection,
    agentLabel,
    supportsImageInput: false,
    supportsLoadSession: false,
    policy: {
      permissionMode: params.permissionMode,
      permissionEscalation: params.permissionEscalation,
      workspaceWriteRoots: params.workspaceWriteRoots,
    },
    cwd: params.cwd,
    pendingInstructions: params.instructions,
    activePromptKind: null,
    queuedInputs: [],
    promptRequestPending: false,
    cancelRequested: false,
    loading: false,
    loadingSessionId: undefined,
    pendingLoadUsageUpdate: undefined,
    stopping: false,
    turnSettled: undefined,
    pendingPermissions: new Set(),
  };

  try {
    const initializeResult = await connection.request({
      method: "initialize",
      params: {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientInfo: { name: "bb", version: "1.0.0" },
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: false,
        },
      },
      resultSchema: acpInitializeResultSchema,
    });
    await authenticateAcpAgent({
      connection,
      env: childEnv,
      initializeResult,
    });
    session.supportsImageInput =
      initializeResult.agentCapabilities?.promptCapabilities?.image ?? false;
    const supportsLoadSession =
      initializeResult.agentCapabilities?.loadSession ?? false;
    const supportsFork =
      initializeResult.agentCapabilities?.sessionCapabilities?.fork != null;
    if (request.kind === "fork" && !supportsFork) {
      throw new Error(
        `ACP agent "${agentLabel}" does not advertise session/fork support.`,
      );
    }
    // ACP session/fork clones the whole source session. It cannot stop at a
    // message checkpoint, so a message edit would keep source turns that the
    // BB timeline no longer shows. Reject the fork instead.
    if (
      request.kind === "fork" &&
      request.params.sourceProviderCheckpointId !== undefined
    ) {
      throw new Error(
        `ACP agent "${agentLabel}" does not support a session/fork checkpoint.`,
      );
    }
    session.supportsLoadSession = supportsLoadSession;
    const mcpServers = await buildSessionMcpServers(params);

    let sessionId: string | undefined;
    let loadedConfigOptions: readonly AcpConfigOption[] | undefined;
    let loadedModels: AcpSessionModels | undefined;
    if (request.kind === "fork") {
      const forkedSession = await connection.request({
        method: "session/fork",
        params: {
          sessionId: request.params.sourceProviderThreadId,
          cwd: params.cwd,
          mcpServers,
        },
        resultSchema: acpSessionForkResultSchema,
      });
      // The agent owns this value and the schema checks only that it is a
      // string. A reused ID would overwrite the map entry of the source or of
      // another live thread, so reject it instead of registering it.
      if (
        forkedSession.sessionId === request.params.sourceProviderThreadId ||
        getSessionByProviderThreadId(forkedSession.sessionId) !== undefined
      ) {
        throw new Error(
          `ACP agent "${agentLabel}" returned an active session ID for session/fork.`,
        );
      }
      sessionId = forkedSession.sessionId;
      loadedConfigOptions = forkedSession.configOptions;
      loadedModels = forkedSession.models;
    } else if (request.kind === "resume" && supportsLoadSession) {
      session.loading = true;
      session.loadingSessionId = request.params.providerThreadId;
      session.pendingLoadUsageUpdate = undefined;
      try {
        const configState = await connection.request({
          method: "session/load",
          params: {
            sessionId: request.params.providerThreadId,
            cwd: params.cwd,
            mcpServers,
          },
          resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
        });
        loadedConfigOptions = configState?.configOptions;
        loadedModels = configState?.models;
        sessionId = request.params.providerThreadId;
      } catch {
        sessionId = undefined;
        session.loading = false;
        session.loadingSessionId = undefined;
        session.pendingLoadUsageUpdate = undefined;
      }
    }

    if (sessionId === undefined) {
      session.loading = false;
      session.loadingSessionId = undefined;
      session.pendingLoadUsageUpdate = undefined;
      const newSession = await connection.request({
        method: "session/new",
        params: { cwd: params.cwd, mcpServers },
        resultSchema: acpSessionNewResultSchema,
      });
      sessionId = newSession.sessionId;
      await selectAcpNativeModel({
        connection,
        sessionId,
        configOptions: newSession.configOptions,
        models: newSession.models,
        modelSelection: params.modelSelection,
        nativeReasoning: params.nativeReasoning,
      });
      if (request.kind === "resume") {
        sendNotification(ACP_WARNING_METHOD, {
          threadId: bbThreadId,
          summary: `${agentLabel} could not restore the previous session; continuing in a fresh session without in-agent history.`,
        });
      }
    } else {
      await selectAcpNativeModel({
        connection,
        sessionId,
        configOptions: loadedConfigOptions,
        models: loadedModels,
        modelSelection: params.modelSelection,
        nativeReasoning: params.nativeReasoning,
      });
      const loadUsageUpdate = session.pendingLoadUsageUpdate;
      session.loading = false;
      session.loadingSessionId = undefined;
      session.pendingLoadUsageUpdate = undefined;
      if (loadUsageUpdate) {
        sendNotification(ACP_UPDATE_METHOD, {
          threadId: session.bbThreadId,
          update: loadUsageUpdate,
        });
      }
    }

    session.providerThreadId = sessionId;
    sessionsByBbThreadId.set(bbThreadId, session);
    bbThreadIdByProviderThreadId.set(sessionId, bbThreadId);
    sendNotification("thread/identity", {
      threadId: bbThreadId,
      providerThreadId: sessionId,
    });
    return session;
  } catch (error) {
    session.stopping = true;
    connection.kill();
    removeSession(session);
    throw error;
  }
}

async function stopSession(session: AcpThreadSession): Promise<void> {
  if (session.stopping) {
    return;
  }
  session.stopping = true;
  session.queuedInputs = [];
  cancelPendingPermissions(session);

  if (session.activePromptKind !== null && !session.connection.exited) {
    session.connection.notify("session/cancel", {
      sessionId: session.providerThreadId,
    });
    if (session.turnSettled) {
      await Promise.race([
        session.turnSettled,
        new Promise<void>((resolveTimeout) =>
          setTimeout(resolveTimeout, THREAD_STOP_CANCEL_TIMEOUT_MS),
        ),
      ]);
    }
  }

  session.connection.kill();
  removeSession(session);
}

// ---------------------------------------------------------------------------
// Turn loop
// ---------------------------------------------------------------------------

function requestSteerCancel(session: AcpThreadSession): void {
  if (
    session.stopping ||
    session.cancelRequested ||
    !session.promptRequestPending ||
    session.connection.exited
  ) {
    return;
  }
  session.cancelRequested = true;
  cancelPendingPermissions(session);
  session.connection.notify("session/cancel", {
    sessionId: session.providerThreadId,
  });
}

function finishTurn(
  session: AcpThreadSession,
  stopReason: z.infer<typeof acpStopReasonSchema>,
): void {
  session.activePromptKind = null;
  session.queuedInputs = [];
  session.promptRequestPending = false;
  session.cancelRequested = false;
  sendNotification(ACP_TURN_COMPLETED_METHOD, {
    threadId: session.bbThreadId,
    stopReason,
  });
}

function runTurn(session: AcpThreadSession, firstInput: PromptInput[]): void {
  session.activePromptKind = "turn";
  sendNotification(ACP_TURN_STARTED_METHOD, { threadId: session.bbThreadId });

  session.turnSettled = (async () => {
    let input = firstInput;
    for (;;) {
      if (session.stopping) {
        finishTurn(session, "cancelled");
        return;
      }

      let stopReason: z.infer<typeof acpStopReasonSchema>;
      session.cancelRequested = false;
      try {
        session.promptRequestPending = true;
        const promptResult = session.connection.request({
          method: "session/prompt",
          params: {
            sessionId: session.providerThreadId,
            prompt: buildPromptContentBlocks(session, input),
          },
          resultSchema: acpPromptResultSchema,
        });
        // A steer that stacked behind the cancelled prompt still needs its own
        // cancel; otherwise this prompt can hang and strand the later input.
        if (session.queuedInputs.length > 0) {
          requestSteerCancel(session);
        }
        const result = await promptResult;
        stopReason = result.stopReason;
      } catch (error) {
        session.promptRequestPending = false;
        session.queuedInputs = [];
        session.cancelRequested = false;
        session.activePromptKind = null;
        // An exited agent already produced an error notification from the
        // connection's exit handler; only report in-protocol prompt failures.
        if (!session.stopping && !session.connection.exited) {
          sendNotification("error", {
            threadId: session.bbThreadId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      session.promptRequestPending = false;

      // Hard steer cancels the current prompt, then continues this bb turn.
      if (!session.stopping) {
        const next = session.queuedInputs.shift();
        if (next) {
          input = next;
          continue;
        }
      }

      finishTurn(session, stopReason);
      return;
    }
  })();
}

function startCompaction(session: AcpThreadSession): void {
  if (session.activePromptKind !== null) {
    throw new Error("Cannot compact context while an ACP turn is active");
  }

  session.activePromptKind = "compaction";
  sendNotification(ACP_COMPACTION_STARTED_METHOD, {
    threadId: session.bbThreadId,
  });

  const request = session.connection.request({
    method: "session/prompt",
    params: {
      sessionId: session.providerThreadId,
      prompt: [{ type: "text", text: "/compact" }],
    },
    resultSchema: acpPromptResultSchema,
  });
  session.turnSettled = request
    .then((result) => {
      const outcome =
        result.stopReason === "end_turn"
          ? { status: "completed" }
          : result.stopReason === "cancelled"
            ? { status: "interrupted" }
            : {
                status: "failed",
                error: `Agent stopped compaction: ${result.stopReason}`,
              };
      sendNotification(ACP_COMPACTION_COMPLETED_METHOD, {
        threadId: session.bbThreadId,
        ...outcome,
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      sendNotification(ACP_COMPACTION_COMPLETED_METHOD, {
        threadId: session.bbThreadId,
        status: "failed",
        error: message,
      });
    })
    .finally(() => {
      session.activePromptKind = null;
      session.turnSettled = undefined;
    });
}

// ---------------------------------------------------------------------------
// Agent inbound traffic
// ---------------------------------------------------------------------------

function handleAgentRequest(
  session: AcpThreadSession,
  method: string,
  params: unknown,
  responder: AcpAgentRequestResponder,
): void {
  switch (method) {
    case "session/request_permission":
      handlePermissionRequest(session, params, responder);
      return;
    case "fs/read_text_file":
      void handleFsReadTextFile(params, responder);
      return;
    case "fs/write_text_file":
      void handleFsWriteTextFile(session, params, responder);
      return;
    default:
      responder.error(-32601, `Unsupported ACP client method "${method}"`);
  }
}

function handleAgentNotification(
  session: AcpThreadSession,
  method: string,
  params: unknown,
): void {
  if (method !== "session/update") {
    return;
  }
  if (session.stopping) {
    return;
  }
  const parsed = acpSessionNotificationParamsSchema.safeParse(params);
  if (!parsed.success) {
    return;
  }
  if (session.loading) {
    if (
      parsed.data.sessionId === session.loadingSessionId &&
      parsed.data.update.sessionUpdate === "usage_update"
    ) {
      const usageUpdate = acpUsageUpdateSchema.safeParse(parsed.data.update);
      if (usageUpdate.success) {
        session.pendingLoadUsageUpdate = usageUpdate.data;
      }
    }
    return;
  }
  if (
    session.providerThreadId !== "" &&
    parsed.data.sessionId !== session.providerThreadId
  ) {
    return;
  }
  sendNotification(ACP_UPDATE_METHOD, {
    threadId: session.bbThreadId,
    update: parsed.data.update,
  });
}

// ---------------------------------------------------------------------------
// Runtime command handling
// ---------------------------------------------------------------------------

function decodeAcpBridgeJsonRpcRequest(
  raw: unknown,
): (AcpBridgeCommand & { id: string | number }) | null {
  const envelope = jsonRpcEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return null;
  }
  const command = acpBridgeCommandSchema.safeParse({
    method: envelope.data.method,
    params: envelope.data.params ?? {},
  });
  if (!command.success) {
    return null;
  }
  return { ...command.data, id: envelope.data.id };
}

async function handleRequest(
  request: AcpBridgeCommand & { id: string | number },
): Promise<void> {
  switch (request.method) {
    case "initialize":
      sendResult(request.id, { ok: true });
      return;

    case "model/list": {
      const catalog = request.params.listCommand
        ? await loadAgentModelCatalog(request.params.listCommand)
        : null;
      if (catalog) {
        sendResult(
          request.id,
          splitPrimaryModels(
            applyConfiguredReasoningToModels(catalog.models, {
              reasoningCli: request.params.reasoningCli,
              nativeReasoning: request.params.nativeReasoning,
            }),
            request.params.primaryModels,
          ),
        );
        return;
      }
      const sessionDiscoveredModels =
        request.params.listCommand === undefined && request.params.agent
          ? await loadSessionDiscoveredModels(request.params.agent)
          : null;
      if (sessionDiscoveredModels) {
        sendResult(request.id, {
          models: applyConfiguredReasoningToModels(sessionDiscoveredModels, {
            reasoningCli: request.params.reasoningCli,
            nativeReasoning: request.params.nativeReasoning,
          }),
          selectedOnlyModels: [],
        });
        return;
      }
      sendResult(request.id, {
        models: [
          applyConfiguredReasoningToModel(ACP_DEFAULT_MODEL, {
            reasoningCli: request.params.reasoningCli,
            nativeReasoning: request.params.nativeReasoning,
          }),
        ],
        selectedOnlyModels: [],
      });
      return;
    }

    case "thread/start": {
      const session = await startAgentSession({
        kind: "start",
        params: request.params,
      });
      sendResult(request.id, {
        providerThreadId: session.providerThreadId,
        sessionRestorable: session.supportsLoadSession,
      });
      return;
    }

    case "thread/resume": {
      const session = await startAgentSession({
        kind: "resume",
        params: request.params,
      });
      sendResult(request.id, {
        providerThreadId: session.providerThreadId,
        sessionRestorable: session.supportsLoadSession,
      });
      return;
    }

    case "thread/fork": {
      const session = await startAgentSession({
        kind: "fork",
        params: request.params,
      });
      sendResult(request.id, { providerThreadId: session.providerThreadId });
      return;
    }

    case "turn/start": {
      const session = getSessionByProviderThreadId(request.params.threadId);
      if (!session || session.stopping) {
        sendError(request.id, -32000, "No active ACP session");
        return;
      }
      if (session.activePromptKind !== null) {
        sendError(request.id, -32000, "A turn is already active");
        return;
      }
      runTurn(session, request.params.input);
      sendResult(request.id, { threadId: request.params.threadId });
      return;
    }

    case "turn/steer": {
      const session = getSessionByProviderThreadId(request.params.threadId);
      if (!session || session.stopping) {
        sendError(request.id, -32000, "No active ACP session");
        return;
      }
      if (session.activePromptKind !== "turn") {
        sendError(
          request.id,
          ACP_BRIDGE_NO_ACTIVE_TURN_ERROR_CODE,
          "No active turn to steer",
        );
        return;
      }
      session.queuedInputs.push(request.params.input);
      requestSteerCancel(session);
      sendResult(request.id, { threadId: request.params.threadId });
      return;
    }

    case "thread/stop": {
      const session = getSessionByProviderThreadId(request.params.threadId);
      if (session) {
        await stopSession(session);
      }
      sendResult(request.id, { ok: true });
      return;
    }

    case "thread/compact": {
      const session = getSessionByProviderThreadId(request.params.threadId);
      if (!session || session.stopping) {
        sendError(request.id, -32000, "No active ACP session");
        return;
      }
      try {
        startCompaction(session);
        sendResult(request.id, { threadId: request.params.threadId });
      } catch (error) {
        sendError(
          request.id,
          -32000,
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }
  }
}

function handleParsedMessage(parsed: unknown): void {
  const response = decodeBridgeJsonRpcResponse(parsed);
  if (response && typeof response.id === "number") {
    const pending = pendingRuntimeRequests.get(response.id);
    if (pending) {
      pendingRuntimeRequests.delete(response.id);
      pending(response);
      return;
    }
  }

  const request = decodeAcpBridgeJsonRpcRequest(parsed);
  if (!request) {
    return;
  }
  runBridgeRequest({ request, handleRequest, sendError });
}

export const handleLine = createBridgeLineHandler({ handleParsedMessage });

async function stopAllSessions(): Promise<void> {
  await Promise.all(
    Array.from(sessionsByBbThreadId.values()).map((session) =>
      stopSession(session),
    ),
  );
  const dynamicToolBridge = dynamicToolBridgePromise
    ? await dynamicToolBridgePromise.catch(() => null)
    : null;
  await new Promise<void>((resolveClose) => {
    if (!dynamicToolBridge) {
      resolveClose();
      return;
    }
    dynamicToolBridge.server.close(() => resolveClose());
  });
}

if (isMainModule(import.meta.url) && process.argv.includes("--mcp-stdio")) {
  runAcpDynamicToolMcpServer();
} else {
  startBridgeStdio({
    importMetaUrl: import.meta.url,
    handleLine,
    onClose: () => {
      // Stdin close is a process shutdown boundary; cancel and reap the agent
      // subprocesses before the bridge exits so none outlive the daemon.
      void stopAllSessions().finally(() => {
        process.exit(0);
      });
    },
  });
}
