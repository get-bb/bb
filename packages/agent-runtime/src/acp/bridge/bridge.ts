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
import { promises as fs, readFileSync, realpathSync } from "node:fs";
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
  decodeBridgeJsonRpcResponse,
  jsonRpcEnvelopeSchema,
} from "../../shared/bridge-tool-calls.js";
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
  acpInitializeResultSchema,
  acpPromptResultSchema,
  acpReadTextFileParamsSchema,
  acpRequestPermissionParamsSchema,
  acpSessionNewResultSchema,
  acpSessionNotificationParamsSchema,
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
  parseAgentModelLines,
  splitPrimaryModels,
  type AgentModelCatalog,
} from "./model-catalog.js";

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
  (decision: "allow_once" | "allow_for_session" | "deny" | null) => void
>();
let runtimeRequestIdCounter = 0;

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
const AUTH_REQUIRED_MODEL_LIST_ERROR_MESSAGE =
  "Cursor agent is not authenticated.";

let cachedModelCatalog: { key: string; catalog: AgentModelCatalog } | null =
  null;

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
      { timeout: MODEL_LIST_TIMEOUT_MS },
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
      text.includes("CURSOR_AUTH_TOKEN"))
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
  if (!selection) {
    return { args: [...params.agent.args], warning: undefined };
  }
  let resolved: string | undefined;
  let warning: string | undefined;
  if (selection.reasoningLevel !== undefined) {
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
    });
    if (resolved === undefined) {
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
  runtimeRequestIdCounter += 1;
  const requestId = runtimeRequestIdCounter;
  pendingRuntimeRequests.set(requestId, (decision) => {
    if (!session.pendingPermissions.delete(pending)) {
      // Already settled as cancelled (stop/cancel raced the user's decision).
      return;
    }
    respondPermission(pending, decision);
  });

  const toolCall = parsed.data.toolCall;
  const rawInputCommand = acpRawInputCommandSchema.safeParse(
    toolCall?.rawInput,
  );
  send({
    jsonrpc: "2.0",
    id: requestId,
    method: ACP_PERMISSION_REQUEST_METHOD,
    params: {
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
    },
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
    env: { ...process.env, ...params.envVars },
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

    let sessionId: string | undefined;
    if (request.kind === "resume" && supportsLoadSession) {
      session.loading = true;
      try {
        await connection.request({
          method: "session/load",
          params: {
            sessionId: request.params.providerThreadId,
            cwd: params.cwd,
            mcpServers: [],
          },
          resultSchema: z.unknown(),
        });
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
        params: { cwd: params.cwd, mcpServers: [] },
        resultSchema: acpSessionNewResultSchema,
      });
      sessionId = newSession.sessionId;
      if (request.kind === "resume") {
        sendNotification(ACP_WARNING_METHOD, {
          threadId: bbThreadId,
          summary: `${agentLabel} could not restore the previous session; continuing in a fresh session without in-agent history.`,
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
      if (!catalog) {
        sendResult(request.id, {
          models: [ACP_DEFAULT_MODEL],
          selectedOnlyModels: [],
        });
        return;
      }
      sendResult(
        request.id,
        splitPrimaryModels(catalog.models, request.params.primaryModels),
      );
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
      if ("error" in response) {
        pending(null);
      } else {
        const decision = acpPermissionResponseSchema.safeParse(response.result);
        pending(decision.success ? decision.data.decision : null);
      }
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
