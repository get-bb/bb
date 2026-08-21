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

import {
  isStandaloneBuiltinCompactCommand,
  pendingInteractionResolutionSchema,
  reasoningEffortsForLevels,
  type AvailableModel,
  type PromptInput,
  type ReasoningLevel,
  type ThreadDelta,
  hostDaemonAcpLaunchSpecSchema,
  bridgeRequestEnvelopeSchema,
  createBridgeIo,
  createBridgeLineHandler,
  decodeBridgeJsonRpcResponse,
  decodeToolCallResponsePayload,
  mimeTypeFromExtension,
  runBridgeRequest,
  withoutBridgeRuntimeEnv,
  type BridgeJsonRpcResponse,
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_GRAMMAR_V3,
  THREAD_DELTA_NOTIFICATION_METHOD,
  type InitializeResult,
  experimental_defineProviderBridge,
} from "@get-bb/plugin-sdk/provider-bridge";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname, isAbsolute, basename, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

type DecodedToolCallResponse = ReturnType<typeof decodeToolCallResponsePayload>;
type BridgeToolCallContent = DecodedToolCallResponse["contentBlocks"][number];
type BridgeToolCallImage = DecodedToolCallResponse["images"][number];
import {
  ACP_BRIDGE_NO_ACTIVE_TURN_ERROR_CODE,
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
  buildAcpPermissionInteractionPayload,
  resolveAcpPermissionDecision,
} from "../interactions.js";
import { acpProfileFromLaunchSpec, type AcpAgentProfile } from "../profiles.js";
import {
  buildAcpModelListParams,
  buildAcpSessionParams,
  type AcpAgentCommandParam,
  type AcpModelListParams,
  type AcpSessionParams,
  type AcpSkillRoot,
} from "../session-params.js";
import {
  getAcpProviderHealth,
  getAcpProviderInstallationRun,
  getAcpProviderInstallationStatus,
  getAcpProviderUsage,
} from "./provider-maintenance.js";
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
  runAcpDynamicToolMcpServer,
  type AcpMcpServerConfig,
} from "./tool-proxy-mcp.js";

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

interface AcpSessionPolicy {
  permissionMode: "accept-edits" | "full";
  workspaceWriteRoots: string[];
}

interface PendingAcpPermission {
  responder: AcpAgentRequestResponder;
  options: AcpPermissionOption[];
}

/**
 * Turn input bb handed the bridge, waiting to reach the agent. ACP has no
 * provider acknowledgement to correlate acceptance against, so the designed
 * correlation point is the `session/prompt` request that carries the input:
 * before that the agent has not seen the input at all, and a queued steer can
 * still be dropped by a failed or stopping turn.
 */
interface AcpPendingTurnInput {
  clientRequestId: string;
  input: PromptInput[];
  /**
   * The command to answer once the input reaches the agent, or `null` for a
   * steer, which is answered at queue time. Waiting for the cancelled prompt
   * to be reissued would risk the runtime's 30-second command timeout.
   */
  requestId: AcpBridgeRequestId | null;
}

interface AcpThreadSession {
  bbThreadId: string;
  providerThreadId: string;
  /** Every session-scoped notification is translated through this. */
  translator: AcpDeltaTranslator;
  connection: AcpAgentConnection;
  supportsImageInput: boolean;
  supportsLoadSession: boolean;
  policy: AcpSessionPolicy;
  pendingInstructions: string | undefined;
  /**
   * Which agent prompt is in flight for this bb turn: an ordinary `"turn"`,
   * the provider-local `"compaction"` maintenance prompt, or none.
   */
  activePromptKind: "turn" | "compaction" | null;
  queuedInputs: AcpPendingTurnInput[];
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
  cursorMcpApproval: CursorMcpApproval | undefined;
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

// ---------------------------------------------------------------------------
// Thread-delta emission
// ---------------------------------------------------------------------------

/**
 * Skill roots latched by the canonical `skills/configure` request. ACP agents
 * have no skill-directory concept, so the roots are listed in the session
 * instructions — which are fixed at session construction, hence the latch.
 * `null` means the runtime never configured skills for this process.
 */
let configuredSkillRoots: AcpSkillRoot[] | null = null;
const ACP_CANONICAL_PROVIDER_ID = "acp";

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

/**
 * The one session-scoped emitter: it runs the ACP-flavored notification
 * through the session translator and emits the parsed semantic deltas as one
 * batched `thread/delta` notification. The `acp/*` envelope never reaches the
 * wire — it is only the translator's input vocabulary. Turn/item ids are
 * minted by the runtime's delta assembler, so no id entropy lives here
 * anymore (#1224 discipline is held centrally).
 */
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
  // Settle any open turn first: every accepted turn reaches exactly one
  // terminal state, and settlement events precede the error signal. With no
  // prompt in flight the error stays a runtime notification — a settling
  // error delta on an idle thread would surface a diagnostic for a turn bb
  // never accepted. `activePromptKind` mirrors the turn the bridge itself
  // opened with `turn.open`.
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
  // process.argv[1] is the provider-bridge bootstrap, not this module: the
  // bootstrap imports this artifact, so only import.meta.url names the file
  // that understands `--mcp-stdio`. The bootstrap rejects the flag with a
  // usage error, which the ACP agent reports as "bb-bridge: Transport closed".
  return [...process.execArgv, fileURLToPath(import.meta.url), "--mcp-stdio"];
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
  if (!session || !session.providerThreadId || session.stopping) {
    return { ok: false, error: "No active ACP session for dynamic tool call." };
  }

  // The agent's own tool_call for this MCP call is the timeline row; the
  // translator binds it to the bb tool so the row reads as that tool (Q31).
  session.translator.noteInjectedToolCall(session.bbThreadId, args.tool);
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
    if (request.data.kind === "initialized") {
      process.stderr.write(
        `acp bridge: "${ACP_BRIDGE_MCP_SERVER_NAME}" answered initialize for thread "${request.data.threadId}" (${request.data.toolCount} tools)\n`,
      );
      socket.end(`${JSON.stringify({ ok: true, content: "" })}\n`);
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

// ---------------------------------------------------------------------------
// Model catalog — parsed from the agent CLI's list command, with the
// synthetic "Agent default" entry as the resilience fallback
// ---------------------------------------------------------------------------

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

const dynamicToolBridgeRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("initialized"),
    threadId: z.string().min(1),
    token: z.string().min(1),
    toolCount: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal("toolCall"),
    arguments: z.record(z.string(), z.unknown()).default({}),
    callId: z.string().min(1),
    threadId: z.string().min(1),
    token: z.string().min(1),
    tool: z.string().min(1),
  }),
]);

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
  // Grok is currently the only built-in ACP provider that advertises auth methods.
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
  listCommand: AcpAgentCommandParam,
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
  agent: AcpAgentCommandParam,
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
  connection: AcpAgentConnection;
  sessionId: string;
  configOptions: readonly AcpConfigOption[] | undefined;
  models: AcpSessionModels | undefined;
  modelSelection: AcpSessionParams["modelSelection"];
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
  const normalizedToolCall = toolCall?.toolCallId
    ? {
        toolCallId: toolCall.toolCallId,
        ...(toolCall.title !== undefined ? { title: toolCall.title } : {}),
        ...(toolCall.kind !== undefined ? { kind: toolCall.kind } : {}),
        ...(toolCall.rawInput !== undefined
          ? { rawInput: toolCall.rawInput }
          : {}),
        ...(toolCall.locations !== undefined
          ? { locations: toolCall.locations }
          : {}),
        startedToolCall: session.translator.getMergedToolCall(
          session.bbThreadId,
          toolCall.toolCallId,
        ),
        injectedTool: session.translator.getInjectedToolBinding(
          session.bbThreadId,
          toolCall.toolCallId,
        ),
      }
    : undefined;

  {
    // The session carries the canonical PendingInteractionPayload out and
    // maps the canonical PendingInteractionResolution back.
    const payload = buildAcpPermissionInteractionPayload({
      toolCall: normalizedToolCall,
      options: parsed.data.options,
    });
    // Turn ids are runtime-minted under the narrow grammar: `turnId: null`
    // asks the runtime to stamp its active turn for this thread (the wire
    // contract's unresolved marker), which is the turn the permission
    // interrupted.
    void sendRuntimeRequest(BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest, {
      providerThreadId: session.providerThreadId,
      threadId: session.bbThreadId,
      turnId: null,
      payload,
    })
      .then((result) => {
        if (!session.pendingPermissions.delete(pending)) {
          // Already settled as cancelled (stop/cancel raced the decision).
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

    // The assembler builds the diff from oldText/content, so the envelope
    // carries the texts instead of a pre-built diff string.
    emitForSession(session, ACP_FS_WRITE_METHOD, {
      threadId: session.bbThreadId,
      path: parsed.data.path,
      kind: oldText === undefined ? "add" : "update",
      ...(oldText === undefined ? {} : { oldText }),
      content: parsed.data.content,
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
      /** The ACP session id to reload, when the agent supports loadSession. */
      resumeProviderThreadId: string;
    }
  | {
      kind: "fork";
      params: AcpSessionParams;
      /** The ACP session id to clone. */
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

  const translator = createAcpDeltaTranslator();
  // The session's bb-injected tools: a proxied call to one is a bb tool and
  // reads the way its definition says (Q31).
  translator.configureInjectedTools(
    (params.dynamicTools ?? []).map((tool) => ({
      name: tool.name,
      ...(tool.presentation === undefined
        ? {}
        : { presentation: tool.presentation }),
    })),
  );
  // Ordering guarantee: thread/identity precedes any thread/delta for the
  // session, so pre-identity notifications are held and flushed after the
  // identity goes out.
  const deferredEmits: {
    method: string;
    params: Record<string, unknown>;
  }[] = [];
  const emitStartNotification = (
    method: string,
    notificationParams: Record<string, unknown>,
  ): void => {
    deferredEmits.push({ method, params: notificationParams });
  };

  const launch = await resolveAgentLaunchArgs(params);
  if (launch.warning) {
    emitStartNotification(ACP_WARNING_METHOD, {
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
    recordThreadId: bbThreadId,
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
      void releaseCursorMcpApproval(session);
      emitSessionError(
        session,
        `ACP agent "${agentLabel}" exited unexpectedly` +
          `${info.code !== null ? ` (code ${info.code})` : ""}` +
          `${info.stderrTail ? `: ${info.stderrTail}` : ""}`,
      );
    },
  });
  session = {
    bbThreadId,
    providerThreadId: "",
    translator,
    connection,
    supportsImageInput: false,
    supportsLoadSession: false,
    policy: {
      permissionMode: params.permissionMode,
      workspaceWriteRoots: params.workspaceWriteRoots,
    },
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
    cursorMcpApproval: undefined,
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
    session.supportsLoadSession = supportsLoadSession;
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
    if (request.kind === "fork") {
      const forkedSession = await connection.request({
        method: "session/fork",
        params: {
          sessionId: request.sourceProviderThreadId,
          cwd: params.cwd,
          mcpServers,
        },
        resultSchema: acpSessionForkResultSchema,
      });
      // The agent owns this value and the schema checks only that it is a
      // string. A reused ID would overwrite the map entry of the source or of
      // another live thread, so reject it instead of registering it.
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
    } else if (request.kind === "resume" && supportsLoadSession) {
      session.loading = true;
      session.loadingSessionId = request.resumeProviderThreadId;
      session.pendingLoadUsageUpdate = undefined;
      try {
        const configState = await connection.request({
          method: "session/load",
          params: {
            sessionId: request.resumeProviderThreadId,
            cwd: params.cwd,
            mcpServers,
          },
          resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
        });
        loadedConfigOptions = configState?.configOptions;
        loadedModels = configState?.models;
        sessionId = request.resumeProviderThreadId;
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
        emitStartNotification(ACP_WARNING_METHOD, {
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
        emitStartNotification(ACP_UPDATE_METHOD, {
          threadId: session.bbThreadId,
          update: loadUsageUpdate,
        });
      }
    }

    session.providerThreadId = sessionId;
    sessionsByBbThreadId.set(bbThreadId, session);
    bbThreadIdByProviderThreadId.set(sessionId, bbThreadId);
    sendNotification(BRIDGE_NOTIFICATION_METHODS.threadIdentity, {
      threadId: bbThreadId,
      providerThreadId: sessionId,
      sessionRestorable: session.supportsLoadSession,
    });
    // The provider id-space boundary: a new agent session was constructed for
    // this thread (start/resume/fork all land here), so the assembler drops
    // the thread's assembly state — settled item keys, id maps, accumulated
    // usage — before any of the new session's deltas.
    sendThreadDeltas(bbThreadId, [{ kind: "session.reset" }]);
    for (const deferred of deferredEmits) {
      emitForSession(session, deferred.method, deferred.params);
    }
    deferredEmits.length = 0;
    return session;
  } catch (error) {
    session.stopping = true;
    connection.kill();
    removeSession(session);
    await releaseCursorMcpApproval(session);
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

  session.connection.kill();
  removeSession(session);
  await releaseCursorMcpApproval(session);
}

/**
 * Detach a session without the cancel-settle path: a release stop must never
 * fabricate an interruption (#1584). The agent subprocess is reaped directly;
 * any in-flight prompt rejection is swallowed by the turn loop because
 * `stopping` is already set.
 */
async function releaseSession(session: AcpThreadSession): Promise<void> {
  if (session.stopping) {
    return;
  }
  session.stopping = true;
  dropQueuedTurnInputs(
    session,
    "ACP session released before the steer was sent",
  );
  cancelPendingPermissions(session);
  session.connection.kill();
  removeSession(session);
  await releaseCursorMcpApproval(session);
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

/**
 * Accepted-input correlation (turn/input/accepted): the input reached the
 * agent, so bb can attach it to the turn it runs in. Reporting acceptance
 * before the `session/prompt` request goes out would claim an input the agent
 * may never be given.
 */
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

/**
 * Report input the turn ended without ever sending. Reply, never drop (#853):
 * a command still waiting on the input fails instead of hanging, and no
 * acceptance is reported for a turn the agent never received it in.
 */
function dropTurnInput(pending: AcpPendingTurnInput, reason: string): void {
  const requestId = takeTurnInputRequestId(pending);
  if (requestId !== null) {
    sendError(requestId, -32000, reason);
  }
}

/** Answers a command at most once, whatever else happens to the input. */
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
  session.activePromptKind = null;
  dropQueuedTurnInputs(session, "ACP turn ended before the steer was sent");
  session.promptRequestPending = false;
  session.cancelRequested = false;
  emitForSession(session, ACP_TURN_COMPLETED_METHOD, {
    threadId: session.bbThreadId,
    stopReason,
  });
}

function runTurn(
  session: AcpThreadSession,
  firstInput: AcpPendingTurnInput,
): void {
  session.activePromptKind = "turn";
  emitForSession(session, ACP_TURN_STARTED_METHOD, {
    threadId: session.bbThreadId,
  });

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
        session.promptRequestPending = true;
        const promptResult = session.connection.request({
          method: "session/prompt",
          params: {
            sessionId: session.providerThreadId,
            prompt: buildPromptContentBlocks(session, pending.input),
          },
          resultSchema: acpPromptResultSchema,
        });
        // The agent has the input now, and the turn it runs in is already
        // open, so the acceptance names that turn instead of waiting as a
        // pending claim any stale terminal could take (#2014).
        acceptTurnInput(session, pending);
        // A steer that stacked behind the cancelled prompt still needs its own
        // cancel; otherwise this prompt can hang and strand the later input.
        if (session.queuedInputs.length > 0) {
          requestSteerCancel(session);
        }
        const result = await promptResult;
        stopReason = result.stopReason;
      } catch (error) {
        session.promptRequestPending = false;
        // Answered already unless the request never went out at all.
        dropTurnInput(pending, "ACP turn failed before the prompt was sent");
        dropQueuedTurnInputs(
          session,
          "ACP turn failed before the steer was sent",
        );
        session.cancelRequested = false;
        // An exited agent already produced an error notification from the
        // connection's exit handler; only report in-protocol prompt failures.
        // The error settles the still-open turn, so it is emitted before
        // `activePromptKind` clears (the bridge's own open-turn mirror).
        if (!session.stopping && !session.connection.exited) {
          emitSessionError(
            session,
            error instanceof Error ? error.message : String(error),
          );
        }
        session.activePromptKind = null;
        return;
      }
      session.promptRequestPending = false;

      // Hard steer cancels the current prompt, then continues this bb turn.
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

// ---------------------------------------------------------------------------
// Manual compaction
// ---------------------------------------------------------------------------

/**
 * Manual compaction travels the prompt path: bb's compact affordance sends a
 * standalone builtin `/compact` mention as turn input. ACP has no compaction
 * method, so the bridge runs the agent's own `/compact` command as a
 * provider-local maintenance prompt and reports it through the compaction
 * envelopes — the translator turns those into a `contextCompaction` turn, and
 * only a completed one reports `thread/compacted`.
 *
 * Whether an agent has the command at all is a per-agent fact ACP does not
 * expose: opencode's `available_commands_update` lists only its custom
 * commands, never its built-in `/compact`. So the affordance is gated by the
 * provider declaration or custom-agent config, and the bridge reports whatever
 * the agent does with the request: only an `end_turn` prompt counts as compacted,
 * every other stop reason or prompt rejection fails the turn with the agent's
 * own reason rather than being reported as a shrunk context.
 */
function startCompaction(
  session: AcpThreadSession,
  pending: AcpPendingTurnInput,
): void {
  session.activePromptKind = "compaction";
  emitForSession(session, ACP_COMPACTION_STARTED_METHOD, {
    threadId: session.bbThreadId,
  });

  const finish = (outcome: Record<string, unknown>): void => {
    emitForSession(session, ACP_COMPACTION_COMPLETED_METHOD, {
      threadId: session.bbThreadId,
      ...outcome,
    });
    session.activePromptKind = null;
    session.turnSettled = undefined;
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
      finish(
        result.stopReason === "end_turn"
          ? { status: "completed" }
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
  emitForSession(session, ACP_UPDATE_METHOD, {
    threadId: session.bbThreadId,
    update: parsed.data.update,
  });
}

// ---------------------------------------------------------------------------
// Runtime command handling
// ---------------------------------------------------------------------------

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
  if (!envelope.success || envelope.data.id === undefined) {
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
  // Reply, never drop (#853): a silently dropped request is an undebuggable
  // 30-second timeout on the runtime side.
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
): Promise<void> {
  const catalog = params.listCommand
    ? await loadAgentModelCatalog(params.listCommand)
    : null;
  if (catalog) {
    sendResult(
      id,
      splitPrimaryModels(
        applyConfiguredReasoningToModels(catalog.models, {
          reasoningCli: params.reasoningCli,
          nativeReasoning: params.nativeReasoning,
        }),
        params.primaryModels,
      ),
    );
    return;
  }
  const sessionDiscoveredModels =
    params.listCommand === undefined && params.agent
      ? await loadSessionDiscoveredModels(params.agent)
      : null;
  if (sessionDiscoveredModels) {
    sendResult(id, {
      models: applyConfiguredReasoningToModels(sessionDiscoveredModels, {
        reasoningCli: params.reasoningCli,
        nativeReasoning: params.nativeReasoning,
      }),
      selectedOnlyModels: [],
    });
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

/**
 * Resolve the agent launch profile a request carries in
 * `providerOptions.acpLaunchSpec`. Session construction cannot proceed
 * without it, so absence is INVALID_PARAMS (replied by the caller).
 */
function decodeLaunchProfile(
  providerOptions: Record<string, unknown> | undefined,
): AcpAgentProfile | null {
  const launchSpec = hostDaemonAcpLaunchSpecSchema.safeParse(
    providerOptions?.["acpLaunchSpec"],
  );
  if (!launchSpec.success) {
    return null;
  }
  return acpProfileFromLaunchSpec(launchSpec.data, ACP_CANONICAL_PROVIDER_ID);
}

const acpProviderOptionsSchema = z
  .object({
    /**
     * Environment-level extra write roots. Rides the opaque provider-options
     * bag (packed by the registry) because the wire has no core
     * field for it — same delivery as the ACP launch spec.
     */
    additionalWorkspaceWriteRoots: z.array(z.string()).optional(),
  })
  .passthrough();

function decodeAdditionalWorkspaceWriteRoots(
  providerOptions: Record<string, unknown> | undefined,
): string[] {
  return (
    acpProviderOptionsSchema.parse(providerOptions ?? {})
      .additionalWorkspaceWriteRoots ?? []
  );
}

async function handleRequest(
  request: AcpBridgeCommand & { id: string | number },
): Promise<void> {
  switch (request.method) {
    case "initialize":
      // The canonical handshake (@bb/provider-bridge-protocol): the bridge
      // reports the session-behavior facts its own code implements. fork is
      // "tip" — ACP session/fork clones whole sessions and each agent's
      // support is verified per session at agent initialize. sessionRestore
      // stays false at the handshake; sessions that negotiate loadSession
      // report sessionRestorable per session. Compaction is not a handshake
      // fact: the `/compact` affordance is gated per agent by the server-side
      // `supportsManualCompaction` declaration (the agents this bridge serves
      // differ on it), and the per-turn honesty lives in `startCompaction`,
      // which fails the turn legibly for an agent that advertises no
      // `compact` command.
      // The `ok` field is the bridge's historical shape.
      // Typed so a capability rename cannot silently degrade this bridge:
      // an unrenamed key would be missing from InitializeResult, not
      // defaulted false.
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
          // grammarVersions [3, 3] — this bridge emits the v3 delta grammar
          // (one streaming dialect; the v3 item shapes land per bridge in
          // WS1b). steerMode "queue" — ACP v1 has no mid-loop inject: a hard
          // steer cancels the live prompt and re-prompts with the queued text
          // at the next boundary.
          grammarVersions: [THREAD_DELTA_GRAMMAR_V3, THREAD_DELTA_GRAMMAR_V3],
          steerMode: "queue",
        },
      };
      sendResult(request.id, result);
      return;

    case "model/list":
      // model/list carries the launch spec in providerOptions. A missing or
      // invalid spec degrades to the synthetic default entry — model listing
      // stays resilient rather than failing the picker.
      await handleModelList(
        request.id,
        buildAcpModelListParams(
          decodeLaunchProfile(request.params.providerOptions),
        ),
      );
      return;

    case "provider/health": {
      const profile = decodeLaunchProfile(request.params.providerOptions);
      sendResult(
        request.id,
        await getAcpProviderHealth({
          providerId: request.params.providerId,
          command: profile?.agentCommand.command ?? null,
        }),
      );
      return;
    }

    case "provider/usage": {
      const profile = decodeLaunchProfile(request.params.providerOptions);
      sendResult(
        request.id,
        await getAcpProviderUsage({
          providerId: request.params.providerId,
          command: profile?.agentCommand.command ?? null,
        }),
      );
      return;
    }

    case "provider/installation/status": {
      const profile = decodeLaunchProfile(request.params.providerOptions);
      sendResult(
        request.id,
        await getAcpProviderInstallationStatus({
          providerId: request.params.providerId,
          command: profile?.agentCommand.command ?? null,
        }),
      );
      return;
    }

    case "provider/installation/run": {
      const profile = decodeLaunchProfile(request.params.providerOptions);
      sendResult(
        request.id,
        await getAcpProviderInstallationRun({
          providerId: request.params.providerId,
          command: profile?.agentCommand.command ?? null,
          action: request.params.action,
        }),
      );
      return;
    }

    case "thread/start":
    case "thread/resume":
    case "thread/fork": {
      if (
        request.method === "thread/fork" &&
        request.params.sourceProviderCheckpointId !== undefined
      ) {
        // ACP session/fork clones whole sessions; a fork:"tip" bridge rejects
        // checkpoint forks instead of cloning history the bb timeline does
        // not show.
        sendError(
          request.id,
          BRIDGE_JSON_RPC_ERRORS.FORK_CHECKPOINT_UNSUPPORTED,
          "ACP session/fork cannot fork at a checkpoint; only tip forks are supported",
        );
        return;
      }
      const params = request.params;
      const profile = decodeLaunchProfile(params.options.providerOptions);
      if (profile === null) {
        sendError(
          request.id,
          BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
          `Invalid params for "${request.method}": options.providerOptions.acpLaunchSpec is required by the ACP bridge`,
        );
        return;
      }
      const sessionParams = buildAcpSessionParams({
        additionalWorkspaceWriteRoots: decodeAdditionalWorkspaceWriteRoots(
          params.options.providerOptions,
        ),
        cwd: params.cwd,
        dynamicTools: params.dynamicTools,
        options: {
          ...params.options,
          skillRoots: configuredSkillRoots ?? undefined,
        },
        profile,
        providerLabel: profile.displayName,
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
      // Requests resolve the session by bb threadId: a resume fallback
      // replaces the provider session id, but the bb thread stays the stable
      // handle.
      const params = request.params;
      const session = sessionsByBbThreadId.get(params.threadId);
      if (!session || session.stopping) {
        sendError(request.id, -32000, "No active ACP session");
        return;
      }
      if (session.activePromptKind !== null) {
        sendError(request.id, -32000, "A turn is already active");
        return;
      }
      const pending: AcpPendingTurnInput = {
        clientRequestId: params.clientRequestId,
        input: params.input,
        requestId: request.id,
      };
      // Both paths answer the command and report the acceptance once the
      // `session/prompt` request carrying the input has gone out.
      //
      // A standalone builtin `/compact` mention is bb's manual-compaction
      // request, not model input: it runs the agent's own compaction command
      // instead of becoming a prompt.
      if (isStandaloneBuiltinCompactCommand(params.input)) {
        startCompaction(session, pending);
      } else {
        runTurn(session, pending);
      }
      return;
    }

    case "turn/steer": {
      const params = request.params;
      const session = sessionsByBbThreadId.get(params.threadId);
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
      // A steer joins the active turn, but the agent only learns about it
      // when the cancelled prompt is reissued with it. The command answers now
      // — the bridge has the input — while the acceptance waits for that
      // reissue, so a steer the turn drops is never reported as accepted.
      session.queuedInputs.push({
        clientRequestId: params.clientRequestId,
        input: params.input,
        requestId: null,
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
      // ACP agents have no provider-side thread to delete; discard succeeds
      // as a noop.
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
  runBridgeRequest({ request: decoded.request, handleRequest, sendError });
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

// The bridge re-executes its own artifact as the MCP server child that
// exposes bb's dynamic tools to the ACP agent (`node <artifact> --mcp-stdio`).
// That is a different program, not this bridge starting itself: the bootstrap
// imports the artifact without the flag, so importing it starts nothing.
if (process.argv.includes("--mcp-stdio")) {
  runAcpDynamicToolMcpServer();
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  onClose: () => {
    // Stdin close is a process shutdown boundary; cancel and reap the agent
    // subprocesses before the bridge exits so none outlive the daemon.
    void stopAllSessions().finally(() => {
      process.exit(0);
    });
  },
});
