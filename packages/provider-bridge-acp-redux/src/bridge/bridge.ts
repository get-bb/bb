import {
  isStandaloneBuiltinCompactCommand,
  pendingInteractionResolutionSchema,
  reasoningEffortsForLevels,
  THREAD_PROVIDER_COMMANDS_STATE_KIND,
  THREAD_SESSION_OPTIONS_STATE_KIND,
  userQuestionPendingInteractionResolutionSchema,
} from "@bb/domain";
import type {
  AvailableModel,
  ExtensionKind,
  JsonValue,
  PromptInput,
  ReasoningLevel,
  SessionOptionSelections,
} from "@bb/domain";
import { acpLaunchSpecSchema, type AcpLaunchSpec } from "../launch-spec.js";
import {
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
} from "@bb/provider-bridge-protocol";
import type {
  BridgeExecutionOptions,
  InitializeResult,
  ThreadDelta,
} from "@bb/provider-bridge-protocol";
import {
  PROVIDER_TOOL_CALL_CANCELLED_METHOD,
  BridgeRecoveryError,
  bridgeRequestEnvelopeSchema,
  createBridgeIo,
  createBridgeLineHandler,
  decodeBridgeJsonRpcResponse,
  decodeToolCallResponsePayload,
  experimental_defineProviderBridge,
  mimeTypeFromExtension,
  runBridgeRequest,
  withoutBridgeRuntimeEnv,
} from "@bb/provider-bridge-protocol/bridge-kit";
import type {
  BridgeJsonRpcResponse,
  BridgeToolCallContent,
  BridgeToolCallImage,
} from "@bb/provider-bridge-protocol/bridge-kit";
import { execPortableFile } from "@bb/process-utils";
import { randomBytes } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  ACP_COMPACTION_COMPLETED_METHOD,
  ACP_COMPACTION_STARTED_METHOD,
  ACP_DEFAULT_MODEL_ID,
  ACP_FS_WRITE_METHOD,
  ACP_TURN_COMPLETED_METHOD,
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
  ACP_WARNING_METHOD,
  acpBridgeCommandSchema,
  type AcpBridgeCommand,
  type AcpBridgeNativeReasoning,
  type AcpBridgePermissionCli,
  type AcpBridgeReasoningCli,
  acpBridgeCommandMethodValues,
} from "../bridge-protocol.js";
import {
  createAcpDeltaTranslator,
  type AcpDeltaTranslator,
} from "../delta-translation.js";
import {
  compactionOutcomeForEndTurn,
  grokContextUsageFromPromptResult,
  grokContextWindowSizeFromSessionModels,
  resolveAcpDialect,
  type AcpDialect,
} from "../dialect.js";
import type { AcpMaintenanceDialect } from "./provider-maintenance.js";
import { describeAcpSignIn } from "../auth-guidance.js";
import { planAcpElicitation } from "../elicitation.js";
import {
  buildAcpPermissionInteractionPayload,
  resolveAcpPermissionDecision,
} from "../interactions.js";
import {
  buildAcpModelListParams,
  buildAcpModelSelectionParams,
  buildAcpSessionParams,
  type AcpAgentCommandParam,
  type AcpModelListParams,
  type AcpSessionParams,
  type AcpSkillRoot,
} from "../session-params.js";
import { buildCursorParameterizedModelCatalog } from "../cursor-model-selection.js";
import {
  getAcpProviderHealth,
  getAcpProviderInstallationRun,
  getAcpProviderInstallationStatus,
  getAcpProviderUsage,
} from "./provider-maintenance.js";
import {
  type AcpConfigOption,
  acpConfigStateResultSchema,
  acpPromptResultSchema,
  acpReadTextFileParamsSchema,
  acpRequestPermissionParamsSchema,
  acpSessionForkResultSchema,
  acpSessionNewResultSchema,
  acpSessionNotificationParamsSchema,
  acpAgentMessageChunkUpdateSchema,
  extractAcpContentText,
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
  ACP_CORE_CLIENT_REQUEST_METHODS,
  AcpAgentResponseError,
  createAcpAgentConnection,
  requestAcpInitialize,
  type AcpAgentConnection,
  type AcpAgentRequestResponder,
} from "./agent-connection.js";
import type { AcpAgentCapabilities } from "../client/capabilities.js";
import {
  createAcpSessionModel,
  type AcpSessionModel,
} from "../session/session-model.js";
import { isJsonObject } from "../session/decode.js";
import {
  isUserSelectableSessionOption,
  toThreadProviderCommandsState,
  toThreadSessionOptionsState,
} from "../session/thread-state.js";
import type { AcpSessionEvent } from "../session/session-types.js";
import {
  approveCursorSessionMcpServer,
  revokeCursorSessionMcpServer,
  type CursorMcpApproval,
} from "./cursor-mcp-approval.js";
import {
  ACP_NATIVE_REASONING_EFFORTS,
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
  ACP_BRIDGE_MCP_SERVER_NAME,
  buildAcpMcpServerConfig,
  dynamicToolBridgeRequestSchema,
  runAcpDynamicToolMcpServer,
  type AcpMcpServerConfig,
} from "./tool-proxy-mcp.js";

interface AcpSessionPolicy {
  permissionMode: "accept-edits" | "full";
  workspaceWriteRoots: string[];
}

interface PendingAcpPermission {
  responder: AcpAgentRequestResponder;
  options: AcpPermissionOption[];
}

interface AcpPendingTurnInput {
  clientRequestId: string;
  input: PromptInput[];
  requestId: AcpBridgeRequestId | null;
  options: BridgeExecutionOptions;
}

interface AcpNativeConfigState {
  configOptions: readonly AcpConfigOption[] | undefined;
  models: AcpSessionModels | undefined;
}

interface AcpThreadSession {
  bbThreadId: string;
  construction: AcpSessionParams;
  nativeConfig: AcpNativeConfigState;
  providerThreadId: string;
  cwd: string;
  dialect: AcpDialect;
  translator: AcpDeltaTranslator;
  connection: AcpAgentConnection;
  model: AcpSessionModel;
  promptWorkOpen: boolean;
  agentTurnQuietTimer: ReturnType<typeof setTimeout> | undefined;
  agentUpdateCount: number;
  publishedThreadState: Map<string, string>;
  capabilities: AcpAgentCapabilities | undefined;
  supportsImageInput: boolean;
  supportsLoadSession: boolean;
  policy: AcpSessionPolicy;
  pendingInstructions: string | undefined;
  activePromptKind: "turn" | "compaction" | "agent" | null;
  compactionAgentMessage: string;
  queuedInputs: AcpPendingTurnInput[];
  promptRequestPending: boolean;
  cancelRequested: boolean;
  restartAfterCancelError: boolean;
  loading: boolean;
  loadingSessionId: string | undefined;
  pendingLoadUsageUpdate: AcpUsageUpdate | undefined;
  grokContextWindowSize: number | undefined;
  stopping: boolean;
  turnSettled: Promise<void> | undefined;
  pendingPermissions: Set<PendingAcpPermission>;
  pendingElicitations: Set<AcpAgentRequestResponder>;
  pendingToolCalls: Set<AbortController>;
  cursorMcpApproval: CursorMcpApproval | undefined;
  deferStartEmit: AcpDeferredStartEmitter | undefined;
}

type AcpDeferredStartEmitter = (
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  rawUpdate?: unknown,
) => void;

const sessionsByBbThreadId = new Map<string, AcpThreadSession>();
const bbThreadIdByProviderThreadId = new Map<string, string>();
const pendingRuntimeRequests = new Map<
  number,
  (response: BridgeJsonRpcResponse) => void
>();
let runtimeRequestIdCounter = 0;
let dynamicToolBridgePromise: Promise<AcpDynamicToolBridge> | null = null;

const THREAD_STOP_CANCEL_TIMEOUT_MS = 4_000;
const AGENT_TURN_QUIET_MS = 5_000;
const SESSION_BUSY_QUIET_MS = 2_000;
const SESSION_BUSY_MAX_WAITS = 300;
const SESSION_BUSY_MAX_RETRIES = 3;
const ACP_SESSION_BUSY_ERROR_CODE = -32003;
const ACP_SESSION_SETUP_TIMEOUT_MS = 300_000;
const ACP_SESSION_CONFIG_TIMEOUT_MS = 60_000;
const ACP_AUTHENTICATE_TIMEOUT_MS = 120_000;

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

type AcpBridgeRequestId = Parameters<typeof sendResult>[0];

function sendNotification(
  method: string,
  params: Record<string, unknown>,
): void {
  send({ jsonrpc: "2.0", method, params });
}

function sendRuntimeRequest(
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  runtimeRequestIdCounter += 1;
  const requestId = runtimeRequestIdCounter;
  let abort: () => void;
  const responsePromise = new Promise<unknown>(
    (resolveResponse, rejectResponse) => {
      abort = () => {
        pendingRuntimeRequests.delete(requestId);
        sendNotification(PROVIDER_TOOL_CALL_CANCELLED_METHOD, { requestId });
        rejectResponse(new Error("ACP dynamic tool call cancelled"));
      };
      signal?.addEventListener("abort", abort, { once: true });
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
  return responsePromise.finally(() =>
    signal?.removeEventListener("abort", abort),
  );
}

let configuredSkillRoots: AcpSkillRoot[] | null = null;

function sendThreadDeltas(
  threadId: string,
  deltas: readonly ThreadDelta[],
): void {
  if (deltas.length === 0) {
    return;
  }
  sendNotification(THREAD_DELTA_NOTIFICATION_METHOD, {
    threadId,
    deltas: [...deltas],
  });
}

function rememberGrokContextWindow(
  session: AcpThreadSession,
  models: unknown,
): void {
  if (session.dialect.id !== "grok") {
    return;
  }
  const size = grokContextWindowSizeFromSessionModels(models);
  if (size !== undefined) {
    session.grokContextWindowSize = size;
  }
}

function emitGrokContextWindow(session: AcpThreadSession, used: number): void {
  if (
    session.dialect.id !== "grok" ||
    session.grokContextWindowSize === undefined
  ) {
    return;
  }
  const cost = session.model.snapshot().usage?.cost ?? undefined;
  sendThreadDeltas(session.bbThreadId, [
    {
      kind: "contextWindow",
      used,
      size: session.grokContextWindowSize,
      estimated: false,
      attach: "open",
      ...(cost === undefined ? {} : { cost }),
    },
  ]);
}

function emitForSession(
  session: AcpThreadSession,
  method: string,
  params: Record<string, unknown>,
): void {
  sendThreadDeltas(
    session.bbThreadId,
    session.translator.translateAcpEvent(
      { jsonrpc: "2.0", method, params },
      { threadId: session.bbThreadId },
    ),
  );
}

function emitSessionError(session: AcpThreadSession, message: string): void {
  for (const controller of session.pendingToolCalls) controller.abort();
  if (session.activePromptKind !== null) {
    emitForSession(session, "error", {
      threadId: session.bbThreadId,
      message,
    });
  }
  sendNotification(BRIDGE_NOTIFICATION_METHODS.error, {
    threadId: session.bbThreadId,
    ...(session.providerThreadId !== ""
      ? { providerThreadId: session.providerThreadId }
      : {}),
    message,
  });
}

function resolveBridgeProcessArgsForMcpServer(): string[] {
  return [...process.execArgv, fileURLToPath(import.meta.url), "--mcp-stdio"];
}

function resolveBridgeProcessEnvForMcpServer(): AcpMcpServerConfig["env"] {
  const electronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
  if (electronRunAsNode === undefined) {
    return [];
  }

  return [{ name: "ELECTRON_RUN_AS_NODE", value: electronRunAsNode }];
}

async function forwardDynamicToolCall(
  args: {
    arguments: Record<string, unknown>;
    callId: string;
    threadId: string;
    tool: string;
  },
  signal: AbortSignal,
): Promise<
  | {
      ok: true;
      content: string;
      contentBlocks: BridgeToolCallContent[];
      images: BridgeToolCallImage[];
      isError?: boolean;
    }
  | { ok: false; error: string }
> {
  const session = sessionsByBbThreadId.get(args.threadId);
  if (
    !session ||
    !session.providerThreadId ||
    session.stopping ||
    session.connection.exited
  ) {
    return { ok: false, error: "No active ACP session for dynamic tool call." };
  }

  const controller = new AbortController();
  session.pendingToolCalls.add(controller);
  session.translator.noteInjectedToolCall(session.bbThreadId, args.tool);
  try {
    const result = await sendRuntimeRequest(
      "item/tool/call",
      {
        providerThreadId: session.providerThreadId,
        threadId: session.bbThreadId,
        turnId: null,
        callId: args.callId,
        tool: args.tool,
        arguments: args.arguments,
      },
      AbortSignal.any([signal, controller.signal]),
    );
    return { ok: true, ...decodeToolCallResponsePayload(result) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    session.pendingToolCalls.delete(controller);
  }
}

function handleDynamicToolBridgeSocket(
  bridge: AcpDynamicToolBridge,
  socket: Socket,
): void {
  const controller = new AbortController();
  socket.once("close", () => controller.abort());
  let handled = false;
  let buffer = "";
  socket.setEncoding("utf8");
  socket.on("error", () => {});
  socket.on("data", (chunk) => {
    if (handled) return;
    buffer += chunk;
    const newlineIndex = buffer.indexOf("\n");
    if (newlineIndex === -1) {
      return;
    }
    handled = true;
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
    if (request.data.kind === "initialized") {
      process.stderr.write(
        `acp bridge: "${ACP_BRIDGE_MCP_SERVER_NAME}" answered initialize for thread "${request.data.threadId}" (${request.data.toolCount} tools)\n`,
      );
      socket.end(`${JSON.stringify({ ok: true, content: "" })}\n`);
      return;
    }
    void forwardDynamicToolCall(request.data, controller.signal).then(
      (response) => {
        if (controller.signal.aborted) return;
        socket.end(`${JSON.stringify(response)}\n`);
      },
    );
  });
}

async function ensureDynamicToolBridge(): Promise<AcpDynamicToolBridge> {
  if (dynamicToolBridgePromise) {
    return dynamicToolBridgePromise;
  }

  dynamicToolBridgePromise = new Promise((resolveBridge, rejectBridge) => {
    const host = "127.0.0.1";
    const server = createServer((socket) => {
      socket.on("error", () => {});
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
  params: AcpSessionParams,
): Promise<AcpMcpServerConfig[]> {
  const dynamicTools = params.dynamicTools ?? [];
  if (dynamicTools.length === 0) {
    return [];
  }
  const bridge = await ensureDynamicToolBridge();
  const config = buildAcpMcpServerConfig({
    bridgeArgs: resolveBridgeProcessArgsForMcpServer(),
    command: process.execPath,
    dynamicTools,
    host: bridge.host,
    port: bridge.port,
    runtimeEnv: resolveBridgeProcessEnvForMcpServer(),
    threadId: params.threadId,
    token: bridge.token,
  });
  process.stderr.write(
    `acp bridge: built "${config.name}" session MCP config for thread "${params.threadId}" (${dynamicTools.length} tools)\n`,
  );
  return [config];
}

const ACP_DEFAULT_MODEL: AvailableModel = {
  id: ACP_DEFAULT_MODEL_ID,
  model: ACP_DEFAULT_MODEL_ID,
  displayName: "Agent default",
  description: "Model selection is managed by the connected ACP agent.",
  supportedReasoningEfforts: ACP_NATIVE_REASONING_EFFORTS,
  defaultReasoningEffort: "medium",
  isDefault: true,
};

const MODEL_LIST_TIMEOUT_MS = 30_000;
const ACP_NATIVE_REASONING_DISCOVERY_TIMEOUT_MS = 5_000;
const AUTH_REQUIRED_MODEL_LIST_ERROR_MESSAGE =
  "ACP agent is not authenticated.";

function reasoningSupportFromCli(
  reasoningCli:
    | Pick<AcpBridgeReasoningCli, "supportedLevels" | "defaultLevel">
    | undefined,
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
  const reasoningSupport = reasoningSupportFromCli(nativeReasoning);
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

function resolveHintReasoningValue(args: {
  hint: Pick<AcpBridgeReasoningCli, "supportedLevels" | "levelValues">;
  reasoningLevel: ReasoningLevel;
}): string | undefined {
  const override = args.hint.levelValues?.[args.reasoningLevel];
  if (override !== undefined) {
    return override;
  }
  return args.hint.supportedLevels.includes(args.reasoningLevel)
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
    const value = resolveHintReasoningValue({
      hint: nativeReasoning,
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
      : resolveHintReasoningValue({
          hint: nativeReasoning,
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

let cachedModelCatalog: { key: string; catalog: AgentModelCatalog } | null =
  null;
const SESSION_MODEL_DISCOVERY_TTL_MS = 60_000;
let cachedSessionDiscoveredModels: {
  key: string;
  models: AvailableModel[];
  fetchedAt: number;
} | null = null;

function resolveAcpAuthMethodId(
  authMethods: readonly { id: string }[],
  env: Record<string, string | undefined>,
): string | undefined {
  const methodIds = new Set(authMethods.map((method) => method.id));
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
  capabilities: AcpAgentCapabilities;
}): Promise<void> {
  const methodId = resolveAcpAuthMethodId(
    args.capabilities.authMethods,
    args.env,
  );
  if (methodId === undefined) {
    return;
  }
  try {
    await args.connection.request({
      method: "authenticate",
      params: { methodId, _meta: { headless: true } },
      resultSchema: z.unknown(),
      timeoutMs: ACP_AUTHENTICATE_TIMEOUT_MS,
    });
  } catch (error) {
    throw new AcpAuthRequiredError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function loadAgentModelCatalog(
  listCommand: AcpAgentCommandParam,
): Promise<AgentModelCatalog | null> {
  const stdout = await execPortableFile(listCommand.command, listCommand.args, {
    cwd: listCommand.cwd ?? process.cwd(),
    env: {
      ...withoutBridgeRuntimeEnv(process.env),
      ...(listCommand.envVars ?? {}),
    },
    maxBuffer: 1024 * 1024,
    timeout: MODEL_LIST_TIMEOUT_MS,
  }).then(
    ({ stdout }) => stdout,
    (error: unknown) => {
      if (isMissingExecutableError(error)) throw error;
      const output = z
        .object({ stdout: z.string(), stderr: z.string() })
        .safeParse(error);
      if (
        isAuthRequiredModelListError(
          error,
          output.success ? output.data.stdout : "",
          output.success ? output.data.stderr : "",
        )
      ) {
        throw new AcpModelListAuthRequiredError();
      }
      return null;
    },
  );
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
  agent: AcpAgentCommandParam,
  reasoningProbePriorityModelIds: readonly string[],
  parameterizedModelPicker: boolean,
): Promise<AvailableModel[] | null> {
  const key = JSON.stringify({
    agent,
    reasoningProbePriorityModelIds,
    parameterizedModelPicker,
  });
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
    recordThreadId: null,
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
        const capabilities = await requestAcpInitialize(connection, {
          parameterizedModelPicker,
          fsAccess: false,
        });
        await authenticateAcpAgent({
          connection,
          env: childEnv,
          capabilities,
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
      reasoningProbePriorityModelIds,
    });
    const models = buildModelCatalogFromConfigOptions(
      modelOption,
      reasoningByModel,
    );
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
    await connection.kill();
  }
}

async function discoverAcpNativeReasoningByModel(args: {
  connection: AcpAgentConnection;
  sessionId: string;
  modelOption: AcpConfigOption | undefined;
  reasoningProbePriorityModelIds: readonly string[];
}): Promise<ReadonlyMap<string, AcpNativeReasoningSupport>> {
  const modelOptions = args.modelOption?.options ?? [];
  if (!args.modelOption || modelOptions.length === 0) {
    return new Map();
  }
  const modelOption = args.modelOption;
  const modelByValue = new Map(
    modelOptions.map((model) => [model.value, model] as const),
  );
  const modelsToProbe: typeof modelOptions = [];
  const addedModels = new Set<string>();
  for (const value of args.reasoningProbePriorityModelIds) {
    const model = modelByValue.get(value);
    if (model && !addedModels.has(model.value)) {
      modelsToProbe.push(model);
      addedModels.add(model.value);
    }
  }
  for (const model of modelOptions) {
    if (!addedModels.has(model.value)) {
      modelsToProbe.push(model);
    }
  }

  const supportByModel = new Map<string, AcpNativeReasoningSupport>();
  let timedOut = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutReached = new Promise<
    ReadonlyMap<string, AcpNativeReasoningSupport>
  >((resolve) => {
    timeout = setTimeout(() => {
      timedOut = true;
      args.connection.kill();
      resolve(supportByModel);
    }, ACP_NATIVE_REASONING_DISCOVERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      (async () => {
        for (const model of modelsToProbe) {
          try {
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
          } catch (error) {
            if (timedOut) {
              break;
            }
            process.stderr.write(
              `acp bridge: ACP-native reasoning discovery for model "${model.value}" failed: ${
                error instanceof Error ? error.message : String(error)
              }\n`,
            );
          }
        }
        return supportByModel;
      })(),
      timeoutReached,
    ]);
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

class AcpAuthRequiredError extends BridgeRecoveryError {
  constructor(message: string) {
    super({
      code: -32000,
      message,
      recovery: { kind: "authRequired", message, retryable: false },
    });
    this.name = "AcpAuthRequiredError";
  }
}

class AcpModelListAuthRequiredError extends AcpAuthRequiredError {
  constructor() {
    super(AUTH_REQUIRED_MODEL_LIST_ERROR_MESSAGE);
    this.name = "AcpModelListAuthRequiredError";
  }
}

function isAcpAuthRequiredText(...texts: readonly string[]): boolean {
  const text = texts.join("\n");
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

function isAuthRequiredModelListError(
  error: unknown,
  stdout: string,
  stderr: string,
): boolean {
  return isAcpAuthRequiredText(
    error instanceof Error ? error.message : String(error),
    stdout,
    stderr,
  );
}

const ACP_AUTH_REQUIRED_ERROR_CODE = -32000;
const ACP_AUTH_REQUIRED_ERROR_MESSAGE = "Authentication required";

function isAcpAuthRequiredResponse(error: unknown): boolean {
  return (
    error instanceof AcpAgentResponseError &&
    error.code === ACP_AUTH_REQUIRED_ERROR_CODE &&
    error.message.startsWith(ACP_AUTH_REQUIRED_ERROR_MESSAGE)
  );
}

function withAcpAuthRequiredRecovery(error: unknown): unknown {
  if (error instanceof AcpAuthRequiredError) return error;
  if (
    error instanceof Error &&
    (isAcpAuthRequiredResponse(error) || isAcpAuthRequiredText(error.message))
  ) {
    return new AcpAuthRequiredError(error.message);
  }
  return error;
}

async function resolveAgentLaunchArgs(
  params: AcpSessionParams,
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
    if (
      variantReasoningLevel !== undefined ||
      selection.serviceTier === "fast"
    ) {
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
    const reasoningValue = resolveHintReasoningValue({
      hint: params.reasoningCli,
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
  session: AcpThreadSession;
  sessionId: string;
  modelSelection: AcpSessionParams["modelSelection"];
  nativeReasoning: AcpBridgeNativeReasoning | undefined;
}): Promise<void> {
  const selection = args.modelSelection;
  if (!selection || !("modelId" in selection)) {
    return;
  }
  const { session } = args;
  const { configOptions, models } = session.nativeConfig;
  const modelOption = findAcpModelConfigOption(configOptions);
  const availableSessionModels = models?.availableModels ?? [];
  const sessionModelsIncludeSelection = availableSessionModels.some(
    (model) => model.modelId === selection.modelId,
  );
  const shouldSetModel =
    (modelOption && modelOption.currentValue !== selection.modelId) ||
    (!modelOption &&
      sessionModelsIncludeSelection &&
      models?.currentModelId !== selection.modelId);
  if (shouldSetModel) {
    let configState: AcpConfigStateResult | null = null;
    let setModel = true;
    if (modelOption) {
      try {
        configState = await session.connection.request({
          method: "session/set_config_option",
          params: {
            sessionId: args.sessionId,
            configId: modelOption.id,
            value: selection.modelId,
          },
          resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
          timeoutMs: ACP_SESSION_CONFIG_TIMEOUT_MS,
        });
        setModel = false;
      } catch {
        setModel = true;
      }
    }
    if (setModel) {
      configState = await session.connection.request({
        method: "session/set_model",
        params: { sessionId: args.sessionId, modelId: selection.modelId },
        resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
        timeoutMs: ACP_SESSION_CONFIG_TIMEOUT_MS,
      });
    }
    const current = session.nativeConfig;
    session.nativeConfig = {
      configOptions:
        configState?.configOptions ??
        withAcpConfigValue(
          current.configOptions,
          modelOption?.id,
          selection.modelId,
        ),
      models:
        configState?.models ??
        (current.models && {
          ...current.models,
          currentModelId: selection.modelId,
        }),
    };
  }
  await selectAcpNativeReasoning({
    session,
    sessionId: args.sessionId,
    modelSelection: selection,
    nativeReasoning: args.nativeReasoning,
  });
  await selectAcpNativeServiceTier({
    session,
    sessionId: args.sessionId,
    modelSelection: selection,
  });
}

function withAcpConfigValue(
  configOptions: readonly AcpConfigOption[] | undefined,
  configId: string | undefined,
  value: string,
): readonly AcpConfigOption[] | undefined {
  return configOptions?.map((option) =>
    option.id === configId ? { ...option, currentValue: value } : option,
  );
}

function recordAcpConfigValue(
  session: AcpThreadSession,
  configState: AcpConfigStateResult | null,
  configId: string,
  value: string,
): void {
  session.nativeConfig = {
    ...session.nativeConfig,
    configOptions:
      configState?.configOptions ??
      withAcpConfigValue(session.nativeConfig.configOptions, configId, value),
  };
}

function acpNativeModelDrifted(
  nativeConfig: AcpNativeConfigState,
  modelSelection: AcpSessionParams["modelSelection"],
): boolean {
  if (!modelSelection || !("modelId" in modelSelection)) {
    return false;
  }
  const currentModelId =
    findAcpModelConfigOption(nativeConfig.configOptions)?.currentValue ??
    nativeConfig.models?.currentModelId;
  return (
    currentModelId !== undefined && currentModelId !== modelSelection.modelId
  );
}

async function selectAcpNativeReasoning(args: {
  session: AcpThreadSession;
  sessionId: string;
  modelSelection: Extract<
    AcpSessionParams["modelSelection"],
    { modelId: string }
  >;
  nativeReasoning: AcpBridgeNativeReasoning | undefined;
}): Promise<void> {
  const reasoningLevel = args.modelSelection.reasoningLevel;
  if (reasoningLevel === undefined) {
    return;
  }
  const thoughtLevelOption =
    findAcpThoughtLevelConfigOption(args.session.nativeConfig.configOptions) ??
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
  let configState: AcpConfigStateResult | null;
  try {
    configState = await args.session.connection.request({
      method: "session/set_config_option",
      params: {
        sessionId: args.sessionId,
        configId: thoughtLevelOption.id,
        value,
      },
      resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
      timeoutMs: ACP_SESSION_CONFIG_TIMEOUT_MS,
    });
  } catch {
    return;
  }
  recordAcpConfigValue(args.session, configState, thoughtLevelOption.id, value);
}

async function selectAcpNativeServiceTier(args: {
  session: AcpThreadSession;
  sessionId: string;
  modelSelection: Extract<
    AcpSessionParams["modelSelection"],
    { modelId: string }
  >;
}): Promise<void> {
  const serviceTier = args.modelSelection.serviceTier;
  if (serviceTier === undefined) {
    return;
  }
  const fastOption = (args.session.nativeConfig.configOptions ?? []).find(
    (option) => option.id === "fast" && option.type === "select",
  );
  const value = serviceTier === "fast" ? "true" : "false";
  if (!fastOption?.options?.some((option) => option.value === value)) {
    return;
  }
  const configState = await args.session.connection.request({
    method: "session/set_config_option",
    params: {
      sessionId: args.sessionId,
      configId: fastOption.id,
      value,
    },
    resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
    timeoutMs: ACP_SESSION_CONFIG_TIMEOUT_MS,
  });
  recordAcpConfigValue(args.session, configState, fastOption.id, value);
}

function textWithoutUnknownLeadingSkillCommand(
  session: AcpThreadSession,
  item: Extract<PromptInput, { type: "text" }>,
): string {
  const advertised = session.model.snapshot().commands;
  if (advertised.length === 0) {
    return item.text;
  }
  const firstCharacter = item.text.search(/\S/u);
  const leading = item.mentions.find(
    (mention) =>
      mention.start === firstCharacter &&
      mention.resource.kind === "command" &&
      mention.resource.source === "skill" &&
      mention.resource.trigger === "/",
  );
  if (!leading || leading.resource.kind !== "command") {
    return item.text;
  }
  const name = leading.resource.name;
  if (advertised.some((command) => command.name === name)) {
    return item.text;
  }
  return `${item.text.slice(0, leading.start)}Use the bb skill "${name}":${item.text.slice(leading.end)}`;
}

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

  for (const [index, item] of input.entries()) {
    switch (item.type) {
      case "text":
        blocks.push({
          type: "text",
          text:
            index === 0
              ? textWithoutUnknownLeadingSkillCommand(session, item)
              : item.text,
        });
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
  for (const responder of session.pendingElicitations) {
    responder.result({ action: "cancel" });
  }
  session.pendingElicitations.clear();
}

function handleElicitationRequest(
  session: AcpThreadSession,
  params: unknown,
  responder: AcpAgentRequestResponder,
): void {
  if (
    session.stopping ||
    session.cancelRequested ||
    session.activePromptKind === "compaction"
  ) {
    responder.result({ action: "cancel" });
    return;
  }
  const plan = planAcpElicitation(params);
  if (plan.kind === "unsupported") {
    emitForSession(session, ACP_WARNING_METHOD, {
      threadId: session.bbThreadId,
      summary: "The agent asked a question bb could not show",
      details: `The request was declined because ${plan.reason}.`,
    });
    responder.result({ action: "decline" });
    return;
  }
  if (session.activePromptKind === null) {
    openAgentTurn(session);
  }
  session.pendingElicitations.add(responder);
  void sendRuntimeRequest(BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest, {
    providerThreadId: session.providerThreadId,
    threadId: session.bbThreadId,
    turnId: null,
    payload: plan.payload,
  })
    .then((result) => {
      if (!session.pendingElicitations.delete(responder)) {
        return;
      }
      const resolution =
        userQuestionPendingInteractionResolutionSchema.safeParse(result);
      responder.result(
        resolution.success
          ? plan.toResponse(resolution.data)
          : { action: "cancel" },
      );
    })
    .catch(() => {
      if (!session.pendingElicitations.delete(responder)) {
        return;
      }
      responder.result({ action: "cancel" });
    });
}

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
    session.activePromptKind === "compaction"
  ) {
    responder.result({ outcome: { outcome: "cancelled" } });
    return;
  }

  const toolCall = parsed.data.toolCall;
  const bound =
    toolCall?.toolCallId !== undefined
      ? session.translator.notePermissionToolCall(session.bbThreadId, {
          toolCallId: toolCall.toolCallId,
          ...(toolCall.title !== undefined ? { title: toolCall.title } : {}),
          ...(toolCall.kind !== undefined ? { kind: toolCall.kind } : {}),
          ...(toolCall.rawKind !== undefined
            ? { rawKind: toolCall.rawKind }
            : {}),
          ...(toolCall.locations !== undefined
            ? { locations: toolCall.locations }
            : {}),
          ...(toolCall.rawInput !== undefined
            ? { rawInput: toolCall.rawInput }
            : {}),
          ...(toolCall.rawOutput !== undefined
            ? { rawOutput: toolCall.rawOutput }
            : {}),
        })
      : undefined;
  const pending: PendingAcpPermission = {
    responder,
    options: parsed.data.options,
  };

  if (session.policy.permissionMode === "full") {
    respondPermission(pending, "allow_once");
    return;
  }

  if (session.activePromptKind === null) {
    openAgentTurn(session);
  }
  session.pendingPermissions.add(pending);

  const normalizedToolCall =
    toolCall?.toolCallId !== undefined && bound !== undefined
      ? {
          toolCallId: bound.toolCallId,
          ...(toolCall.title !== undefined ? { title: toolCall.title } : {}),
          ...(toolCall.kind !== undefined ? { kind: toolCall.kind } : {}),
          ...(toolCall.rawKind !== undefined
            ? { rawKind: toolCall.rawKind }
            : {}),
          ...(toolCall.content !== undefined
            ? { content: toolCall.content }
            : {}),
          ...(toolCall.rawInput !== undefined
            ? { rawInput: toolCall.rawInput }
            : {}),
          ...(toolCall.locations !== undefined
            ? { locations: toolCall.locations }
            : {}),
          startedToolCall: bound.event,
          injectedTool: session.translator.getInjectedToolBinding(
            session.bbThreadId,
            bound.toolCallId,
          ),
        }
      : undefined;

  const payload = buildAcpPermissionInteractionPayload({
    toolCall: normalizedToolCall,
    options: parsed.data.options,
    cwd: session.cwd,
    classifyToolCall: session.dialect.classifyToolCall,
  });
  void sendRuntimeRequest(BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest, {
    providerThreadId: session.providerThreadId,
    threadId: session.bbThreadId,
    turnId: null,
    payload,
  })
    .then((result) => {
      if (!session.pendingPermissions.delete(pending)) {
        return;
      }
      const resolution = pendingInteractionResolutionSchema.safeParse(result);
      const response = resolution.success
        ? resolveAcpPermissionDecision({
            payload,
            resolution: resolution.data,
          })
        : null;
      respondPermission(pending, response?.decision ?? null);
    })
    .catch(() => {
      if (!session.pendingPermissions.delete(pending)) {
        return;
      }
      respondPermission(pending, null);
    });
}

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

    emitForSession(session, ACP_FS_WRITE_METHOD, {
      threadId: session.bbThreadId,
      path: parsed.data.path,
      kind: oldText === undefined ? "add" : "update",
      ...(oldText === undefined ? {} : { oldText }),
      content: parsed.data.content,
    });
    responder.result({});
  } catch (error) {
    responder.error(
      -32603,
      error instanceof Error ? error.message : String(error),
    );
  }
}

function liveSessionForThread(
  bbThreadId: string,
): AcpThreadSession | undefined {
  const session = sessionsByBbThreadId.get(bbThreadId);
  if (!session || session.stopping || session.providerThreadId === "") {
    return undefined;
  }
  return session;
}

function removeSession(session: AcpThreadSession): void {
  for (const controller of session.pendingToolCalls) controller.abort();
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

async function releaseCursorMcpApproval(
  session: AcpThreadSession,
): Promise<void> {
  const approval = session.cursorMcpApproval;
  session.cursorMcpApproval = undefined;
  if (!approval) {
    return;
  }
  try {
    await revokeCursorSessionMcpServer(approval);
  } catch (error) {
    process.stderr.write(
      `acp bridge: failed to remove Cursor session MCP approval for thread "${session.bbThreadId}": ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
}

function getSessionByProviderThreadId(
  providerThreadId: string,
): AcpThreadSession | undefined {
  const bbThreadId = bbThreadIdByProviderThreadId.get(providerThreadId);
  return bbThreadId ? sessionsByBbThreadId.get(bbThreadId) : undefined;
}

type AcpSessionStartRequest =
  | { kind: "start"; params: AcpSessionParams }
  | {
      kind: "resume";
      params: AcpSessionParams;
      resumeProviderThreadId: string;
    }
  | {
      kind: "fork";
      params: AcpSessionParams;
      sourceProviderThreadId: string;
    };

async function startAgentSession(
  request: AcpSessionStartRequest,
): Promise<AcpThreadSession> {
  const params = request.params;
  const bbThreadId = params.threadId;

  const existing = sessionsByBbThreadId.get(bbThreadId);
  if (existing) {
    await stopSession(existing);
  }

  const dialect = resolveAcpDialect({
    ...(params.dialectId === undefined ? {} : { dialectId: params.dialectId }),
    command: params.agent.command,
  });
  const translator = createAcpDeltaTranslator({
    cwd: params.cwd,
    dialect,
  });
  translator.configureInjectedTools(
    (params.dynamicTools ?? []).map((tool) => ({
      name: tool.name,
      ...(tool.presentation === undefined
        ? {}
        : { presentation: tool.presentation }),
    })),
  );
  const deferredEmits: {
    method: string;
    params: Record<string, unknown>;
    sessionId: string | undefined;
    rawUpdate: unknown;
  }[] = [];
  const emitStartNotification: AcpDeferredStartEmitter = (
    method,
    notificationParams,
    sessionId,
    rawUpdate,
  ) => {
    deferredEmits.push({
      method,
      params: notificationParams,
      sessionId,
      rawUpdate,
    });
  };

  const launch = await resolveAgentLaunchArgs(params);
  if (launch.warning) {
    emitStartNotification(ACP_WARNING_METHOD, {
      threadId: bbThreadId,
      summary: launch.warning,
    });
  }
  const agentLabel = [params.agent.command, ...params.agent.args].join(" ");
  let session: AcpThreadSession;
  const childEnv = {
    ...withoutBridgeRuntimeEnv(process.env),
    ...params.envVars,
    ...(dialect.id === "opencode"
      ? { OPENCODE_CLIENT: "acp", OPENCODE_ENABLE_QUESTION_TOOL: "false" }
      : {}),
  };
  const connection = createAcpAgentConnection({
    command: params.agent.command,
    args: launch.args,
    cwd: params.cwd,
    env: childEnv,
    recordThreadId: bbThreadId,
    requestMethods: [
      ...ACP_CORE_CLIENT_REQUEST_METHODS,
      ...(dialect.clientRequestMethods ?? []),
    ],
    onResponse: (method, result) => noteAgentResponse(session, method, result),
    onNotification: (method, notificationParams) =>
      handleAgentNotification(session, method, notificationParams),
    onRequest: (method, requestParams, responder) =>
      handleAgentRequest(session, method, requestParams, responder),
    onExit: (info) => {
      const wasCurrent = sessionsByBbThreadId.get(bbThreadId) === session;
      cancelPendingPermissions(session);
      if (!wasCurrent || session.stopping || session.providerThreadId === "") {
        removeSession(session);
        return;
      }
      void releaseCursorMcpApproval(session);
      emitSessionError(
        session,
        `ACP agent "${agentLabel}" exited unexpectedly` +
          `${info.code !== null ? ` (code ${info.code})` : ""}` +
          `${info.stderrTail ? `: ${info.stderrTail}` : ""}`,
      );
      setActivePromptKind(session, null);
    },
  });
  session = {
    bbThreadId,
    construction: params,
    nativeConfig: { configOptions: undefined, models: undefined },
    providerThreadId: "",
    cwd: params.cwd,
    dialect,
    translator,
    connection,
    model: createAcpSessionModel({ generation: 1 }),
    promptWorkOpen: false,
    agentTurnQuietTimer: undefined,
    agentUpdateCount: 0,
    publishedThreadState: new Map(),
    capabilities: undefined,
    supportsImageInput: false,
    supportsLoadSession: false,
    policy: {
      permissionMode: params.permissionMode,
      workspaceWriteRoots: params.workspaceWriteRoots,
    },
    pendingInstructions: params.instructions,
    activePromptKind: null,
    compactionAgentMessage: "",
    queuedInputs: [],
    promptRequestPending: false,
    cancelRequested: false,
    restartAfterCancelError: false,
    loading: false,
    loadingSessionId: undefined,
    pendingLoadUsageUpdate: undefined,
    grokContextWindowSize: undefined,
    stopping: false,
    turnSettled: undefined,
    pendingPermissions: new Set(),
    pendingElicitations: new Set(),
    pendingToolCalls: new Set(),
    cursorMcpApproval: undefined,
    deferStartEmit: emitStartNotification,
  };
  sessionsByBbThreadId.set(bbThreadId, session);

  try {
    const capabilities = await requestAcpInitialize(connection, {
      parameterizedModelPicker: params.parameterizedModelPicker,
      fsAccess: true,
      elicitation: true,
    });
    session.capabilities = capabilities;
    await authenticateAcpAgent({
      connection,
      env: childEnv,
      capabilities,
    });
    session.supportsImageInput = capabilities.prompt.image;
    const supportsLoadSession = capabilities.session.load;
    const supportsFork = capabilities.session.fork;
    if (request.kind === "fork" && !supportsFork) {
      throw new Error(
        `ACP agent "${agentLabel}" does not advertise session/fork support.`,
      );
    }
    session.supportsLoadSession =
      supportsLoadSession || capabilities.session.resume;
    const mcpServers = await buildSessionMcpServers(params);
    const mcpServer = mcpServers[0];
    if (mcpServer) {
      session.cursorMcpApproval = await approveCursorSessionMcpServer({
        agentCommand: params.agent.command,
        config: mcpServer,
        cwd: params.cwd,
        env: childEnv,
      });
      if (session.cursorMcpApproval?.installedByBb) {
        process.stderr.write(
          `acp bridge: installed Cursor session MCP approval for thread "${bbThreadId}"\n`,
        );
      }
    }

    let sessionId: string | undefined;
    let loadedConfigOptions: readonly AcpConfigOption[] | undefined;
    let loadedModels: AcpSessionModels | undefined;
    let createdFreshSession = false;
    if (request.kind === "fork") {
      const forkedSession = await connection.request({
        method: "session/fork",
        params: {
          sessionId: request.sourceProviderThreadId,
          cwd: params.cwd,
          mcpServers,
        },
        resultSchema: acpSessionForkResultSchema,
        timeoutMs: ACP_SESSION_SETUP_TIMEOUT_MS,
      });
      if (
        forkedSession.sessionId === request.sourceProviderThreadId ||
        getSessionByProviderThreadId(forkedSession.sessionId) !== undefined
      ) {
        throw new Error(
          `ACP agent "${agentLabel}" returned an active session ID for session/fork.`,
        );
      }
      sessionId = forkedSession.sessionId;
      loadedConfigOptions = forkedSession.configOptions;
      loadedModels = forkedSession.models;
      rememberGrokContextWindow(session, forkedSession.models);
    } else if (
      request.kind === "resume" &&
      (capabilities.session.resume || supportsLoadSession)
    ) {
      const restoreMethod = capabilities.session.resume
        ? "session/resume"
        : "session/load";
      session.loading = true;
      session.loadingSessionId = request.resumeProviderThreadId;
      session.pendingLoadUsageUpdate = undefined;
      session.model.beginReplay();
      try {
        const configState = await connection.request({
          method: restoreMethod,
          params: {
            sessionId: request.resumeProviderThreadId,
            cwd: params.cwd,
            mcpServers,
          },
          resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
          timeoutMs: ACP_SESSION_SETUP_TIMEOUT_MS,
        });
        loadedConfigOptions = configState?.configOptions;
        loadedModels = configState?.models;
        rememberGrokContextWindow(session, configState?.models);
        sessionId = request.resumeProviderThreadId;
      } catch (error) {
        if (isAcpAuthRequiredResponse(error)) {
          throw error;
        }
        sessionId = undefined;
        session.loading = false;
        session.loadingSessionId = undefined;
        session.pendingLoadUsageUpdate = undefined;
      } finally {
        session.model.endReplay();
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
        timeoutMs: ACP_SESSION_SETUP_TIMEOUT_MS,
      });
      sessionId = newSession.sessionId;
      createdFreshSession = true;
      rememberGrokContextWindow(session, newSession.models);
      session.nativeConfig = {
        configOptions: newSession.configOptions,
        models: newSession.models,
      };
      await selectAcpNativeModel({
        session,
        sessionId,
        modelSelection: params.modelSelection,
        nativeReasoning: params.nativeReasoning,
      });
      if (request.kind === "resume") {
        emitStartNotification(ACP_WARNING_METHOD, {
          threadId: bbThreadId,
          summary: `${agentLabel} could not restore the previous session; continuing in a fresh session without in-agent history.`,
        });
      }
    } else {
      session.nativeConfig = {
        configOptions: loadedConfigOptions,
        models: loadedModels,
      };
      session.pendingInstructions = undefined;
      await selectAcpNativeModel({
        session,
        sessionId,
        modelSelection: params.modelSelection,
        nativeReasoning: params.nativeReasoning,
      });
      const loadUsageUpdate = session.pendingLoadUsageUpdate;
      session.loading = false;
      session.loadingSessionId = undefined;
      session.pendingLoadUsageUpdate = undefined;
      if (loadUsageUpdate) {
        emitStartNotification(ACP_UPDATE_METHOD, {
          threadId: session.bbThreadId,
          update: loadUsageUpdate,
        });
      }
    }

    if (session.stopping) {
      throw new Error(
        `ACP session for thread "${bbThreadId}" was released during construction`,
      );
    }
    session.providerThreadId = sessionId;
    bbThreadIdByProviderThreadId.set(sessionId, bbThreadId);
    sendNotification(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
      threadId: bbThreadId,
      providerThreadId: sessionId,
      sessionRestorable: session.supportsLoadSession,
    });
    sendThreadDeltas(bbThreadId, [{ kind: "session.reset" }]);
    publishSessionSnapshot(session);
    if (createdFreshSession) {
      emitGrokContextWindow(session, 0);
    }
    session.deferStartEmit = undefined;
    for (const deferred of deferredEmits) {
      if (
        deferred.sessionId !== undefined &&
        deferred.sessionId !== sessionId
      ) {
        continue;
      }
      if (deferred.method === ACP_UPDATE_METHOD) {
        emitSessionUpdate(
          session,
          deferred.params["update"],
          deferred.rawUpdate ?? deferred.params["update"],
        );
      } else {
        emitForSession(session, deferred.method, deferred.params);
      }
    }
    deferredEmits.length = 0;
    return session;
  } catch (error) {
    session.stopping = true;
    session.deferStartEmit = undefined;
    await connection.kill();
    removeSession(session);
    await releaseCursorMcpApproval(session);
    const typed = withAcpAuthRequiredRecovery(error);
    const guidance =
      typed instanceof AcpAuthRequiredError && session.capabilities
        ? describeAcpSignIn({
            command: params.agent.command,
            args: params.agent.args,
            authMethods: session.capabilities.authMethods,
          })
        : null;
    if (typed instanceof AcpAuthRequiredError && guidance !== null) {
      throw new AcpAuthRequiredError(`${typed.message} ${guidance}`);
    }
    throw error;
  }
}

async function stopSession(session: AcpThreadSession): Promise<void> {
  if (session.stopping) {
    return;
  }
  session.stopping = true;
  dropQueuedTurnInputs(
    session,
    "ACP session stopped before the steer was sent",
  );
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
  settleInterruptedPrompt(session);

  await session.connection.kill();
  removeSession(session);
  await releaseCursorMcpApproval(session);
}

function settleInterruptedPrompt(session: AcpThreadSession): void {
  switch (session.activePromptKind) {
    case "turn":
      finishTurn(session, "cancelled");
      return;
    case "agent":
      finishAgentTurn(session, "cancelled");
      return;
    case "compaction":
      finishCompaction(session, { status: "interrupted" });
      return;
    case null:
      return;
  }
}

function setActivePromptKind(
  session: AcpThreadSession,
  kind: AcpThreadSession["activePromptKind"],
): void {
  session.activePromptKind = kind;
  if (kind === "turn" || kind === "compaction") {
    clearAgentTurnQuietTimer(session);
    if (!session.promptWorkOpen) {
      session.promptWorkOpen = true;
      session.model.promptSubmitted();
    }
    return;
  }
  if (kind === null) {
    clearAgentTurnQuietTimer(session);
    if (session.promptWorkOpen) {
      session.promptWorkOpen = false;
      session.model.promptSettled({ stopReason: "end_turn" });
    }
    session.model.agentWorkSettled("end_turn");
    session.model.closeUnfinishedToolCalls("cancelled");
  }
}

function clearAgentTurnQuietTimer(session: AcpThreadSession): void {
  if (session.agentTurnQuietTimer !== undefined) {
    clearTimeout(session.agentTurnQuietTimer);
    session.agentTurnQuietTimer = undefined;
  }
}

function agentTurnHasOpenWork(session: AcpThreadSession): boolean {
  return (
    session.pendingPermissions.size > 0 ||
    session.pendingElicitations.size > 0 ||
    session.model.hasUnfinishedToolCalls()
  );
}

function armAgentTurnQuietTimer(session: AcpThreadSession): void {
  clearAgentTurnQuietTimer(session);
  const timer = setTimeout(() => {
    if (session.agentTurnQuietTimer !== timer) {
      return;
    }
    session.agentTurnQuietTimer = undefined;
    if (session.activePromptKind !== "agent" || session.stopping) {
      return;
    }
    if (agentTurnHasOpenWork(session)) {
      armAgentTurnQuietTimer(session);
      return;
    }
    finishAgentTurn(session, "end_turn");
  }, AGENT_TURN_QUIET_MS);
  timer.unref?.();
  session.agentTurnQuietTimer = timer;
}

function openAgentTurn(session: AcpThreadSession): void {
  setActivePromptKind(session, "agent");
  emitForSession(session, ACP_TURN_STARTED_METHOD, {
    threadId: session.bbThreadId,
  });
  armAgentTurnQuietTimer(session);
}

function finishAgentTurn(
  session: AcpThreadSession,
  stopReason: "end_turn" | "cancelled",
): void {
  if (session.activePromptKind !== "agent") {
    return;
  }
  for (const controller of session.pendingToolCalls) controller.abort();
  setActivePromptKind(session, null);
  emitForSession(session, ACP_TURN_COMPLETED_METHOD, {
    threadId: session.bbThreadId,
    stopReason,
  });
}

function startsAgentWork(events: readonly AcpSessionEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "work" &&
      event.work.state !== "idle" &&
      event.work.initiator === "agent",
  );
}

function publishThreadState(
  session: AcpThreadSession,
  kind: ExtensionKind,
  payload: JsonValue,
  isEmpty: boolean,
): void {
  if (session.providerThreadId === "" || session.stopping) {
    return;
  }
  const serialized = JSON.stringify(payload);
  const published = session.publishedThreadState.get(kind);
  if (published === serialized || (published === undefined && isEmpty)) {
    return;
  }
  session.publishedThreadState.set(kind, serialized);
  sendThreadDeltas(session.bbThreadId, [
    { kind: "extension.state", extensionKind: kind, payload },
  ]);
}

async function applySessionOptionSelections(
  session: AcpThreadSession,
  selections: SessionOptionSelections,
): Promise<void> {
  for (const [optionId, value] of Object.entries(selections)) {
    const option = session.model
      .snapshot()
      .configOptions.find((candidate) => candidate.id === optionId);
    if (
      option === undefined ||
      !isUserSelectableSessionOption(option) ||
      option.currentValue === value
    ) {
      continue;
    }
    const offered =
      option.type === "boolean"
        ? typeof value === "boolean"
        : typeof value === "string" &&
          option.values.some((candidate) => candidate.value === value);
    if (!offered) {
      continue;
    }
    let result: unknown;
    try {
      if (option.setMethod === "session/set_mode") {
        await session.connection.request({
          method: "session/set_mode",
          params: { sessionId: session.providerThreadId, modeId: value },
          resultSchema: z.unknown(),
          timeoutMs: ACP_SESSION_CONFIG_TIMEOUT_MS,
        });
      } else {
        result = await session.connection.request({
          method: "session/set_config_option",
          params: {
            sessionId: session.providerThreadId,
            configId: option.id,
            ...(option.type === "boolean" ? { type: "boolean" } : {}),
            value,
          },
          resultSchema: z.unknown(),
          timeoutMs: ACP_SESSION_CONFIG_TIMEOUT_MS,
        });
      }
    } catch (error) {
      emitForSession(session, ACP_WARNING_METHOD, {
        threadId: session.bbThreadId,
        summary: `The agent did not apply ${option.name.trim() === "" ? option.id : option.name}`,
        details: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!isJsonObject(result) || !("configOptions" in result)) {
      publishSessionStateEvents(
        session,
        session.model.applyConfigOptionValue(optionId, value),
      );
    }
  }
}

function publishSessionSnapshot(session: AcpThreadSession): void {
  const snapshot = session.model.snapshot();
  const commands = toThreadProviderCommandsState(snapshot.commands);
  publishThreadState(
    session,
    THREAD_PROVIDER_COMMANDS_STATE_KIND,
    commands,
    commands.commands.length === 0,
  );
  const options = toThreadSessionOptionsState(snapshot.configOptions);
  publishThreadState(
    session,
    THREAD_SESSION_OPTIONS_STATE_KIND,
    options,
    options.options.length === 0,
  );
}

function publishSessionStateEvents(
  session: AcpThreadSession,
  events: readonly AcpSessionEvent[],
): void {
  if (
    events.some(
      (event) => event.type === "commands" || event.type === "configOptions",
    )
  ) {
    publishSessionSnapshot(session);
  }
}

function noteAgentResponse(
  session: AcpThreadSession,
  method: string,
  result: unknown,
): void {
  if (!isJsonObject(result)) {
    return;
  }
  switch (method) {
    case "session/new":
    case "session/load":
    case "session/resume":
    case "session/fork":
      publishSessionStateEvents(
        session,
        session.model.applySessionSetup(result),
      );
      return;
    case "session/set_config_option":
    case "session/set_model":
      if ("configOptions" in result) {
        publishSessionStateEvents(
          session,
          session.model.applyConfigOptions(result["configOptions"]),
        );
      }
      return;
  }
}

function emitSessionUpdate(
  session: AcpThreadSession,
  update: unknown,
  rawUpdate: unknown,
): void {
  const events = session.model.applySessionUpdate(rawUpdate);
  publishSessionStateEvents(session, events);
  session.agentUpdateCount += 1;
  if (session.activePromptKind === null && startsAgentWork(events)) {
    openAgentTurn(session);
  } else if (session.activePromptKind === "agent") {
    armAgentTurnQuietTimer(session);
  }
  emitForSession(session, ACP_UPDATE_METHOD, {
    threadId: session.bbThreadId,
    update,
  });
}

async function releaseSession(session: AcpThreadSession): Promise<void> {
  if (session.stopping) {
    return;
  }
  session.stopping = true;
  clearAgentTurnQuietTimer(session);
  dropQueuedTurnInputs(
    session,
    "ACP session released before the steer was sent",
  );
  cancelPendingPermissions(session);
  await session.connection.kill();
  removeSession(session);
  await releaseCursorMcpApproval(session);
}

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

function acceptTurnInput(
  session: AcpThreadSession,
  pending: AcpPendingTurnInput,
): void {
  sendThreadDeltas(session.bbThreadId, [
    { kind: "input.accepted", clientRequestId: pending.clientRequestId },
  ]);
  const requestId = takeTurnInputRequestId(pending);
  if (requestId !== null) {
    sendResult(requestId, { threadId: session.bbThreadId });
  }
}

function dropTurnInput(pending: AcpPendingTurnInput, reason: string): void {
  const requestId = takeTurnInputRequestId(pending);
  if (requestId !== null) {
    sendError(requestId, -32000, reason);
  }
}

function takeTurnInputRequestId(
  pending: AcpPendingTurnInput,
): AcpBridgeRequestId | null {
  const requestId = pending.requestId;
  pending.requestId = null;
  return requestId;
}

function dropQueuedTurnInputs(session: AcpThreadSession, reason: string): void {
  for (const pending of session.queuedInputs.splice(0)) {
    dropTurnInput(pending, reason);
  }
}

function finishTurn(
  session: AcpThreadSession,
  stopReason: z.infer<typeof acpStopReasonSchema>,
): void {
  if (session.activePromptKind !== "turn") {
    return;
  }
  for (const controller of session.pendingToolCalls) controller.abort();
  setActivePromptKind(session, null);
  dropQueuedTurnInputs(session, "ACP turn ended before the steer was sent");
  session.promptRequestPending = false;
  session.cancelRequested = false;
  emitForSession(session, ACP_TURN_COMPLETED_METHOD, {
    threadId: session.bbThreadId,
    stopReason,
  });
}

function isSessionBusyError(error: unknown): boolean {
  return (
    error instanceof AcpAgentResponseError &&
    error.code === ACP_SESSION_BUSY_ERROR_CODE &&
    isJsonObject(error.data) &&
    error.data["reason"] === "session_busy"
  );
}

async function waitForAgentQuiet(session: AcpThreadSession): Promise<boolean> {
  for (let waits = 0; waits < SESSION_BUSY_MAX_WAITS; waits += 1) {
    const updatesBefore = session.agentUpdateCount;
    await new Promise<void>((resolveWait) => {
      setTimeout(resolveWait, SESSION_BUSY_QUIET_MS);
    });
    if (
      session.stopping ||
      session.connection.exited ||
      session.cancelRequested
    ) {
      return false;
    }
    if (
      session.agentUpdateCount === updatesBefore &&
      !session.model.hasUnfinishedToolCalls()
    ) {
      return true;
    }
  }
  return false;
}

function runTurn(
  session: AcpThreadSession,
  firstInput: AcpPendingTurnInput,
  turnAlreadyOpen = false,
): void {
  setActivePromptKind(session, "turn");
  if (!turnAlreadyOpen) {
    emitForSession(session, ACP_TURN_STARTED_METHOD, {
      threadId: session.bbThreadId,
    });
  }

  session.turnSettled = (async () => {
    let pending = firstInput;
    for (;;) {
      if (session.stopping) {
        dropTurnInput(pending, "ACP session is stopping");
        finishTurn(session, "cancelled");
        return;
      }

      let stopReason: z.infer<typeof acpStopReasonSchema>;
      session.cancelRequested = false;
      try {
        const previousSession = session;
        const reconciled = reconcileExecutionSettings(session, pending.options);
        session = reconciled instanceof Promise ? await reconciled : reconciled;
        if (session.stopping) {
          dropTurnInput(pending, "ACP session is stopping");
          finishTurn(session, "cancelled");
          return;
        }
        setActivePromptKind(session, "turn");
        session.turnSettled = previousSession.turnSettled;
        if (session !== previousSession) {
          emitForSession(session, ACP_TURN_STARTED_METHOD, {
            threadId: session.bbThreadId,
          });
        }
        const prompt = buildPromptContentBlocks(session, pending.input);
        let inputAccepted = false;
        let busyRetries = 0;
        for (;;) {
          session.promptRequestPending = true;
          const promptResult = session.connection.request({
            method: "session/prompt",
            params: { sessionId: session.providerThreadId, prompt },
            resultSchema: acpPromptResultSchema,
          });
          if (!inputAccepted) {
            inputAccepted = true;
            acceptTurnInput(session, pending);
          }
          if (session.queuedInputs.length > 0) {
            requestSteerCancel(session);
          }
          try {
            const result = await promptResult;
            stopReason = result.stopReason;
            const grokUsage = grokContextUsageFromPromptResult(result);
            if (grokUsage !== undefined) {
              emitGrokContextWindow(session, grokUsage.used);
            }
            break;
          } catch (error) {
            if (
              !isSessionBusyError(error) ||
              busyRetries >= SESSION_BUSY_MAX_RETRIES ||
              session.stopping ||
              session.cancelRequested
            ) {
              throw error;
            }
            busyRetries += 1;
            session.promptRequestPending = false;
            if (!(await waitForAgentQuiet(session))) {
              throw error;
            }
          }
        }
      } catch (error) {
        session.restartAfterCancelError = session.cancelRequested;
        session.promptRequestPending = false;
        dropTurnInput(pending, "ACP turn failed before the prompt was sent");
        dropQueuedTurnInputs(
          session,
          "ACP turn failed before the steer was sent",
        );
        session.cancelRequested = false;
        if (!session.stopping) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (!session.connection.exited) {
            emitSessionError(session, message);
          } else if (session.activePromptKind === "turn") {
            emitForSession(session, "error", {
              threadId: session.bbThreadId,
              message,
            });
          }
        }
        setActivePromptKind(session, null);
        return;
      }
      session.promptRequestPending = false;

      if (!session.stopping) {
        const next = session.queuedInputs.shift();
        if (next) {
          pending = next;
          continue;
        }
      }

      finishTurn(session, stopReason);
      return;
    }
  })();
}

function reconcileExecutionSettings(
  session: AcpThreadSession,
  options: BridgeExecutionOptions,
): AcpThreadSession | Promise<AcpThreadSession> {
  if (options.permissionMode === "auto") {
    throw new Error('ACP does not support permission mode "auto".');
  }
  const launchSpec = decodeLaunchSpec(options.providerOptions);
  const envVars =
    Object.keys(options.envVars ?? {}).length > 0
      ? {
          ...(launchSpec?.env ?? {}),
          ...options.envVars,
        }
      : session.construction.envVars;
  const workspaceWriteRoots =
    options.providerOptions?.additionalWorkspaceWriteRoots !== undefined
      ? [
          session.cwd,
          ...decodeAdditionalWorkspaceWriteRoots(options.providerOptions),
        ]
      : session.policy.workspaceWriteRoots;
  const modelParams =
    launchSpec === null
      ? session.construction
      : buildAcpModelSelectionParams(
          launchSpec,
          options,
          decodeAcpModelPickerOptions(options.providerOptions)
            .parameterizedModelPicker,
          decodeDialectId(options.providerOptions),
        );
  const construction: AcpSessionParams = {
    ...session.construction,
    modelSelection: modelParams.modelSelection,
    launchReasoningLevel: modelParams.launchReasoningLevel,
    envVars,
    permissionMode: options.permissionMode,
    workspaceWriteRoots,
  };
  const launchArgsChanged =
    !isDeepStrictEqual(
      permissionCliArgsForMode(
        session.construction.permissionCli,
        session.construction.permissionMode,
      ),
      permissionCliArgsForMode(
        construction.permissionCli,
        construction.permissionMode,
      ),
    ) ||
    !isDeepStrictEqual(
      launchModelSelection(session.construction),
      launchModelSelection(construction),
    );
  const restart =
    session.connection.exited ||
    session.restartAfterCancelError ||
    launchArgsChanged ||
    !isDeepStrictEqual(envVars ?? {}, session.construction.envVars ?? {});
  cancelPendingPermissions(session);
  session.policy = {
    permissionMode: options.permissionMode,
    workspaceWriteRoots,
  };
  if (restart) {
    return rebuildAgentSession(session, construction);
  }
  if (
    isDeepStrictEqual(
      construction.modelSelection,
      session.construction.modelSelection,
    ) &&
    !acpNativeModelDrifted(session.nativeConfig, construction.modelSelection)
  ) {
    session.construction = construction;
    return session;
  }
  return applyNativeModelSelection(session, construction);
}

function launchModelSelection(params: AcpSessionParams): {
  modelSelection: AcpSessionParams["modelSelection"];
  launchReasoningLevel: AcpSessionParams["launchReasoningLevel"];
} {
  return {
    modelSelection:
      params.modelSelection && "selectFlag" in params.modelSelection
        ? params.modelSelection
        : undefined,
    launchReasoningLevel: params.launchReasoningLevel,
  };
}

async function applyNativeModelSelection(
  session: AcpThreadSession,
  construction: AcpSessionParams,
): Promise<AcpThreadSession> {
  await selectAcpNativeModel({
    session,
    sessionId: session.providerThreadId,
    modelSelection: construction.modelSelection,
    nativeReasoning: construction.nativeReasoning,
  });
  session.construction = construction;
  return session;
}

async function rebuildAgentSession(
  session: AcpThreadSession,
  construction: AcpSessionParams,
): Promise<AcpThreadSession> {
  const previousProviderThreadId = session.providerThreadId;
  const reason = session.connection.exited
    ? "The ACP agent exited unexpectedly; its session was rebuilt before continuing."
    : session.restartAfterCancelError
      ? "The ACP agent failed during cancellation; its session was rebuilt before continuing."
      : "Execution settings changed; the ACP session was rebuilt to apply them.";
  const queuedInputs = session.queuedInputs.splice(0);
  const continuingTurn = session.activePromptKind === "turn";
  finishTurn(session, "cancelled");
  let replacement: AcpThreadSession;
  try {
    replacement = await startAgentSession({
      kind: "resume",
      params: construction,
      resumeProviderThreadId: previousProviderThreadId,
    });
  } catch (error) {
    if (continuingTurn) {
      emitSessionError(
        session,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  }
  replacement.queuedInputs.push(...queuedInputs);
  sendNotification(BRIDGE_NOTIFICATION_METHODS.sessionReplaced, {
    threadId: session.bbThreadId,
    providerThreadId: replacement.providerThreadId,
    reason,
    contextLost: replacement.providerThreadId !== previousProviderThreadId,
  });
  return replacement;
}

function startCompaction(
  session: AcpThreadSession,
  pending: AcpPendingTurnInput,
): void {
  setActivePromptKind(session, "compaction");
  session.compactionAgentMessage = "";
  emitForSession(session, ACP_COMPACTION_STARTED_METHOD, {
    threadId: session.bbThreadId,
  });

  const finish = (outcome: Record<string, unknown>): void => {
    finishCompaction(session, outcome);
  };

  const promptResult = session.connection.request({
    method: "session/prompt",
    params: {
      sessionId: session.providerThreadId,
      prompt: [{ type: "text", text: "/compact" }],
    },
    resultSchema: acpPromptResultSchema,
  });
  acceptTurnInput(session, pending);

  session.turnSettled = promptResult
    .then((result) => {
      const grokUsage = grokContextUsageFromPromptResult(result);
      if (grokUsage !== undefined) {
        emitGrokContextWindow(session, grokUsage.used);
      }
      finish(
        result.stopReason === "end_turn"
          ? compactionOutcomeForEndTurn(
              session.dialect,
              session.compactionAgentMessage,
            )
          : result.stopReason === "cancelled"
            ? { status: "interrupted" }
            : {
                status: "failed",
                error: `Agent stopped compaction: ${result.stopReason}`,
              },
      );
    })
    .catch((error: unknown) => {
      finish({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

function finishCompaction(
  session: AcpThreadSession,
  outcome: Record<string, unknown>,
): void {
  if (session.activePromptKind !== "compaction") {
    return;
  }
  emitForSession(session, ACP_COMPACTION_COMPLETED_METHOD, {
    threadId: session.bbThreadId,
    ...outcome,
  });
  setActivePromptKind(session, null);
  session.turnSettled = undefined;
}

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
    case "elicitation/create":
      handleElicitationRequest(session, params, responder);
      return;
    default:
      handleDialectRequest(session, method, params, responder);
  }
}

function handleDialectRequest(
  session: AcpThreadSession,
  method: string,
  params: unknown,
  responder: AcpAgentRequestResponder,
): void {
  const outcome = session.dialect.handleClientRequest?.(method, params);
  if (outcome === undefined) {
    responder.error(-32601, `Unsupported ACP client method "${method}"`);
    return;
  }
  if (outcome.delegation !== undefined) {
    sendThreadDeltas(
      session.bbThreadId,
      session.translator.noteDelegationReport(
        session.bbThreadId,
        outcome.delegation,
      ),
    );
  }
  responder.result(outcome.result);
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
  const rawUpdate = isJsonObject(params) ? params["update"] : undefined;
  if (session.loading) {
    if (parsed.data.sessionId === session.loadingSessionId) {
      session.model.applySessionUpdate(rawUpdate);
      if (parsed.data.update.sessionUpdate === "usage_update") {
        const usageUpdate = acpUsageUpdateSchema.safeParse(parsed.data.update);
        if (usageUpdate.success) {
          session.pendingLoadUsageUpdate = usageUpdate.data;
        }
      }
    }
    return;
  }
  if (session.providerThreadId === "") {
    session.deferStartEmit?.(
      ACP_UPDATE_METHOD,
      { threadId: session.bbThreadId, update: parsed.data.update },
      parsed.data.sessionId,
      rawUpdate,
    );
    return;
  }
  if (parsed.data.sessionId !== session.providerThreadId) {
    return;
  }
  if (parsed.data.update.sessionUpdate === "config_option_update") {
    const configState = acpConfigStateResultSchema.safeParse(
      parsed.data.update,
    );
    if (configState.success && configState.data.configOptions) {
      session.nativeConfig = {
        ...session.nativeConfig,
        configOptions: configState.data.configOptions,
      };
    }
  }
  if (session.activePromptKind === "compaction") {
    const chunk = acpAgentMessageChunkUpdateSchema.safeParse(
      parsed.data.update,
    );
    if (chunk.success) {
      session.compactionAgentMessage +=
        extractAcpContentText(chunk.data.content) ?? "";
    }
  }
  emitSessionUpdate(session, parsed.data.update, rawUpdate);
}

type DecodedAcpBridgeRequest =
  | { kind: "request"; request: AcpBridgeCommand & { id: string | number } }
  | { kind: "unknown-method"; id: string | number; method: string }
  | {
      kind: "invalid-params";
      id: string | number;
      method: string;
      issues: string;
    }
  | { kind: "ignored" };

function decodeAcpBridgeJsonRpcRequest(raw: unknown): DecodedAcpBridgeRequest {
  const envelope = bridgeRequestEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return { kind: "ignored" };
  }
  const command = acpBridgeCommandSchema.safeParse({
    method: envelope.data.method,
    params: envelope.data.params ?? {},
  });
  if (command.success) {
    return {
      kind: "request",
      request: { ...command.data, id: envelope.data.id },
    };
  }
  if (
    !(acpBridgeCommandMethodValues as readonly string[]).includes(
      envelope.data.method,
    )
  ) {
    return {
      kind: "unknown-method",
      id: envelope.data.id,
      method: envelope.data.method,
    };
  }
  return {
    kind: "invalid-params",
    id: envelope.data.id,
    method: envelope.data.method,
    issues: command.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; "),
  };
}

async function handleModelList(
  id: string | number,
  params: AcpModelListParams,
  dialectId: string | undefined,
): Promise<void> {
  function sendModels(models: readonly AvailableModel[]): void {
    sendResult(
      id,
      splitPrimaryModels(
        applyConfiguredReasoningToModels(models, {
          reasoningCli: params.reasoningCli,
          nativeReasoning: params.nativeReasoning,
        }),
        params.primaryModels,
      ),
    );
  }

  const catalog = params.listCommand
    ? await loadAgentModelCatalog(params.listCommand)
    : null;
  if (catalog) {
    sendModels(
      params.parameterizedModelPicker && dialectId === "cursor"
        ? buildCursorParameterizedModelCatalog(catalog.models)
        : catalog.models,
    );
    return;
  }
  const sessionDiscoveredModels =
    params.listCommand === undefined && params.agent
      ? await loadSessionDiscoveredModels(
          params.agent,
          params.reasoningProbePriorityModelIds,
          params.parameterizedModelPicker,
        )
      : null;
  if (sessionDiscoveredModels) {
    sendModels(sessionDiscoveredModels);
    return;
  }
  sendResult(id, {
    models: [
      applyConfiguredReasoningToModel(ACP_DEFAULT_MODEL, {
        reasoningCli: params.reasoningCli,
        nativeReasoning: params.nativeReasoning,
      }),
    ],
    selectedOnlyModels: [],
  });
}

function decodeLaunchSpec(
  providerOptions: Record<string, unknown> | undefined,
): AcpLaunchSpec | null {
  const launchSpec = acpLaunchSpecSchema.safeParse(
    providerOptions?.["acpLaunchSpec"],
  );
  return launchSpec.success ? launchSpec.data : null;
}

const acpProviderOptionsSchema = z
  .object({
    additionalWorkspaceWriteRoots: z.array(z.string()).optional(),
    acpDialect: z.string().min(1).optional(),
    parameterizedModelPicker: z.boolean().optional(),
    primaryModels: z.array(z.string().min(1)).optional(),
    reasoningProbePriorityModelIds: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

interface AcpModelPickerOptions {
  parameterizedModelPicker: boolean;
  primaryModels?: string[];
  reasoningProbePriorityModelIds: string[];
}

function decodeAcpModelPickerOptions(
  providerOptions: Record<string, unknown> | undefined,
): AcpModelPickerOptions {
  const parsed = acpProviderOptionsSchema.parse(providerOptions ?? {});
  return {
    parameterizedModelPicker: parsed.parameterizedModelPicker === true,
    ...(parsed.primaryModels === undefined
      ? {}
      : { primaryModels: [...parsed.primaryModels] }),
    reasoningProbePriorityModelIds: [
      ...(parsed.reasoningProbePriorityModelIds ?? []),
    ],
  };
}

function decodeAdditionalWorkspaceWriteRoots(
  providerOptions: Record<string, unknown> | undefined,
): string[] {
  return (
    acpProviderOptionsSchema.parse(providerOptions ?? {})
      .additionalWorkspaceWriteRoots ?? []
  );
}

function decodeDialectId(
  providerOptions: Record<string, unknown> | undefined,
): string | undefined {
  return acpProviderOptionsSchema.parse(providerOptions ?? {}).acpDialect;
}

function maintenanceTarget(
  providerOptions: Record<string, unknown> | undefined,
): {
  maintenance: AcpMaintenanceDialect | undefined;
  command: string | null;
  dialectId: string;
  env: NodeJS.ProcessEnv;
} {
  const launchSpec = decodeLaunchSpec(providerOptions);
  const dialect = resolveAcpDialect({
    dialectId: decodeDialectId(providerOptions),
    command: launchSpec?.command ?? "",
  });
  return {
    maintenance: dialect.maintenance,
    command: launchSpec?.command ?? null,
    dialectId: dialect.id,
    env: { ...process.env, ...launchSpec?.env },
  };
}

async function handleRequest(
  request: AcpBridgeCommand & { id: string | number },
): Promise<void> {
  switch (request.method) {
    case "initialize":
      const result: InitializeResult = {
        ok: true,
        protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
        capabilities: {
          sessionRestore: false,
          threadArchive: false,
          threadRename: false,
          threadGoalClear: false,
          fork: "tip",
          approvalEnforcedBy: "runtime",
          grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
          steerMode: "queue",
          skills: { configure: true },
        },
      };
      sendResult(request.id, result);
      return;

    case "model/list": {
      const modelPicker = decodeAcpModelPickerOptions(
        request.params.providerOptions,
      );
      await handleModelList(
        request.id,
        buildAcpModelListParams(
          decodeLaunchSpec(request.params.providerOptions),
          modelPicker,
        ),
        decodeDialectId(request.params.providerOptions),
      );
      return;
    }

    case "provider/health":
      sendResult(
        request.id,
        await getAcpProviderHealth(
          maintenanceTarget(request.params.providerOptions),
        ),
      );
      return;

    case "provider/usage":
      sendResult(
        request.id,
        await getAcpProviderUsage(
          maintenanceTarget(request.params.providerOptions),
        ),
      );
      return;

    case "provider/installation/status":
      sendResult(
        request.id,
        await getAcpProviderInstallationStatus(
          maintenanceTarget(request.params.providerOptions),
        ),
      );
      return;

    case "provider/installation/run":
      sendResult(
        request.id,
        await getAcpProviderInstallationRun({
          ...maintenanceTarget(request.params.providerOptions),
          action: request.params.action,
        }),
      );
      return;

    case "thread/start":
    case "thread/resume":
    case "thread/fork": {
      if (
        request.method === "thread/fork" &&
        request.params.sourceProviderCheckpointId !== undefined
      ) {
        sendError(
          request.id,
          BRIDGE_JSON_RPC_ERRORS.FORK_CHECKPOINT_UNSUPPORTED,
          "ACP session/fork cannot fork at a checkpoint; only tip forks are supported",
        );
        return;
      }
      const params = request.params;
      const launchSpec = decodeLaunchSpec(params.options.providerOptions);
      if (launchSpec === null) {
        sendError(
          request.id,
          BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
          `Invalid params for "${request.method}": options.providerOptions.acpLaunchSpec is required by the ACP bridge`,
        );
        return;
      }
      const modelPicker = decodeAcpModelPickerOptions(
        params.options.providerOptions,
      );
      const sessionParams = buildAcpSessionParams({
        additionalWorkspaceWriteRoots: decodeAdditionalWorkspaceWriteRoots(
          params.options.providerOptions,
        ),
        dialectId: decodeDialectId(params.options.providerOptions),
        cwd: params.cwd,
        dynamicTools: params.dynamicTools,
        options: {
          ...params.options,
          skillRoots: configuredSkillRoots ?? undefined,
        },
        parameterizedModelPicker: modelPicker.parameterizedModelPicker,
        launchSpec,
        providerLabel: launchSpec.displayName,
        threadId: params.threadId,
      });
      const session = await startAgentSession(
        request.method === "thread/resume"
          ? {
              kind: "resume",
              params: sessionParams,
              resumeProviderThreadId: request.params.providerThreadId,
            }
          : request.method === "thread/fork"
            ? {
                kind: "fork",
                params: sessionParams,
                sourceProviderThreadId: request.params.sourceProviderThreadId,
              }
            : { kind: "start", params: sessionParams },
      );
      sendResult(request.id, {
        providerThreadId: session.providerThreadId,
        sessionRestorable: session.supportsLoadSession,
      });
      return;
    }

    case "turn/start": {
      const params = request.params;
      let session = liveSessionForThread(params.threadId);
      if (session === undefined) {
        sendError(request.id, -32000, "No active ACP session");
        return;
      }
      if (session.activePromptKind === "agent") {
        finishAgentTurn(
          session,
          agentTurnHasOpenWork(session) ? "cancelled" : "end_turn",
        );
      }
      if (session.activePromptKind !== null) {
        sendError(request.id, -32000, "A turn is already active");
        return;
      }
      const reconciled = reconcileExecutionSettings(session, params.options);
      session = reconciled instanceof Promise ? await reconciled : reconciled;
      if (params.options.sessionOptions !== undefined) {
        await applySessionOptionSelections(
          session,
          params.options.sessionOptions,
        );
      }
      const pending: AcpPendingTurnInput = {
        clientRequestId: params.clientRequestId,
        input: params.input,
        requestId: request.id,
        options: params.options,
      };
      if (isStandaloneBuiltinCompactCommand(params.input)) {
        startCompaction(session, pending);
      } else {
        runTurn(session, pending);
      }
      return;
    }

    case "turn/steer": {
      const params = request.params;
      const session = liveSessionForThread(params.threadId);
      if (session === undefined) {
        sendError(request.id, -32000, "No active ACP session");
        return;
      }
      if (session.activePromptKind === "agent") {
        sendResult(request.id, { threadId: params.threadId });
        runTurn(
          session,
          {
            clientRequestId: params.clientRequestId,
            input: params.input,
            requestId: null,
            options: params.options,
          },
          true,
        );
        return;
      }
      if (session.activePromptKind !== "turn") {
        const message = "No active turn to steer";
        sendError(request.id, BRIDGE_JSON_RPC_ERRORS.NO_ACTIVE_TURN, message, {
          recovery: { kind: "staleTurn", message, retryable: false },
        });
        return;
      }
      session.queuedInputs.push({
        clientRequestId: params.clientRequestId,
        input: params.input,
        requestId: null,
        options: params.options,
      });
      requestSteerCancel(session);
      sendResult(request.id, { threadId: params.threadId });
      return;
    }

    case "thread/stop": {
      const session = sessionsByBbThreadId.get(request.params.threadId);
      if (session) {
        if (request.params.intent === "release") {
          await releaseSession(session);
        } else {
          await stopSession(session);
        }
      }
      sendResult(request.id, { ok: true });
      return;
    }

    case "thread/discard":
      sendResult(request.id, { ok: true });
      return;

    case "skills/configure":
      configuredSkillRoots = request.params.roots.map((root) => ({
        id: root.id,
        skillDirectoryRootPath: root.path,
        skills: root.skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
        })),
      }));
      sendResult(request.id, { ok: true });
      return;
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

  const decoded = decodeAcpBridgeJsonRpcRequest(parsed);
  if (decoded.kind === "ignored") {
    return;
  }
  if (decoded.kind === "unknown-method") {
    sendError(
      decoded.id,
      BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
      `Unknown method "${decoded.method}"`,
    );
    return;
  }
  if (decoded.kind === "invalid-params") {
    sendError(
      decoded.id,
      BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
      `Invalid params for "${decoded.method}": ${decoded.issues}`,
    );
    return;
  }
  runBridgeRequest({
    request: decoded.request,
    handleRequest: (request) =>
      handleRequest(request).catch((error: unknown) => {
        throw withAcpAuthRequiredRecovery(error);
      }),
    sendError,
  });
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

if (process.argv.includes("--mcp-stdio")) {
  runAcpDynamicToolMcpServer();
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  onClose: () => {
    void stopAllSessions().finally(() => {
      process.exit(0);
    });
  },
});
