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
import { promises as fs, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import {
  dirname,
  extname,
  isAbsolute,
  basename,
  relative,
  resolve,
} from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AvailableModel, PromptInput } from "@bb/domain";
import { buildEditDiff } from "../../shared/adapter-utils.js";
import {
  decodeToolCallResponsePayload,
  type BridgeJsonRpcResponse,
  decodeBridgeJsonRpcResponse,
  jsonRpcEnvelopeSchema,
} from "../../shared/bridge-tool-calls.js";
import { withoutBridgeRuntimeEnv } from "../../shared/bridge-runtime-env.js";
import {
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
  acpSessionNewResultSchema,
  acpSessionNotificationParamsSchema,
  type AcpSessionModels,
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
  permissionMode: "full" | "workspace-write" | "readonly";
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
  policy: AcpSessionPolicy;
  cwd: string;
  pendingInstructions: string | undefined;
  promptActive: boolean;
  queuedInputs: PromptInput[][];
  loading: boolean;
  stopping: boolean;
  /** Resolves when the in-flight bb turn loop fully settles. */
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

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

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

function send(
  msg: JsonRpcResponse | BridgeNotification | BridgeRuntimeRequest,
): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function sendResult(id: string | number, result: unknown): void {
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id: string | number, code: number, message: string): void {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

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
const ACP_NATIVE_REASONING_DISCOVERY_MODEL_LIMIT = 50;
const AUTH_REQUIRED_MODEL_LIST_ERROR_MESSAGE =
  "ACP agent is not authenticated.";

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

  const connection = createAcpAgentConnection({
    command: agent.command,
    args: agent.args,
    cwd: agent.cwd ?? process.cwd(),
    env: { ...withoutBridgeRuntimeEnv(process.env), ...(agent.envVars ?? {}) },
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
        await connection.request({
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
  if (modelOptions.length > ACP_NATIVE_REASONING_DISCOVERY_MODEL_LIMIT) {
    return null;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutReached = new Promise<null>((resolve) => {
    timeout = setTimeout(() => {
      args.connection.kill();
      resolve(null);
    }, ACP_NATIVE_REASONING_DISCOVERY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      (async () => {
        const supportByModel = new Map<string, AcpNativeReasoningSupport>();
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
    return null;
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
 * Resolve the session's model pin to the exact raw agent id and compose the
 * launch args: `<selectFlag> <id>` precedes the agent args because agent
 * CLIs treat the flag as a global option (`agent --model X acp`). When the
 * requested reasoning level has no variant (or the catalog is unavailable),
 * the family id launches as-is — it is a real agent id at its default effort.
 */
async function resolveAgentLaunchArgs(
  params: AcpBridgeThreadStartParams,
): Promise<{ args: string[]; warning: string | undefined }> {
  const selection = params.modelSelection;
  if (!selection || !("selectFlag" in selection)) {
    return { args: [...params.agent.args], warning: undefined };
  }
  let resolved: string | undefined;
  let warning: string | undefined;
  // Resolve whenever the selection narrows the raw id: an explicit reasoning
  // effort, or Fast mode (which picks the model's `-fast` twin).
  if (
    selection.reasoningLevel !== undefined ||
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
      reasoningLevel: selection.reasoningLevel,
      serviceTier: selection.serviceTier,
    });
    if (resolved === undefined && selection.reasoningLevel !== undefined) {
      warning = `Model "${selection.model}" has no ${selection.reasoningLevel} reasoning variant; launching it at its default effort.`;
    }
  }
  return {
    args: [
      selection.selectFlag,
      resolved ?? selection.model,
      ...params.agent.args,
    ],
    warning,
  };
}

async function selectAcpNativeModel(args: {
  connection: AcpAgentConnection;
  sessionId: string;
  configOptions: readonly AcpConfigOption[] | undefined;
  models: AcpSessionModels | undefined;
  modelSelection: AcpBridgeThreadStartParams["modelSelection"];
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
    const configState = await args.connection.request({
      method: "session/set_model",
      params: { sessionId: args.sessionId, modelId: selection.modelId },
      resultSchema: z.union([acpConfigStateResultSchema, z.null()]),
    });
    configOptions = configState?.configOptions ?? configOptions;
  }
  await selectAcpNativeReasoning({
    connection: args.connection,
    sessionId: args.sessionId,
    configOptions,
    modelSelection: selection,
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
}): Promise<void> {
  const reasoningLevel = args.modelSelection.reasoningLevel;
  if (reasoningLevel === undefined) {
    return;
  }
  const thoughtLevelOption = findAcpThoughtLevelConfigOption(
    args.configOptions,
  );
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

function mimeTypeFromExtension(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/png";
  }
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

  if (session.stopping) {
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

  if (session.policy.permissionMode === "readonly") {
    responder.error(
      -32000,
      "File writes are denied by BB's readonly permission mode",
    );
    return;
  }
  if (
    session.policy.permissionMode === "workspace-write" &&
    !isPathInsideRoots(parsed.data.path, session.policy.workspaceWriteRoots)
  ) {
    responder.error(
      -32000,
      `File writes outside the workspace are denied by BB's workspace-write permission mode: ${parsed.data.path}`,
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
  | { kind: "resume"; params: AcpBridgeThreadResumeParams };

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
  const connection = createAcpAgentConnection({
    command: params.agent.command,
    args: launch.args,
    cwd: params.cwd,
    env: { ...withoutBridgeRuntimeEnv(process.env), ...params.envVars },
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
    policy: {
      permissionMode: params.permissionMode,
      permissionEscalation: params.permissionEscalation,
      workspaceWriteRoots: params.workspaceWriteRoots,
    },
    cwd: params.cwd,
    pendingInstructions: params.instructions,
    promptActive: false,
    queuedInputs: [],
    loading: false,
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
    session.supportsImageInput =
      initializeResult.agentCapabilities?.promptCapabilities?.image ?? false;
    const supportsLoadSession =
      initializeResult.agentCapabilities?.loadSession ?? false;
    const mcpServers = await buildSessionMcpServers(params);

    let sessionId: string | undefined;
    let loadedConfigOptions: readonly AcpConfigOption[] | undefined;
    let loadedModels: AcpSessionModels | undefined;
    if (request.kind === "resume" && supportsLoadSession) {
      session.loading = true;
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
      } finally {
        session.loading = false;
      }
    }

    if (sessionId === undefined) {
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
      });
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

  if (session.promptActive && !session.connection.exited) {
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

function runTurn(session: AcpThreadSession, firstInput: PromptInput[]): void {
  session.promptActive = true;
  sendNotification(ACP_TURN_STARTED_METHOD, { threadId: session.bbThreadId });

  session.turnSettled = (async () => {
    let input = firstInput;
    for (;;) {
      let stopReason: z.infer<typeof acpStopReasonSchema>;
      try {
        const result = await session.connection.request({
          method: "session/prompt",
          params: {
            sessionId: session.providerThreadId,
            prompt: buildPromptContentBlocks(session, input),
          },
          resultSchema: acpPromptResultSchema,
        });
        stopReason = result.stopReason;
      } catch (error) {
        session.promptActive = false;
        session.queuedInputs = [];
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

      if (stopReason !== "cancelled" && !session.stopping) {
        // Steer inputs queued during the prompt continue the same bb turn.
        const next = session.queuedInputs.shift();
        if (next) {
          input = next;
          continue;
        }
      }

      session.promptActive = false;
      session.queuedInputs = [];
      sendNotification(ACP_TURN_COMPLETED_METHOD, {
        threadId: session.bbThreadId,
        stopReason,
      });
      return;
    }
  })();
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
  if (session.loading || session.stopping) {
    return;
  }
  const parsed = acpSessionNotificationParamsSchema.safeParse(params);
  if (!parsed.success) {
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
          splitPrimaryModels(catalog.models, request.params.primaryModels),
        );
        return;
      }
      const sessionDiscoveredModels =
        request.params.listCommand === undefined && request.params.agent
          ? await loadSessionDiscoveredModels(request.params.agent)
          : null;
      if (sessionDiscoveredModels) {
        sendResult(request.id, {
          models: sessionDiscoveredModels,
          selectedOnlyModels: [],
        });
        return;
      }
      sendResult(request.id, {
        models: [ACP_DEFAULT_MODEL],
        selectedOnlyModels: [],
      });
      return;
    }

    case "thread/start": {
      const session = await startAgentSession({
        kind: "start",
        params: request.params,
      });
      sendResult(request.id, { providerThreadId: session.providerThreadId });
      return;
    }

    case "thread/resume": {
      const session = await startAgentSession({
        kind: "resume",
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
      if (session.promptActive) {
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
      if (!session.promptActive) {
        sendError(request.id, -32000, "No active turn to steer");
        return;
      }
      session.queuedInputs.push(request.params.input);
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
  }
}

export function handleLine(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

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
  void handleRequest(request).catch((error: unknown) => {
    sendError(
      request.id,
      -32000,
      error instanceof Error ? error.message : String(error),
    );
  });
}

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

function isMainModule(): boolean {
  const entryPoint = process.argv[1];
  if (entryPoint === undefined) {
    return false;
  }
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(resolve(entryPoint))
    );
  } catch {
    return false;
  }
}

if (isMainModule()) {
  if (process.argv.includes("--mcp-stdio")) {
    runAcpDynamicToolMcpServer();
  } else {
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.on("line", handleLine);
    rl.on("close", () => {
      // Stdin close is a process shutdown boundary; cancel and reap the agent
      // subprocesses before the bridge exits so none outlive the daemon.
      void stopAllSessions().finally(() => {
        process.exit(0);
      });
    });
  }
}
