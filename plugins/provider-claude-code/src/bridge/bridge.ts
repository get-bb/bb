#!/usr/bin/env node

/**
 * Claude Code bridge process.
 *
 * JSON-RPC shell that manages Claude Agent SDK sessions and emits
 * narrow-grammar `thread/delta` notifications: raw `SDKMessage` events run
 * through the claude dialect translator (`../delta-translation.ts`) and the
 * parsed semantic deltas go to the parent, where the runtime's delta
 * assembler constructs every canonical `ThreadEvent`.
 *
 * The bridge owns only the dialect and the command plane:
 * - Manages SDK session lifecycle (start, resume, fork, stop, push input)
 * - Translates SDK messages into semantic deltas per canonical session
 * - Forwards tool call requests to the parent and feeds responses back to the SDK
 * - Emits `thread/identity` when the SDK session ID is captured, and
 *   `session.reset` at every session construction (the provider id-space
 *   boundary for central id minting)
 */

import {
  pendingInteractionResolutionSchema,
  type PendingInteractionGrantedPermissionProfile,
  type PendingInteractionPayload,
  type PermissionEscalation,
  type ReasoningLevel,
  type ThreadDelta,
  BRIDGE_INBOUND_REQUEST_METHODS,
  BRIDGE_JSON_RPC_ERRORS,
  BRIDGE_NOTIFICATION_METHODS,
  PROVIDER_BRIDGE_PROTOCOL_VERSION,
  THREAD_DELTA_NOTIFICATION_METHOD,
  threadDiscardParamsSchema as canonicalThreadDiscardParamsSchema,
  threadStartParamsSchema as canonicalThreadStartParamsSchema,
  threadStopParamsSchema as canonicalThreadStopParamsSchema,
  turnStartParamsSchema as canonicalTurnStartParamsSchema,
  turnSteerParamsSchema as canonicalTurnSteerParamsSchema,
  type InitializeResult,
  createBridgeIo,
  createBridgeLineHandler,
  createPendingToolCallTracker,
  decodeBridgeJsonRpcResponse,
  runBridgeRequest,
  shouldAutoDenyInteractiveRequest,
  withoutBridgeRuntimeEnv,
  type BridgeToolCallRequest,
  experimental_defineProviderBridge,
} from "@get-bb/plugin-sdk/provider-bridge";
import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  forkSession,
  type CanUseTool,
  type HookCallback,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  createClaudeDeltaTranslator,
  type ClaudeDeltaTranslator,
} from "../delta-translation.js";
import {
  buildClaudeApprovalInteractionPayload,
  buildClaudeInteractiveResponse,
  buildClaudeUserQuestionPayload,
} from "../interactions.js";
import {
  buildClaudeSessionParams,
  buildClaudeTurnParams,
  type ClaudeCodeSkillRoot,
} from "../session-params.js";
import { SdkSession, type SdkSessionOptions } from "./sdk-session.js";
import { createClaudeCodeBridgeModelListMemo } from "./model-list.js";
import {
  claudeThreadForkParamsSchema,
  claudeThreadResumeParamsSchema,
  claudeThreadStartParamsSchema,
  claudeTurnStartParamsSchema,
  claudeTurnSteerParamsSchema,
  decodeClaudeCodeJsonRpcRequest,
  type ClaudeCodeJsonRpcRequest,
  type ThreadForkParams,
  type ThreadResumeParams,
  type ThreadStartParams,
  type ThreadStopParams,
  type TurnStartParams,
  type TurnSteerParams,
} from "./commands.js";
import {
  getClaudeProviderHealth,
  getClaudeProviderUsage,
} from "./provider-maintenance.js";
import {
  buildReadonlyDenialMessage,
  buildMutableFlagSettings,
  buildSessionOptions,
  buildWorkspaceWriteDenialMessage,
  toSdkEffort,
  type BuildSessionOptionsArgs,
  type PermissionEscalationWorkContext,
} from "./session-options.js";
import { buildReadonlyBashUpdatedInput } from "./readonly-bash-policy.js";
import {
  buildBridgeMcpServer,
  getAllowedToolNames,
  BRIDGE_MCP_SERVER_NAME,
  type ToolCallForwarder,
} from "./tool-proxy-mcp.js";
import {
  type ClaudeInteractiveResponse,
  type ClaudePermissionMode,
  type ClaudePermissionRequestApprovalParams,
  type ClaudeSuggestedPermissionUpdate,
  type ClaudeUserQuestionInput,
  type ClaudeUserQuestionRequestParams,
  CLAUDE_EXIT_PLAN_MODE_TOOL_NAME,
  CLAUDE_PERMISSION_REQUEST_APPROVAL_METHOD,
  CLAUDE_USER_QUESTION_REQUEST_METHOD,
  CLAUDE_USER_QUESTION_TOOL_NAME,
  claudeExitPlanModeInputSchema,
  claudeInteractiveResponseSchema,
  claudeSuggestedPermissionUpdateSchema,
  claudeUserQuestionInputSchema,
  shouldRequestClaudePermissionApproval,
  toPendingInteractionPermissionProfile,
} from "../interactive-contract.js";
export { buildSessionOptions } from "./session-options.js";

const promptInputItemSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image"),
    url: z.string(),
  }),
  z.object({
    type: z.literal("localImage"),
    path: z.string(),
  }),
  z.object({
    type: z.literal("localFile"),
    path: z.string(),
    name: z.string().optional(),
    sizeBytes: z.number().optional(),
    mimeType: z.string().optional(),
  }),
]);

const CLAUDE_PROVIDER_SUBAGENT_TOOL_NAMES = new Set(["Agent", "Task"]);
const CLAUDE_WORKFLOW_TOOL_NAME = "Workflow";

/** JSON-RPC notification carrying a raw SDK message. */
interface SdkMessageNotification {
  jsonrpc: "2.0";
  method: "sdk/message";
  params: { threadId: string; message: SDKMessage };
}

/** JSON-RPC notification for bridge-originated events. */
interface BridgeEventNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

interface ThreadIdRef {
  current: string;
}

interface CurrentThreadSessionArgs {
  sessionSerial: number;
  threadId: string;
}

interface CreateSdkCallbackArgs {
  sessionSerial: number;
  threadIdRef: ThreadIdRef;
}

interface PendingInteractiveRequestBase {
  itemId: string;
  resolve: (value: PermissionResult) => void;
  /**
   * The `PendingInteractionPayload` sent out via `interaction/request`; the
   * resolution maps back through it.
   */
  payload: PendingInteractionPayload;
}

interface PendingPermissionRequest extends PendingInteractiveRequestBase {
  kind: "permission_request";
  originalInput: Record<string, unknown>;
  permissions: PendingInteractionGrantedPermissionProfile;
  toolName: string;
}

interface PendingUserQuestionRequest extends PendingInteractiveRequestBase {
  kind: "user_question";
}

type PendingInteractiveRequest =
  | PendingPermissionRequest
  | PendingUserQuestionRequest;

interface ClaudeSessionPermissionGrant {
  permissions: PendingInteractionGrantedPermissionProfile;
  toolName: string | null;
}

interface ClaudeSessionPermissionCoverageArgs {
  grants: ClaudeSessionPermissionGrant[];
  permissions: PendingInteractionGrantedPermissionProfile;
  toolName: string;
}

interface ClaudeSessionPermissionGrantCoverageArgs {
  grant: ClaudeSessionPermissionGrant;
  permissions: PendingInteractionGrantedPermissionProfile;
  toolName: string;
}

interface ThreadSession {
  session: SdkSession;
  sessionConstructionConfig: SessionConstructionConfig;
  sessionOptions: SdkSessionOptions;
  sessionSerial: number;
  closing: boolean;
  streamEnded: boolean;
  /** Every session-scoped notification is translated through this. */
  translator: ClaudeDeltaTranslator;
  pendingInteractiveRequests: Map<string | number, PendingInteractiveRequest>;
  /** Current-turn fallback when Claude supplies no originating-work metadata. */
  permissionEscalation: PermissionEscalation | null;
  permissionEscalationByAgentId: Map<string, PermissionEscalation | null>;
  /**
   * Retained for the session lifetime because background work can wake after
   * multiple newer prompts have run.
   */
  permissionEscalationByPromptId: Map<string, PermissionEscalation | null>;
  /**
   * Retained for the session lifetime so SDK messages from background
   * subagents can inherit the policy of the Agent/Task call that launched
   * them, even after that parent tool call has completed.
   */
  permissionEscalationBySubagentParentToolUseId: Map<
    string,
    PermissionEscalation | null
  >;
  permissionEscalationByToolUseId: Map<string, PermissionEscalation | null>;
  permissionMode: ClaudePermissionMode;
  liveSettings: ClaudeLiveSessionSettings;
  /** Mode to return to once the user approves a plan. See commands.ts. */
  approvedPlanPermissionMode: ClaudePermissionMode;
  providerThreadId?: string;
  sessionPermissionGrants: ClaudeSessionPermissionGrant[];
  threadIdRef: ThreadIdRef;
}

interface CreateThreadSessionArgs {
  permissionEscalation: PermissionEscalation | null;
  permissionMode: ClaudePermissionMode;
  liveSettings: ClaudeLiveSessionSettings;
  approvedPlanPermissionMode: ClaudePermissionMode;
  providerThreadId?: string;
  sessionConstructionConfig: SessionConstructionConfig;
  sessionOptions: SdkSessionOptions;
  sessionPermissionGrants?: ClaudeSessionPermissionGrant[];
  threadIdRef: ThreadIdRef;
}

type CanonicalThreadStopParams = z.infer<
  typeof canonicalThreadStopParamsSchema
>;
type CanonicalThreadDiscardParams = z.infer<
  typeof canonicalThreadDiscardParamsSchema
>;
type CanonicalTurnStartParams = z.infer<typeof canonicalTurnStartParamsSchema>;
type CanonicalTurnSteerParams = z.infer<typeof canonicalTurnSteerParamsSchema>;

/** Acceptance correlation for canonical turn input (turn/input/accepted). */
interface CanonicalTurnAcceptance {
  clientRequestId: CanonicalTurnStartParams["clientRequestId"];
  providerThreadId: string;
}

interface SessionConstructionConfig {
  config: ThreadResumeParams["config"];
  dynamicTools: ThreadResumeParams["dynamicTools"];
  // Live settings are not part of the comparable construction config: the
  // bridge applies them through SDK controls without replacing the session.
  sessionOptions: Omit<
    BuildSessionOptionsArgs,
    | "getPermissionEscalation"
    | "memoryEnabled"
    | "model"
    | "reasoningLevel"
    | "workflowsEnabled"
  >;
}

interface ClaudeLiveSessionSettings {
  memoryEnabled: boolean;
  model?: string;
  providerSubagentsEnabled: boolean;
  reasoningLevel?: ReasoningLevel;
  workflowsEnabled: boolean;
}

type SessionConstructionParams =
  | ThreadStartParams
  | ThreadResumeParams
  | ThreadForkParams;

interface ReplaceThreadSessionArgs {
  providerThreadId: string;
  replacementSession: ThreadSession;
  reason: string;
  threadId: string;
  threadSession: ThreadSession;
}

interface ReplaceEndedThreadSessionArgs {
  threadId: string;
  threadSession: ThreadSession;
}

interface ClaudeCodeThreadStopResult {
  ok: true;
}

interface ClaudeCanUseToolDecisionContext {
  blockedPath: string | undefined;
  decisionReason: string | undefined;
  suggestions: ClaudeSuggestedPermissionUpdate[] | undefined;
  toolName: string;
}

interface BuildInteractiveRequestParamsArgs {
  providerThreadId: string;
  threadId: string;
  toolName: string;
  toolUseId: string;
  input: Record<string, unknown>;
  decisionReason: string | undefined;
  promptText: string | undefined;
  blockedPath: string | undefined;
  suggestions: ClaudeSuggestedPermissionUpdate[] | undefined;
}

interface ForwardInteractiveRequestArgs extends BuildInteractiveRequestParamsArgs {
  signal: AbortSignal;
}

interface BuildUserQuestionRequestParamsArgs {
  input: ClaudeUserQuestionInput;
  providerThreadId: string;
  threadId: string;
  toolUseId: string;
}

interface ForwardUserQuestionRequestArgs extends BuildUserQuestionRequestParamsArgs {
  signal: AbortSignal;
}

let sessionSerialCounter = 0;
/**
 * Interactive requests carry a string-prefixed id so they can never collide
 * with the tool-call tracker's numeric request ids on the shared
 * bidirectional channel; the runtime echoes ids opaquely either way.
 */
let interactiveRequestIdCounter = 0;

function nextInteractiveRequestId(): string {
  interactiveRequestIdCounter += 1;
  return `interaction-${interactiveRequestIdCounter}`;
}
/**
 * Skill roots latched by the canonical `skills/configure` request. The runtime
 * configures the process once, before any session exists, and every canonical
 * session built afterwards loads them as local plugins. `null` means the
 * runtime never configured skills for this process.
 */
let configuredSkillRoots: ClaudeCodeSkillRoot[] | null = null;

// Runtime waits on thread/stop until the SDK stream drains or this timeout
// forces the session closed. Stop remains a best-effort success boundary.
const THREAD_STOP_CLOSE_TIMEOUT_MS = 4_000;

const { send, sendResult, sendError } = createBridgeIo<
  SdkMessageNotification | BridgeEventNotification | BridgeToolCallRequest
>();

const sessions = new Map<string, ThreadSession>();
const closingSessions = new Map<string, Promise<void>>();
const toolCallTracker = createPendingToolCallTracker({ sendToolCall: send });
const { forwardToolCall, handleToolCallResponse } = toolCallTracker;

function resolvePendingSessionWork(
  threadSession: ThreadSession,
  message: string,
): void {
  toolCallTracker.resolvePendingToolCalls(threadSession, message);
  resolvePendingInteractiveRequests(threadSession, message);
}

function createForwardToolCall(getThreadId: () => string): ToolCallForwarder {
  return (toolName, args) => {
    const threadId = getThreadId();
    const threadSession = sessions.get(threadId);
    if (!threadSession || threadSession.closing) {
      return Promise.resolve({
        content: "Thread session not found",
        isError: true,
      });
    }
    return forwardToolCall({
      arguments: args,
      providerThreadId: threadSession.providerThreadId ?? threadId,
      scope: threadSession,
      threadId,
      toolName,
    });
  };
}

async function closeThreadSession(args: {
  graceful?: boolean;
  message: string;
  threadId: string;
}): Promise<void> {
  const existingClose = closingSessions.get(args.threadId);
  if (existingClose) {
    return existingClose;
  }

  const threadSession = sessions.get(args.threadId);
  if (!threadSession) {
    return;
  }

  threadSession.closing = true;
  resolvePendingSessionWork(threadSession, args.message);
  const closePromise = Promise.resolve()
    .then(() =>
      closeClaudeThreadSession(threadSession, args.graceful !== false),
    )
    .finally(() => {
      if (sessions.get(args.threadId) === threadSession) {
        sessions.delete(args.threadId);
      }
      closingSessions.delete(args.threadId);
    });
  closingSessions.set(args.threadId, closePromise);
  return closePromise;
}

async function closeThreadSessionsGracefully(message: string): Promise<void> {
  await Promise.all(
    Array.from(sessions.keys()).map((threadId) =>
      closeThreadSession({ graceful: true, message, threadId }),
    ),
  );
}

function normalizePermissionPath(path: string): string {
  return resolvePath(path);
}

function permissionPathCovers(
  grantPath: string,
  requestedPath: string,
): boolean {
  const normalizedGrantPath = normalizePermissionPath(grantPath);
  const normalizedRequestedPath = normalizePermissionPath(requestedPath);
  if (normalizedGrantPath === normalizedRequestedPath) {
    return true;
  }
  const grantPrefix = normalizedGrantPath.endsWith("/")
    ? normalizedGrantPath
    : `${normalizedGrantPath}/`;
  return normalizedRequestedPath.startsWith(grantPrefix);
}

function permissionPathListCovers(
  grantedPaths: string[],
  requestedPaths: string[],
): boolean {
  return requestedPaths.every((requestedPath) =>
    grantedPaths.some((grantedPath) =>
      permissionPathCovers(grantedPath, requestedPath),
    ),
  );
}

function fileSystemPermissionsCover(
  granted: PendingInteractionGrantedPermissionProfile["fileSystem"],
  requested: PendingInteractionGrantedPermissionProfile["fileSystem"],
): boolean {
  if (requested === null) {
    return true;
  }
  if (granted === null) {
    return false;
  }
  const grantedReadPaths = [...granted.read, ...granted.write];
  return (
    permissionPathListCovers(grantedReadPaths, requested.read) &&
    permissionPathListCovers(granted.write, requested.write)
  );
}

function networkPermissionsCover(
  granted: PendingInteractionGrantedPermissionProfile["network"],
  requested: PendingInteractionGrantedPermissionProfile["network"],
): boolean {
  return requested?.enabled === true ? granted?.enabled === true : true;
}

function sessionPermissionGrantCovers(
  args: ClaudeSessionPermissionGrantCoverageArgs,
): boolean {
  if (args.grant.toolName !== null && args.grant.toolName !== args.toolName) {
    return false;
  }
  return (
    networkPermissionsCover(
      args.grant.permissions.network,
      args.permissions.network,
    ) &&
    fileSystemPermissionsCover(
      args.grant.permissions.fileSystem,
      args.permissions.fileSystem,
    )
  );
}

function hasClaudeSessionPermissionGrant(
  args: ClaudeSessionPermissionCoverageArgs,
): boolean {
  return args.grants.some((grant) =>
    sessionPermissionGrantCovers({
      grant,
      permissions: args.permissions,
      toolName: args.toolName,
    }),
  );
}

function shouldCacheClaudeSessionPermission(
  response: ClaudeInteractiveResponse,
): boolean {
  return (
    response.kind === "permission_request" &&
    response.behavior === "allow" &&
    (response.decisionClassification === "user_permanent" ||
      response.updatedPermissions !== undefined)
  );
}

// stdout is the JSON-RPC channel; the runtime captures stderr into the
// provider's diagnostics buffer.
function logBridgeError(message: string): void {
  process.stderr.write(`claude-code bridge: ${message}\n`);
}

function pushPromptInput(
  threadSession: ThreadSession,
  input: string,
  permissionEscalation: PermissionEscalation | null,
): Promise<void> {
  const promptId = randomUUID();
  threadSession.permissionEscalationByPromptId.set(
    promptId,
    permissionEscalation,
  );
  return threadSession.session.pushInput(input, promptId).catch((error) => {
    threadSession.permissionEscalationByPromptId.delete(promptId);
    throw error;
  });
}

async function applyLiveSessionSettings(
  threadSession: ThreadSession,
  threadId: string,
  next: ClaudeLiveSessionSettings,
): Promise<void> {
  const current = threadSession.liveSettings;
  if (current.model !== next.model) {
    await threadSession.session.setModel(next.model);
    seedModelContextWindowHint(threadSession, threadId, next.model);
  }

  if (
    current.memoryEnabled !== next.memoryEnabled ||
    current.reasoningLevel !== next.reasoningLevel ||
    current.workflowsEnabled !== next.workflowsEnabled
  ) {
    await threadSession.session.applyMutableSettings({
      effort:
        next.reasoningLevel === undefined
          ? undefined
          : toSdkEffort(next.reasoningLevel),
      settings: buildMutableFlagSettings({
        memoryEnabled: next.memoryEnabled,
        reasoningLevel: next.reasoningLevel,
        workflowsEnabled: next.workflowsEnabled,
      }),
    });
  }

  threadSession.liveSettings = next;
}

// ---------------------------------------------------------------------------
// Thread-delta emission
// ---------------------------------------------------------------------------

/**
 * Model catalogs change on the order of releases; two minutes is enough to
 * absorb the burst of picker, thread-open, and reconnect asks that hit one
 * bridge, while the server-side memo owns the longer window.
 */
const MODEL_LIST_MEMO_TTL_MS = 2 * 60_000;
const listModelsMemoized = createClaudeCodeBridgeModelListMemo({
  ttlMs: MODEL_LIST_MEMO_TTL_MS,
});

function sendThreadDeltas(
  threadId: string,
  deltas: readonly ThreadDelta[],
): void {
  if (deltas.length === 0) {
    return;
  }
  send({
    jsonrpc: "2.0",
    method: THREAD_DELTA_NOTIFICATION_METHOD,
    params: { threadId, deltas: [...deltas] },
  });
}

/**
 * The provider id-space boundary: a new SDK session was constructed for this
 * thread, so the assembler drops the thread's assembly state (id maps,
 * accumulated usage). Sent right after the construction's thread/identity —
 * identity precedes every thread/delta for the session.
 */
function sendSessionReset(threadId: string): void {
  sendThreadDeltas(threadId, [{ kind: "session.reset" }]);
}

/**
 * The one session-scoped emitter: it runs the Claude-flavored notification
 * through the session translator and emits the parsed semantic deltas as one
 * batched `thread/delta` notification. The `sdk/message` envelope never
 * reaches the wire — it is only the translator's input vocabulary.
 */
function emitForSession(
  threadSession: ThreadSession,
  threadId: string,
  method: string,
  params: Record<string, unknown>,
): void {
  sendThreadDeltas(
    threadId,
    threadSession.translator.translate(
      { jsonrpc: "2.0", method, params },
      { threadId },
    ),
  );
}

function emitSessionError(
  threadSession: ThreadSession,
  threadId: string,
  message: string,
): void {
  // Settle any open translator turn first: every accepted turn reaches
  // exactly one terminal state, and settlement events precede the error
  // signal. Without an open turn the error stays a runtime notification —
  // translating it would fabricate a failed turn bb never accepted.
  if (threadSession.translator.hasOpenTurn(threadId)) {
    emitForSession(threadSession, threadId, "error", { threadId, message });
  }
  send({
    jsonrpc: "2.0",
    method: BRIDGE_NOTIFICATION_METHODS.error,
    params: {
      threadId,
      providerThreadId: threadSession.providerThreadId ?? threadId,
      message,
    },
  });
}

/**
 * Settle a session's in-flight work and announce the rebuild. Mandatory
 * whenever the bridge tears down and rebuilds a live provider session
 * (execution options it cannot apply in place, resume fallback): settlement
 * deltas — the interrupted turn boundary, then the background-task drain
 * (replacing the CLI session kills its tasks with it) — precede the
 * `session/replaced` notification, which is never silent (#1268).
 */
function emitSessionReplacement(args: {
  contextLost: boolean;
  providerThreadId: string | null;
  reason: string;
  threadId: string;
  threadSession: ThreadSession;
}): void {
  sendThreadDeltas(
    args.threadId,
    args.threadSession.translator.buildSessionSettlementDeltas(args.threadId),
  );
  send({
    jsonrpc: "2.0",
    method: BRIDGE_NOTIFICATION_METHODS.sessionReplaced,
    params: {
      threadId: args.threadId,
      providerThreadId: args.providerThreadId,
      reason: args.reason,
      contextLost: args.contextLost,
    },
  });
}

/**
 * Correlate canonical turn input with its bb turn: the acceptance delta is
 * emitted only once the SDK actually consumed the input; the assembler owns
 * the queue-until-turn-opens behavior.
 */
function emitCanonicalTurnInputAccepted(
  threadSession: ThreadSession,
  acceptance: CanonicalTurnAcceptance,
  threadId: string,
): void {
  sendThreadDeltas(
    threadId,
    threadSession.translator.acceptInput(threadId, acceptance.clientRequestId),
  );
}

function sendThreadIdentity(threadId: string, providerThreadId: string): void {
  send({
    jsonrpc: "2.0",
    method: "thread/identity",
    params: {
      threadId,
      providerThreadId,
      // Refines the handshake's sessionRestore per session: Claude sessions
      // persist (persistSession) and reopen via SDK resume.
      sessionRestorable: true,
    },
  });
}

function nextSessionSerial(): number {
  sessionSerialCounter += 1;
  return sessionSerialCounter;
}

function toSessionConstructionConfig(
  params: SessionConstructionParams,
): SessionConstructionConfig {
  return {
    config: params.config,
    dynamicTools: params.dynamicTools,
    sessionOptions: {
      additionalWorkspaceWriteRoots: params.additionalWorkspaceWriteRoots,
      baseInstructions: params.baseInstructions,
      cwd: params.cwd,
      disallowedTools: params.disallowedTools,
      instructionMode: params.instructionMode,
      permissionMode: params.permissionMode,
      permissionScope: params.permissionScope,
      plugins: params.plugins,
    },
  };
}

function toInitialLiveSessionSettings(
  params: SessionConstructionParams,
): ClaudeLiveSessionSettings {
  return {
    memoryEnabled: params.memoryEnabled ?? true,
    ...(params.model !== undefined ? { model: params.model } : {}),
    providerSubagentsEnabled: params.providerSubagentsEnabled ?? true,
    ...(params.reasoningLevel !== undefined
      ? { reasoningLevel: params.reasoningLevel }
      : {}),
    workflowsEnabled: params.workflowsEnabled,
  };
}

function withTurnLiveSessionSettings(
  current: ClaudeLiveSessionSettings,
  params: TurnStartParams | TurnSteerParams,
): ClaudeLiveSessionSettings {
  const model = params.model ?? current.model;
  const reasoningLevel = params.reasoningLevel ?? current.reasoningLevel;
  return {
    memoryEnabled: params.memoryEnabled ?? current.memoryEnabled,
    ...(model !== undefined ? { model } : {}),
    providerSubagentsEnabled:
      params.providerSubagentsEnabled ?? current.providerSubagentsEnabled,
    ...(reasoningLevel !== undefined ? { reasoningLevel } : {}),
    workflowsEnabled: params.workflowsEnabled ?? current.workflowsEnabled,
  };
}

function withTrackedPermissionEscalation(
  params: SessionConstructionParams,
  threadIdRef: ThreadIdRef,
): BuildSessionOptionsArgs {
  return {
    ...toSessionConstructionConfig(params).sessionOptions,
    ...toInitialLiveSessionSettings(params),
    getPermissionEscalation: (context) => {
      const threadSession = sessions.get(threadIdRef.current);
      return threadSession
        ? resolvePermissionEscalationForWork(threadSession, context)
        : null;
    },
  };
}

/**
 * Seed the translator's context-window fallback from the selected model.
 *
 * Claude reports `modelUsage.contextWindow` on some results and omits it on
 * others; when it is missing the translator falls back to the capacity implied
 * by the model id (notably the 1M `[1m]` aliases). The bridge seeds the hint
 * here, on every session construction and every turn that carries a model —
 * without it, capacity reads as unknown whenever Claude omits the field.
 */
function seedModelContextWindowHint(
  threadSession: ThreadSession,
  threadId: string,
  model: string | undefined,
): void {
  if (model === undefined) {
    return;
  }
  threadSession.translator.setClaudeModelContextWindowHint(threadId, model);
}

function createThreadSession(args: CreateThreadSessionArgs): ThreadSession {
  const sessionSerial = nextSessionSerial();
  const session = new SdkSession(
    args.sessionOptions,
    createOnSdkMessage({
      sessionSerial,
      threadIdRef: args.threadIdRef,
    }),
    createOnSdkDone({
      sessionSerial,
      threadIdRef: args.threadIdRef,
    }),
  );

  const threadSession: ThreadSession = {
    session,
    sessionConstructionConfig: args.sessionConstructionConfig,
    sessionOptions: args.sessionOptions,
    sessionSerial,
    closing: false,
    streamEnded: false,
    translator: createClaudeDeltaTranslator(),
    pendingInteractiveRequests: new Map(),
    permissionEscalation: args.permissionEscalation,
    permissionEscalationByAgentId: new Map(),
    permissionEscalationByPromptId: new Map(),
    permissionEscalationBySubagentParentToolUseId: new Map(),
    permissionEscalationByToolUseId: new Map(),
    permissionMode: args.permissionMode,
    liveSettings: args.liveSettings,
    approvedPlanPermissionMode: args.approvedPlanPermissionMode,
    ...(args.providerThreadId
      ? { providerThreadId: args.providerThreadId }
      : {}),
    sessionPermissionGrants: [...(args.sessionPermissionGrants ?? [])],
    threadIdRef: args.threadIdRef,
  };
  seedModelContextWindowHint(
    threadSession,
    args.threadIdRef.current,
    args.liveSettings.model,
  );
  return threadSession;
}

function getTrackedPermissionEscalation(
  values: Map<string, PermissionEscalation | null>,
  key: string | undefined,
): PermissionEscalation | null | undefined {
  if (key === undefined || !values.has(key)) {
    return undefined;
  }
  return values.get(key) ?? null;
}

function resolvePermissionEscalationForWork(
  threadSession: ThreadSession,
  context: PermissionEscalationWorkContext,
): PermissionEscalation | null {
  const toolPermissionEscalation = getTrackedPermissionEscalation(
    threadSession.permissionEscalationByToolUseId,
    context.toolUseId,
  );
  if (toolPermissionEscalation !== undefined) {
    return toolPermissionEscalation;
  }

  const agentPermissionEscalation = getTrackedPermissionEscalation(
    threadSession.permissionEscalationByAgentId,
    context.agentId,
  );
  if (agentPermissionEscalation !== undefined) {
    return agentPermissionEscalation;
  }

  const promptPermissionEscalation = getTrackedPermissionEscalation(
    threadSession.permissionEscalationByPromptId,
    context.promptId,
  );
  return promptPermissionEscalation === undefined
    ? threadSession.permissionEscalation
    : promptPermissionEscalation;
}

function trackSdkAssistantPermissionEscalation(
  threadSession: ThreadSession,
  message: SDKMessage,
): void {
  if (message.type !== "assistant") {
    return;
  }

  const parentToolUseId = message.parent_tool_use_id ?? undefined;
  const parentPermissionEscalation = getTrackedPermissionEscalation(
    threadSession.permissionEscalationBySubagentParentToolUseId,
    parentToolUseId,
  );
  const permissionEscalation =
    parentPermissionEscalation === undefined
      ? threadSession.permissionEscalation
      : parentPermissionEscalation;

  for (const content of message.message.content) {
    if (content.type !== "tool_use") {
      continue;
    }
    threadSession.permissionEscalationByToolUseId.set(
      content.id,
      permissionEscalation,
    );
    if (CLAUDE_PROVIDER_SUBAGENT_TOOL_NAMES.has(content.name)) {
      threadSession.permissionEscalationBySubagentParentToolUseId.set(
        content.id,
        permissionEscalation,
      );
    }
  }
}

function buildPermissionEscalationTrackingHooks(
  threadIdRef: ThreadIdRef,
): NonNullable<SdkSessionOptions["hooks"]> {
  const trackPermissionRequest: HookCallback = async (input, toolUseId) => {
    if (
      input.hook_event_name !== "PermissionRequest" ||
      toolUseId === undefined
    ) {
      return { continue: true };
    }
    const threadSession = sessions.get(threadIdRef.current);
    if (threadSession) {
      // Claude can omit agentID from the later canUseTool callback. Preserve
      // the work's provenance at the permission boundary, where the hook
      // still carries its agent/prompt metadata.
      threadSession.permissionEscalationByToolUseId.set(
        toolUseId,
        resolvePermissionEscalationForWork(threadSession, {
          ...(input.agent_id !== undefined ? { agentId: input.agent_id } : {}),
          ...(input.prompt_id !== undefined
            ? { promptId: input.prompt_id }
            : {}),
        }),
      );
    }
    return { continue: true };
  };

  const trackPreToolUse: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") {
      return { continue: true };
    }
    const threadSession = sessions.get(threadIdRef.current);
    if (threadSession) {
      const permissionEscalation = resolvePermissionEscalationForWork(
        threadSession,
        {
          ...(input.agent_id !== undefined ? { agentId: input.agent_id } : {}),
          ...(input.prompt_id !== undefined
            ? { promptId: input.prompt_id }
            : {}),
        },
      );
      threadSession.permissionEscalationByToolUseId.set(
        input.tool_use_id,
        permissionEscalation,
      );
      if (CLAUDE_PROVIDER_SUBAGENT_TOOL_NAMES.has(input.tool_name)) {
        threadSession.permissionEscalationBySubagentParentToolUseId.set(
          input.tool_use_id,
          permissionEscalation,
        );
      }
      if (
        !threadSession.liveSettings.providerSubagentsEnabled &&
        CLAUDE_PROVIDER_SUBAGENT_TOOL_NAMES.has(input.tool_name)
      ) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              "bb has disabled Claude Code native subagents; use bb delegation instead.",
          },
        };
      }
      if (
        !threadSession.liveSettings.workflowsEnabled &&
        input.tool_name === CLAUDE_WORKFLOW_TOOL_NAME
      ) {
        return {
          continue: true,
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason:
              "bb has disabled the Claude Code Workflow tool.",
          },
        };
      }
    }
    return { continue: true };
  };

  const trackSubagentStart: HookCallback = async (input) => {
    if (input.hook_event_name !== "SubagentStart") {
      return { continue: true };
    }
    const threadSession = sessions.get(threadIdRef.current);
    if (threadSession) {
      threadSession.permissionEscalationByAgentId.set(
        input.agent_id,
        resolvePermissionEscalationForWork(threadSession, {
          ...(input.prompt_id !== undefined
            ? { promptId: input.prompt_id }
            : {}),
        }),
      );
    }
    return { continue: true };
  };

  const clearSubagent: HookCallback = async (input) => {
    if (input.hook_event_name === "SubagentStop") {
      sessions
        .get(threadIdRef.current)
        ?.permissionEscalationByAgentId.delete(input.agent_id);
    }
    return { continue: true };
  };

  const clearToolUse: HookCallback = async (input) => {
    if (
      input.hook_event_name === "PostToolUse" ||
      input.hook_event_name === "PostToolUseFailure" ||
      input.hook_event_name === "PermissionDenied"
    ) {
      sessions
        .get(threadIdRef.current)
        ?.permissionEscalationByToolUseId.delete(input.tool_use_id);
    }
    return { continue: true };
  };

  return {
    PermissionDenied: [{ hooks: [clearToolUse] }],
    PermissionRequest: [{ hooks: [trackPermissionRequest] }],
    PostToolUse: [{ hooks: [clearToolUse] }],
    PostToolUseFailure: [{ hooks: [clearToolUse] }],
    PreToolUse: [{ hooks: [trackPreToolUse] }],
    SubagentStart: [{ hooks: [trackSubagentStart] }],
    SubagentStop: [{ hooks: [clearSubagent] }],
  };
}

function addPermissionEscalationTrackingHooks(
  sessionOptions: SdkSessionOptions,
  threadIdRef: ThreadIdRef,
): void {
  const existingHooks = sessionOptions.hooks;
  const trackingHooks = buildPermissionEscalationTrackingHooks(threadIdRef);
  // PreToolUse tracking must run before enforcement hooks so those hooks can
  // resolve the tool ID back to the prompt or subagent that originated it.
  sessionOptions.hooks = {
    ...existingHooks,
    PermissionDenied: [
      ...(trackingHooks.PermissionDenied ?? []),
      ...(existingHooks?.PermissionDenied ?? []),
    ],
    PermissionRequest: [
      ...(trackingHooks.PermissionRequest ?? []),
      ...(existingHooks?.PermissionRequest ?? []),
    ],
    PostToolUse: [
      ...(trackingHooks.PostToolUse ?? []),
      ...(existingHooks?.PostToolUse ?? []),
    ],
    PostToolUseFailure: [
      ...(trackingHooks.PostToolUseFailure ?? []),
      ...(existingHooks?.PostToolUseFailure ?? []),
    ],
    PreToolUse: [
      ...(trackingHooks.PreToolUse ?? []),
      ...(existingHooks?.PreToolUse ?? []),
    ],
    SubagentStart: [
      ...(trackingHooks.SubagentStart ?? []),
      ...(existingHooks?.SubagentStart ?? []),
    ],
    SubagentStop: [
      ...(trackingHooks.SubagentStop ?? []),
      ...(existingHooks?.SubagentStop ?? []),
    ],
  };
}

function buildTrackedSessionOptions(
  params: SessionConstructionParams,
  env: NodeJS.ProcessEnv,
  threadIdRef: ThreadIdRef,
): SdkSessionOptions {
  const sessionOptions = buildSessionOptions(
    withTrackedPermissionEscalation(params, threadIdRef),
    env,
  );
  addPermissionEscalationTrackingHooks(sessionOptions, threadIdRef);
  return sessionOptions;
}

function replaceThreadSession(args: ReplaceThreadSessionArgs): void {
  args.threadSession.closing = true;
  resolvePendingSessionWork(args.threadSession, args.reason);
  // Canonical sessions settle in-flight work and announce the rebuild before
  // any replacement-session traffic; the replacement resumes the same
  // provider session id, so provider-side context survives.
  emitSessionReplacement({
    contextLost: false,
    providerThreadId: args.providerThreadId,
    reason: args.reason,
    threadId: args.threadId,
    threadSession: args.threadSession,
  });
  args.threadSession.session.stop();

  // This is not a user-requested thread close: the thread remains active and
  // immediately owns the replacement session. `closingSessions` only gates
  // external stop/replace requests, so a stop after this point should target
  // the replacement, not wait on the poisoned resume session.
  sessions.set(args.threadId, args.replacementSession);
  args.replacementSession.session.start(args.providerThreadId);
  sendThreadIdentity(args.threadId, args.providerThreadId);
  sendSessionReset(args.threadId);
}

function replaceEndedThreadSession(
  args: ReplaceEndedThreadSessionArgs,
): ThreadSession | undefined {
  const providerThreadId =
    args.threadSession.providerThreadId ??
    args.threadSession.session.getSessionId();
  if (!providerThreadId) {
    return undefined;
  }

  const replacementSession = createThreadSession({
    liveSettings: args.threadSession.liveSettings,
    permissionEscalation: args.threadSession.permissionEscalation,
    // Carries the live mode, so a session replaced after an approved plan
    // keeps the restored preset instead of dropping back into Plan mode.
    permissionMode: args.threadSession.permissionMode,
    approvedPlanPermissionMode: args.threadSession.approvedPlanPermissionMode,
    providerThreadId,
    sessionConstructionConfig: args.threadSession.sessionConstructionConfig,
    sessionOptions: args.threadSession.sessionOptions,
    sessionPermissionGrants: args.threadSession.sessionPermissionGrants,
    threadIdRef: args.threadSession.threadIdRef,
  });

  replaceThreadSession({
    providerThreadId,
    replacementSession,
    reason: "Thread session replaced after Claude SDK stream ended",
    threadId: args.threadId,
    threadSession: args.threadSession,
  });
  return replacementSession;
}

function getWritableThreadSession(threadId: string): ThreadSession | undefined {
  const threadSession = sessions.get(threadId);
  if (!threadSession || threadSession.closing) {
    return undefined;
  }
  if (!threadSession.streamEnded) {
    return threadSession;
  }
  return replaceEndedThreadSession({ threadId, threadSession });
}

function getCurrentThreadSession(
  args: CurrentThreadSessionArgs,
): ThreadSession | undefined {
  const threadSession = sessions.get(args.threadId);
  if (
    !threadSession ||
    threadSession.closing ||
    threadSession.sessionSerial !== args.sessionSerial
  ) {
    return undefined;
  }
  return threadSession;
}

function createOnSdkMessage(
  args: CreateSdkCallbackArgs,
): (message: SDKMessage) => void {
  return (message: SDKMessage) => {
    const threadSession = getCurrentThreadSession({
      sessionSerial: args.sessionSerial,
      threadId: args.threadIdRef.current,
    });
    if (!threadSession) return;
    const providerThreadId = message.session_id?.trim() ?? "";
    if (
      providerThreadId.length > 0 &&
      threadSession.providerThreadId !== providerThreadId
    ) {
      threadSession.providerThreadId = providerThreadId;
      sendThreadIdentity(args.threadIdRef.current, providerThreadId);
    }
    trackSdkAssistantPermissionEscalation(threadSession, message);
    emitForSession(threadSession, args.threadIdRef.current, "sdk/message", {
      threadId: args.threadIdRef.current,
      message,
    });
  };
}

function createOnSdkDone(
  args: CreateSdkCallbackArgs,
): (error?: unknown) => void {
  return (error?: unknown) => {
    const threadSession = getCurrentThreadSession({
      sessionSerial: args.sessionSerial,
      threadId: args.threadIdRef.current,
    });
    if (!threadSession) return;

    threadSession.streamEnded = true;
    resolvePendingSessionWork(
      threadSession,
      "Claude SDK stream ended before pending work completed",
    );

    if (!error) return;

    const message = error instanceof Error ? error.message : String(error);

    emitSessionError(threadSession, args.threadIdRef.current, message);
  };
}

function findSessionByPendingInteractiveRequest(
  id: string | number,
): ThreadSession | undefined {
  for (const session of sessions.values()) {
    if (session.pendingInteractiveRequests.has(id)) {
      return session;
    }
  }

  return undefined;
}

function resolvePendingInteractiveRequests(
  threadSession: ThreadSession,
  message: string,
): void {
  for (const [requestId, pending] of threadSession.pendingInteractiveRequests) {
    threadSession.pendingInteractiveRequests.delete(requestId);
    pending.resolve({
      behavior: "deny",
      interrupt: true,
      message,
      toolUseID: pending.itemId,
    });
  }
}

async function closeClaudeThreadSession(
  threadSession: ThreadSession,
  graceful: boolean,
): Promise<void> {
  if (graceful) {
    await threadSession.session.closeGracefully(THREAD_STOP_CLOSE_TIMEOUT_MS);
  } else {
    threadSession.session.stop();
  }
}

/**
 * Builds the environment for an SDK-spawned Claude session so its API traffic
 * presents like the headless Claude CLI (`claude -p`) instead of a third-party
 * SDK app.
 *
 * - `CLAUDE_CODE_ENTRYPOINT=cli` makes the session report `cc_entrypoint=sdk-cli`
 *   and a `(external, sdk-cli, ...)` user-agent. The Agent SDK only defaults
 *   this to `sdk-ts` when it is unset, so we set it explicitly. The spawned
 *   binary always adds the `sdk-` prefix (and an `agent-sdk/<version>`
 *   user-agent segment) because it runs in stream-json mode, so the interactive
 *   `cli` entrypoint is not reachable from the SDK.
 * - Omitting `CLAUDE_AGENT_SDK_CLIENT_APP` drops the `client-app/...` user-agent
 *   segment, matching the CLI. The delete also clears any value inherited from a
 *   parent SDK process.
 */
function buildSessionEnv(
  envOverrides: Record<string, string>,
): NodeJS.ProcessEnv {
  const sessionEnv: NodeJS.ProcessEnv = {
    ...withoutBridgeRuntimeEnv(process.env),
    ...envOverrides,
    CLAUDE_CODE_ENTRYPOINT: "cli",
  };
  delete sessionEnv.CLAUDE_AGENT_SDK_CLIENT_APP;
  return sessionEnv;
}

const sessionConfigEnvVarsSchema = z.record(z.string(), z.string());

/** The bridge end of `buildClaudeCodeConfig`'s plugin-internal config bag. */
function readConfigEnvOverrides(
  config: Record<string, unknown> | undefined,
): Record<string, string> {
  const parsed = sessionConfigEnvVarsSchema.safeParse(config?.["envVars"]);
  return parsed.success ? parsed.data : {};
}

function parseClaudeSuggestedPermissionUpdates(
  value: unknown,
): ClaudeSuggestedPermissionUpdate[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsedUpdates = value.flatMap((entry) => {
    const parsed = claudeSuggestedPermissionUpdateSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });

  return parsedUpdates.length > 0 ? parsedUpdates : undefined;
}

function buildInteractiveRequestParams(
  args: BuildInteractiveRequestParamsArgs,
): ClaudePermissionRequestApprovalParams {
  return {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    turnId: null,
    itemId: args.toolUseId,
    toolName: args.toolName,
    input: args.input,
    // Claude explains some prompts through decisionReason and others only
    // through the prompt sentence it would have rendered itself. The sandbox
    // network prompt uses the second: without it the banner names the tool but
    // never the host, and the user cannot judge what they are granting.
    reason: args.decisionReason ?? args.promptText ?? null,
    permissions: toPendingInteractionPermissionProfile({
      toolName: args.toolName,
      blockedPath: args.blockedPath,
      suggestions: args.suggestions,
    }),
  };
}

function buildUserQuestionRequestParams(
  args: BuildUserQuestionRequestParamsArgs,
): ClaudeUserQuestionRequestParams {
  return {
    threadId: args.threadId,
    providerThreadId: args.providerThreadId,
    turnId: null,
    itemId: args.toolUseId,
    questions: args.input.questions,
  };
}

/**
 * Decode an interactive-request response: it carries the canonical
 * `PendingInteractionResolution`, which maps back through the interactions
 * module. Null means undecodable (or a resolution kind that does not match
 * the payload) and settles as a deny.
 */
function decodePendingInteractiveResponse(
  pending: PendingInteractiveRequest,
  result: unknown,
): ClaudeInteractiveResponse | null {
  const resolution = pendingInteractionResolutionSchema.safeParse(result);
  if (!resolution.success) {
    return null;
  }
  try {
    return buildClaudeInteractiveResponse({
      payload: pending.payload,
      resolution: resolution.data,
    });
  } catch {
    return null;
  }
}

function buildInteractivePermissionResult(
  pending: PendingInteractiveRequest,
  response: ClaudeInteractiveResponse,
): PermissionResult {
  switch (pending.kind) {
    case "permission_request":
      if (response.kind !== "permission_request") {
        return {
          behavior: "deny",
          message: "Interactive response kind mismatch",
          toolUseID: pending.itemId,
        };
      }
      if (response.behavior === "deny") {
        return {
          behavior: "deny",
          message: response.message,
          ...(response.interrupt === undefined
            ? {}
            : { interrupt: response.interrupt }),
          ...(response.decisionClassification === undefined
            ? {}
            : { decisionClassification: response.decisionClassification }),
          toolUseID: pending.itemId,
        };
      }
      return {
        behavior: "allow",
        updatedInput: pending.originalInput,
        ...(response.updatedPermissions === undefined
          ? {}
          : { updatedPermissions: response.updatedPermissions }),
        ...(response.decisionClassification === undefined
          ? {}
          : { decisionClassification: response.decisionClassification }),
        toolUseID: pending.itemId,
      };
    case "user_question":
      if (response.kind !== "user_question") {
        return {
          behavior: "deny",
          message: "Interactive response kind mismatch",
          toolUseID: pending.itemId,
        };
      }
      return {
        behavior: "allow",
        updatedInput: response.updatedInput,
        toolUseID: pending.itemId,
      };
  }
}

function createForwardInteractiveRequest(
  threadIdRef: ThreadIdRef,
): (args: ForwardInteractiveRequestArgs) => Promise<PermissionResult> {
  return (args) =>
    new Promise<PermissionResult>((resolve) => {
      const threadSession = sessions.get(threadIdRef.current);
      if (!threadSession) {
        resolve({
          behavior: "deny",
          message: "Thread session not found",
          toolUseID: args.toolUseId,
        });
        return;
      }

      let params: ClaudePermissionRequestApprovalParams;
      try {
        params = buildInteractiveRequestParams(args);
      } catch (error) {
        resolve({
          behavior: "deny",
          message: error instanceof Error ? error.message : String(error),
          toolUseID: args.toolUseId,
        });
        return;
      }

      const requestId = nextInteractiveRequestId();

      const finish = (result: PermissionResult): void => {
        args.signal.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const onAbort = (): void => {
        if (!threadSession.pendingInteractiveRequests.delete(requestId)) {
          return;
        }
        finish({
          behavior: "deny",
          message: "Interactive request cancelled",
          toolUseID: args.toolUseId,
        });
      };

      // The session carries the PendingInteractionPayload out as
      // interaction/request and maps the resolution back through it.
      const payload = buildClaudeApprovalInteractionPayload(params);

      args.signal.addEventListener("abort", onAbort, { once: true });
      threadSession.pendingInteractiveRequests.set(requestId, {
        itemId: args.toolUseId,
        kind: "permission_request",
        payload,
        originalInput: args.input,
        permissions: params.permissions,
        resolve: finish,
        toolName: args.toolName,
      });

      // The approval subject's item id is claude's native tool-use id and the
      // bridge holds no bb turn ids: the runtime adapter translates the ids
      // through the delta assembler's maps and resolves the turn from its own
      // active-turn state (turnId: null).
      send({
        jsonrpc: "2.0",
        id: requestId,
        method: BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest,
        params: {
          threadId: args.threadId,
          providerThreadId: args.providerThreadId,
          turnId: null,
          providerNativeIds: true,
          payload,
        },
      });
    });
}

function createForwardUserQuestionRequest(
  threadIdRef: ThreadIdRef,
): (args: ForwardUserQuestionRequestArgs) => Promise<PermissionResult> {
  return (args) =>
    new Promise<PermissionResult>((resolve) => {
      const threadSession = sessions.get(threadIdRef.current);
      if (!threadSession) {
        resolve({
          behavior: "deny",
          message: "Thread session not found",
          toolUseID: args.toolUseId,
        });
        return;
      }

      const params = buildUserQuestionRequestParams(args);
      const requestId = nextInteractiveRequestId();

      const finish = (result: PermissionResult): void => {
        args.signal.removeEventListener("abort", onAbort);
        resolve(result);
      };

      const onAbort = (): void => {
        if (!threadSession.pendingInteractiveRequests.delete(requestId)) {
          return;
        }
        finish({
          behavior: "deny",
          message: "User question request cancelled",
          toolUseID: args.toolUseId,
        });
      };

      const payload = buildClaudeUserQuestionPayload(params);

      args.signal.addEventListener("abort", onAbort, { once: true });
      threadSession.pendingInteractiveRequests.set(requestId, {
        itemId: args.toolUseId,
        kind: "user_question",
        payload,
        resolve: finish,
      });

      // The approval subject's item id is claude's native tool-use id and the
      // bridge holds no bb turn ids: the runtime adapter translates the ids
      // through the delta assembler's maps and resolves the turn from its own
      // active-turn state (turnId: null).
      send({
        jsonrpc: "2.0",
        id: requestId,
        method: BRIDGE_INBOUND_REQUEST_METHODS.interactionRequest,
        params: {
          threadId: args.threadId,
          providerThreadId: args.providerThreadId,
          turnId: null,
          providerNativeIds: true,
          payload,
        },
      });
    });
}

/**
 * Leave Plan mode once the user approves a plan.
 *
 * `/plan` overrides the session permission mode for the life of the session:
 * `turn/start` carries no mode, so nothing restores the user's preset on a
 * later turn. Without this the agent keeps Plan mode's gating after the plan
 * is approved, and a full-access thread is asked to approve every edit it
 * already allowed.
 */
function restoreApprovedPlanPermissionMode(threadSession: ThreadSession): void {
  if (
    threadSession.permissionMode === threadSession.approvedPlanPermissionMode
  ) {
    return;
  }
  threadSession.permissionMode = threadSession.approvedPlanPermissionMode;
  void threadSession.session
    .setPermissionMode(threadSession.approvedPlanPermissionMode)
    .catch((error: unknown) => {
      // bb's own canUseTool gate already follows the restored mode, so a
      // refused control request costs the session Claude's native gating
      // alignment, not the user's preset.
      logBridgeError(
        `Failed to leave Plan mode: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

function createCanUseTool(threadIdRef: ThreadIdRef): CanUseTool {
  const forwardInteractiveRequest =
    createForwardInteractiveRequest(threadIdRef);
  const forwardUserQuestionRequest =
    createForwardUserQuestionRequest(threadIdRef);

  return async (toolName, input, options) => {
    // Claude can dispatch canUseTool while the preceding assistant tool-use
    // message is queued for the SDK async iterator. Give the stream consumer
    // one turn to record its parent-tool provenance before resolving policy.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const threadSession = sessions.get(threadIdRef.current);
    if (!threadSession) {
      return {
        behavior: "deny",
        message: "Thread session not found",
        toolUseID: options.toolUseID,
      };
    }

    if (toolName === CLAUDE_USER_QUESTION_TOOL_NAME) {
      const parsedInput = claudeUserQuestionInputSchema.safeParse(input);
      if (!parsedInput.success) {
        return {
          behavior: "deny",
          message: "Invalid AskUserQuestion input",
          toolUseID: options.toolUseID,
        };
      }
      return forwardUserQuestionRequest({
        threadId: threadIdRef.current,
        providerThreadId: threadSession.providerThreadId ?? threadIdRef.current,
        toolUseId: options.toolUseID,
        input: parsedInput.data,
        signal: options.signal,
      });
    }

    // Like AskUserQuestion, this tool call is the prompt itself rather than a
    // guard on a side effect, so it must reach the user before any of the
    // policy shortcuts below. `/plan` also overrides the session permission
    // mode, so a "full" preset does not mean the user waived plan review.
    if (toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME) {
      if (!claudeExitPlanModeInputSchema.safeParse(input).success) {
        return {
          behavior: "deny",
          message: "Invalid ExitPlanMode input",
          toolUseID: options.toolUseID,
        };
      }
      return forwardInteractiveRequest({
        threadId: threadIdRef.current,
        providerThreadId: threadSession.providerThreadId ?? threadIdRef.current,
        toolName,
        toolUseId: options.toolUseID,
        input,
        decisionReason: undefined,
        promptText: undefined,
        blockedPath: undefined,
        suggestions: undefined,
        signal: options.signal,
      });
    }

    const interactiveRequestPolicy = {
      permissionEscalation: resolvePermissionEscalationForWork(threadSession, {
        ...(options.agentID !== undefined ? { agentId: options.agentID } : {}),
        toolUseId: options.toolUseID,
      }),
    };
    const suggestions = parseClaudeSuggestedPermissionUpdates(
      options.suggestions,
    );

    const requestContext: ClaudeCanUseToolDecisionContext = {
      toolName,
      blockedPath: options.blockedPath,
      decisionReason: options.decisionReason,
      suggestions,
    };
    const requestedPermissions =
      toPendingInteractionPermissionProfile(requestContext);
    if (
      toolName === "Bash" &&
      shouldAutoDenyInteractiveRequest(interactiveRequestPolicy) &&
      typeof input === "object" &&
      input !== null &&
      (input as { dangerouslyDisableSandbox?: unknown })
        .dangerouslyDisableSandbox === true
    ) {
      // With `allowUnsandboxedCommands` permanently enabled, this deny is the
      // only gate on the unsandboxed retry for escalation-denied turns. It must
      // run before the session-grant shortcut: grants survive escalation flips
      // now that an escalation-only change reuses the session.
      return {
        behavior: "deny",
        message: buildWorkspaceWriteDenialMessage(),
        toolUseID: options.toolUseID,
      };
    }
    if (
      hasClaudeSessionPermissionGrant({
        grants: threadSession.sessionPermissionGrants,
        permissions: requestedPermissions,
        toolName,
      })
    ) {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID,
        decisionClassification: "user_permanent",
      };
    }

    if (
      toolName === "Bash" &&
      (threadSession.permissionMode === "default" ||
        threadSession.permissionMode === "dontAsk")
    ) {
      // Defensive mirror of the readonly PreToolUse allowlist: Claude may still
      // call canUseTool after hook input rewriting, and safe policy allows are
      // not user decisions, so no decisionClassification is attached.
      const updatedInput = buildReadonlyBashUpdatedInput(input);
      if (updatedInput) {
        return {
          behavior: "allow",
          updatedInput,
          toolUseID: options.toolUseID,
        };
      }
    }

    const shouldRequestApproval =
      shouldRequestClaudePermissionApproval(requestContext) ||
      (options.suggestions?.length ?? 0) > 0;

    if (!shouldRequestApproval) {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID,
      };
    }

    if (threadSession.permissionMode === "bypassPermissions") {
      return {
        behavior: "allow",
        updatedInput: input,
        toolUseID: options.toolUseID,
      };
    }

    if (
      shouldAutoDenyInteractiveRequest(interactiveRequestPolicy) ||
      threadSession.permissionMode === "dontAsk"
    ) {
      const policyMessage =
        threadSession.permissionMode === "acceptEdits" ||
        threadSession.permissionMode === "auto"
          ? buildWorkspaceWriteDenialMessage()
          : buildReadonlyDenialMessage();
      return {
        behavior: "deny",
        message: options.decisionReason ?? policyMessage,
        toolUseID: options.toolUseID,
      };
    }

    return forwardInteractiveRequest({
      threadId: threadIdRef.current,
      providerThreadId: threadSession.providerThreadId ?? threadIdRef.current,
      toolName,
      toolUseId: options.toolUseID,
      input,
      decisionReason: options.decisionReason,
      promptText: options.title ?? options.description,
      blockedPath: options.blockedPath,
      suggestions,
      signal: options.signal,
    });
  };
}

async function handleRequest(request: ClaudeCodeJsonRpcRequest): Promise<void> {
  switch (request.method) {
    case "initialize":
      // The canonical handshake (@bb/provider-bridge-protocol): the bridge
      // reports the session-behavior facts its own code implements.
      // sessionRestore is true — sessions persist (persistSession) and
      // SdkSession.start(resumeSessionId) reopens them via SDK resume.
      // fork is "checkpoint" — thread/fork maps
      // sourceProviderCheckpointId onto forkSession's upToMessageId.
      // approvalEnforcedBy is "provider" — canUseTool pre-filters
      // approvals in this bridge (policy shortcuts above the forward), so
      // every forwarded request already needs user input and the runtime
      // must not reclassify it (#1236).
      // Typed so a capability rename cannot silently degrade this bridge:
      // an unrenamed key would be missing from InitializeResult, not
      // defaulted false.
      const result: InitializeResult = {
        protocolVersion: PROVIDER_BRIDGE_PROTOCOL_VERSION,
        capabilities: {
          sessionRestore: true,
          threadArchive: false,
          threadRename: false,
          threadGoalClear: false,
          fork: "checkpoint",
          approvalEnforcedBy: "provider",
        },
      };
      sendResult(request.id, result);
      break;
    case "model/list":
      sendResult(request.id, await listModelsMemoized());
      break;
    case "provider/health":
      sendResult(request.id, await getClaudeProviderHealth());
      break;
    case "provider/usage":
      sendResult(request.id, await getClaudeProviderUsage());
      break;
    case "thread/start":
      await handleThreadStart(
        request.id,
        claudeThreadStartParamsSchema.parse(
          toClaudeSessionParams(request.params),
        ),
      );
      break;
    case "thread/resume":
      await handleThreadResume(
        request.id,
        claudeThreadResumeParamsSchema.parse({
          ...toClaudeSessionParams(request.params),
          providerThreadId: request.params.providerThreadId,
        }),
      );
      break;
    case "thread/fork":
      // Claude supports checkpoint forks natively:
      // sourceProviderCheckpointId maps onto forkSession's upToMessageId.
      await handleThreadFork(
        request.id,
        claudeThreadForkParamsSchema.parse({
          ...toClaudeSessionParams(request.params),
          sourceProviderThreadId: request.params.sourceProviderThreadId,
          ...(request.params.sourceProviderCheckpointId !== undefined
            ? {
                sourceProviderCheckpointId:
                  request.params.sourceProviderCheckpointId,
              }
            : {}),
        }),
      );
      break;
    case "turn/start":
      await handleTurnStart(request.id, request.params);
      break;
    case "turn/steer":
      await handleTurnSteer(request.id, request.params);
      break;
    case "thread/stop":
      await handleThreadStop(request.id, request.params);
      break;
    case "thread/discard":
      // Claude has no provider-side thread deletion; discard closes any live
      // session for the thread and succeeds.
      sendResult(request.id, await closeThreadForStop(request.params.threadId));
      break;
    case "skills/configure":
      // Claude loads staged skill roots as local plugins; the SDK takes them
      // at session construction only, so the payload is latched here and
      // applied to every session started afterwards.
      configuredSkillRoots = request.params.roots.map((root) => ({
        id: root.id,
        localPluginPath: root.path,
      }));
      sendResult(request.id, { ok: true });
      break;
  }
}

async function handleThreadStart(
  id: string | number,
  params: ThreadStartParams,
): Promise<void> {
  const threadIdRef = { current: params.threadId };

  const existing = sessions.get(threadIdRef.current);
  if (existing) {
    await closeThreadSession({
      graceful: false,
      message: "Thread session replaced while awaiting permission approval",
      threadId: threadIdRef.current,
    });
  }

  const env = buildSessionEnv(readConfigEnvOverrides(params.config));
  const sessionOptions = buildTrackedSessionOptions(params, env, threadIdRef);
  const providerThreadId = randomUUID();
  sessionOptions.sessionId = providerThreadId;
  sessionOptions.canUseTool = createCanUseTool(threadIdRef);
  if (params.dynamicTools && params.dynamicTools.length > 0) {
    const mcpServer = buildBridgeMcpServer(
      params.dynamicTools,
      createForwardToolCall(() => threadIdRef.current),
    );
    sessionOptions.mcpServers = { [BRIDGE_MCP_SERVER_NAME]: mcpServer };
    sessionOptions.allowedTools = getAllowedToolNames(params.dynamicTools);
  }

  const threadSession = createThreadSession({
    liveSettings: toInitialLiveSessionSettings(params),
    permissionEscalation: params.permissionEscalation,
    permissionMode: params.permissionMode,
    approvedPlanPermissionMode: params.approvedPlanPermissionMode,
    providerThreadId,
    sessionConstructionConfig: toSessionConstructionConfig(params),
    sessionOptions,
    sessionPermissionGrants: [],
    threadIdRef,
  });
  sessions.set(threadIdRef.current, threadSession);
  threadSession.session.start();

  // Identity precedes any thread/delta; the result carries the same identity
  // with per-session restorability. The fresh session is an id-space boundary.
  sendThreadIdentity(threadIdRef.current, providerThreadId);
  sendSessionReset(threadIdRef.current);
  sendResult(id, { providerThreadId, sessionRestorable: true });
}

async function handleThreadResume(
  id: string | number,
  params: ThreadResumeParams,
): Promise<void> {
  const threadId = params.threadId;
  const requestedProviderThreadId = params.providerThreadId ?? undefined;
  const sessionConstructionConfig = toSessionConstructionConfig(params);

  const existing = sessions.get(threadId);
  if (
    existing &&
    requestedProviderThreadId &&
    !existing.closing &&
    !existing.streamEnded &&
    existing.providerThreadId === requestedProviderThreadId &&
    isDeepStrictEqual(
      existing.sessionConstructionConfig,
      sessionConstructionConfig,
    )
  ) {
    await applyLiveSessionSettings(
      existing,
      params.threadId,
      toInitialLiveSessionSettings(params),
    );
    existing.permissionEscalation = params.permissionEscalation;
    sendResult(id, {
      providerThreadId: requestedProviderThreadId,
      sessionRestorable: true,
    });
    return;
  }

  if (existing) {
    if (!existing.closing) {
      // A live canonical session the new construction-scoped settings cannot
      // be applied to: settle its in-flight work and announce the rebuild
      // before tearing it down (never silent, #1268). The replacement resumes
      // the same provider session id, so provider-side context survives.
      emitSessionReplacement({
        contextLost: false,
        providerThreadId: requestedProviderThreadId ?? null,
        reason:
          "Claude session restarted: construction-scoped settings changed",
        threadId,
        threadSession: existing,
      });
    }
    await closeThreadSession({
      graceful: false,
      message: "Thread session replaced while awaiting permission approval",
      threadId,
    });
  }

  const env = buildSessionEnv(readConfigEnvOverrides(params.config));
  const threadIdRef = { current: threadId };
  const sessionOptions = buildTrackedSessionOptions(params, env, threadIdRef);
  sessionOptions.canUseTool = createCanUseTool(threadIdRef);
  if (params.dynamicTools && params.dynamicTools.length > 0) {
    const mcpServer = buildBridgeMcpServer(
      params.dynamicTools,
      createForwardToolCall(() => threadIdRef.current),
    );
    sessionOptions.mcpServers = { [BRIDGE_MCP_SERVER_NAME]: mcpServer };
    sessionOptions.allowedTools = getAllowedToolNames(params.dynamicTools);
  }
  const threadSession = createThreadSession({
    liveSettings: toInitialLiveSessionSettings(params),
    permissionEscalation: params.permissionEscalation,
    permissionMode: params.permissionMode,
    approvedPlanPermissionMode: params.approvedPlanPermissionMode,
    ...(requestedProviderThreadId
      ? { providerThreadId: requestedProviderThreadId }
      : {}),
    sessionConstructionConfig,
    sessionOptions,
    sessionPermissionGrants: [],
    threadIdRef,
  });
  sessions.set(threadId, threadSession);
  threadSession.session.start(requestedProviderThreadId);

  // A resume always names the session it reopens, so identity is known before
  // any thread/delta for it.
  if (requestedProviderThreadId === undefined) {
    sendError(
      id,
      BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS,
      "thread/resume requires a providerThreadId",
    );
    return;
  }
  sendThreadIdentity(threadId, requestedProviderThreadId);
  sendSessionReset(threadId);
  sendResult(id, {
    providerThreadId: requestedProviderThreadId,
    sessionRestorable: true,
  });
}

async function handleThreadFork(
  id: string | number,
  params: ThreadForkParams,
): Promise<void> {
  const threadId = params.threadId;

  const existing = sessions.get(threadId);
  if (existing) {
    await closeThreadSession({
      graceful: false,
      message: "Thread session replaced while awaiting permission approval",
      threadId,
    });
  }

  let forkedProviderThreadId: string;
  try {
    const forkResult = await forkSession(params.sourceProviderThreadId, {
      dir: params.cwd,
      ...(params.sourceProviderCheckpointId !== undefined
        ? { upToMessageId: params.sourceProviderCheckpointId }
        : {}),
    });
    forkedProviderThreadId = forkResult.sessionId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
    return;
  }

  const env = buildSessionEnv(readConfigEnvOverrides(params.config));
  const threadIdRef = { current: threadId };
  const sessionOptions = buildTrackedSessionOptions(params, env, threadIdRef);
  sessionOptions.canUseTool = createCanUseTool(threadIdRef);
  if (params.dynamicTools && params.dynamicTools.length > 0) {
    const mcpServer = buildBridgeMcpServer(
      params.dynamicTools,
      createForwardToolCall(() => threadIdRef.current),
    );
    sessionOptions.mcpServers = { [BRIDGE_MCP_SERVER_NAME]: mcpServer };
    sessionOptions.allowedTools = getAllowedToolNames(params.dynamicTools);
  }
  const threadSession = createThreadSession({
    liveSettings: toInitialLiveSessionSettings(params),
    permissionEscalation: params.permissionEscalation,
    permissionMode: params.permissionMode,
    approvedPlanPermissionMode: params.approvedPlanPermissionMode,
    providerThreadId: forkedProviderThreadId,
    sessionConstructionConfig: toSessionConstructionConfig(params),
    sessionOptions,
    sessionPermissionGrants: [],
    threadIdRef,
  });
  sessions.set(threadId, threadSession);
  threadSession.session.start(forkedProviderThreadId);

  sendThreadIdentity(threadId, forkedProviderThreadId);
  sendSessionReset(threadId);
  sendResult(id, {
    providerThreadId: forkedProviderThreadId,
    sessionRestorable: true,
  });
}

/**
 * Session-construction params for a start, resume, or fork, with this
 * process's latched skill roots folded in.
 */
function toClaudeSessionParams(
  params: z.infer<typeof canonicalThreadStartParamsSchema>,
): Record<string, unknown> {
  return buildClaudeSessionParams({
    threadId: params.threadId,
    cwd: params.cwd,
    options: params.options,
    instructionMode: params.instructionMode,
    dynamicTools: params.dynamicTools,
    disallowedTools: params.disallowedTools,
    skillRoots: configuredSkillRoots ?? undefined,
  });
}

async function runTurnStart(
  id: string | number,
  params: TurnStartParams,
  acceptance: CanonicalTurnAcceptance,
): Promise<void> {
  const promptText = buildPromptText(params.input);
  if (promptText === undefined) {
    sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, "Missing input text");
    return;
  }

  const threadSession = getWritableThreadSession(params.threadId);
  if (!threadSession) {
    sendError(id, -32000, "No active session");
    return;
  }

  if (!threadSession.session.canPushInput()) {
    sendError(id, -32000, "Claude SDK input stream is closed");
    return;
  }
  try {
    await applyLiveSessionSettings(
      threadSession,
      params.threadId,
      withTurnLiveSessionSettings(threadSession.liveSettings, params),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
    return;
  }

  try {
    await pushPromptInput(
      threadSession,
      promptText,
      params.permissionEscalation,
    );
    // Like steer, a new turn is accepted only after the SDK prompt iterator
    // consumes it. Queueing alone cannot prove which provider-owned segment a
    // concurrently drained result belongs to.
    emitCanonicalTurnInputAccepted(threadSession, acceptance, params.threadId);
    threadSession.permissionEscalation = params.permissionEscalation;
    sendResult(id, { threadId: params.threadId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
  }
}

async function handleTurnStart(
  id: string | number,
  params: CanonicalTurnStartParams,
): Promise<void> {
  await runTurnStart(
    id,
    claudeTurnStartParamsSchema.parse(
      buildClaudeTurnParams({
        threadId: params.threadId,
        providerThreadId: params.providerThreadId,
        input: params.input,
        options: params.options,
      }),
    ),
    {
      clientRequestId: params.clientRequestId,
      providerThreadId: params.providerThreadId,
    },
  );
}

async function runTurnSteer(
  id: string | number,
  params: TurnSteerParams,
  acceptance: CanonicalTurnAcceptance,
): Promise<void> {
  const promptText = buildPromptText(params.input);
  if (promptText === undefined) {
    sendError(id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, "Missing input text");
    return;
  }

  const threadSession = getWritableThreadSession(params.threadId);
  if (!threadSession) {
    sendError(id, -32000, "No active session");
    return;
  }

  if (!threadSession.session.canPushInput()) {
    sendError(id, -32000, "Claude SDK input stream is closed");
    return;
  }
  try {
    await applyLiveSessionSettings(
      threadSession,
      params.threadId,
      withTurnLiveSessionSettings(threadSession.liveSettings, params),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
    return;
  }

  try {
    await pushPromptInput(
      threadSession,
      promptText,
      params.permissionEscalation,
    );
    // The acceptance is emitted only once the SDK actually consumed the
    // queued input: a steer that joins a live turn correlates with it, and
    // one that lands on an idle session correlates with the turn it opens.
    emitCanonicalTurnInputAccepted(threadSession, acceptance, params.threadId);
    // A failed steer must not change the running turn's escalation.
    threadSession.permissionEscalation = params.permissionEscalation;
    sendResult(id, { threadId: params.threadId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
  }
}

async function handleTurnSteer(
  id: string | number,
  params: CanonicalTurnSteerParams,
): Promise<void> {
  await runTurnSteer(
    id,
    claudeTurnSteerParamsSchema.parse(
      buildClaudeTurnParams({
        threadId: params.threadId,
        providerThreadId: params.providerThreadId,
        expectedTurnId: params.expectedTurnId,
        input: params.input,
        options: params.options,
      }),
    ),
    {
      clientRequestId: params.clientRequestId,
      providerThreadId: params.providerThreadId,
    },
  );
}

async function closeThreadForStop(
  threadId: string,
): Promise<ClaudeCodeThreadStopResult> {
  await closeThreadSession({
    graceful: true,
    message: "Thread stopped while awaiting permission approval",
    threadId,
  });
  return { ok: true };
}

async function handleThreadStop(
  id: string | number,
  params: ThreadStopParams,
): Promise<void> {
  const threadSession = sessions.get(params.threadId);
  if (
    params.intent === "interrupt" &&
    threadSession !== undefined &&
    !threadSession.closing
  ) {
    // An interrupt settles the active turn as interrupted and, like today's
    // cancel semantics, takes the session's background tasks down with the
    // CLI session it closes: the boundary delta first, then the task drain.
    sendThreadDeltas(
      params.threadId,
      threadSession.translator.buildSessionSettlementDeltas(params.threadId),
    );
  }
  // A release detaches the idle session and must not fabricate an
  // interruption or settle background tasks (#1584): the session stays
  // resumable from its persisted providerThreadId and the close path emits
  // no turn events.
  sendResult(id, await closeThreadForStop(params.threadId));
}

function localAttachmentMarker(args: {
  kind: "image" | "file";
  path: string;
  name?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
}): string {
  const namePart = args.name && args.name.length > 0 ? ` "${args.name}"` : "";
  const details: string[] = [];
  if (args.mimeType) details.push(args.mimeType);
  if (args.sizeBytes !== undefined) details.push(`${args.sizeBytes} bytes`);
  const suffix = details.length > 0 ? ` (${details.join(", ")})` : "";
  return `[Attached ${args.kind}${namePart}${suffix}. It is on disk at ${args.path} — use the Read tool to view it.]`;
}

function buildPromptText(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input.length > 0 ? input : undefined;
  }
  if (!Array.isArray(input)) return undefined;

  const chunks: string[] = [];
  for (const item of input) {
    const parsed = promptInputItemSchema.safeParse(item);
    if (!parsed.success) continue;
    const entry = parsed.data;
    switch (entry.type) {
      case "text":
        if (entry.text.length > 0) chunks.push(entry.text);
        break;
      case "image":
        chunks.push(`[Attached image: ${entry.url}]`);
        break;
      case "localImage":
        chunks.push(localAttachmentMarker({ kind: "image", path: entry.path }));
        break;
      case "localFile":
        chunks.push(
          localAttachmentMarker({
            kind: "file",
            path: entry.path,
            name: entry.name,
            mimeType: entry.mimeType,
            sizeBytes: entry.sizeBytes,
          }),
        );
        break;
    }
  }

  return chunks.length > 0 ? chunks.join("\n") : undefined;
}

function handleParsedMessage(parsed: unknown): void {
  const response = decodeBridgeJsonRpcResponse(parsed);
  if (response && handleToolCallResponse(response)) {
    return;
  }

  if (response && findSessionByPendingInteractiveRequest(response.id)) {
    const threadSession = findSessionByPendingInteractiveRequest(response.id)!;
    const pending = threadSession.pendingInteractiveRequests.get(response.id)!;
    threadSession.pendingInteractiveRequests.delete(response.id);
    if ("error" in response) {
      pending.resolve({
        behavior: "deny",
        message: response.error.message ?? "Interactive request failed",
        toolUseID: pending.itemId,
      });
      return;
    }

    const interactiveResponse = decodePendingInteractiveResponse(
      pending,
      response.result,
    );
    if (interactiveResponse === null) {
      pending.resolve({
        behavior: "deny",
        message: "Invalid interactive response payload",
        toolUseID: pending.itemId,
      });
      return;
    }
    if (
      pending.kind === "permission_request" &&
      shouldCacheClaudeSessionPermission(interactiveResponse)
    ) {
      threadSession.sessionPermissionGrants.push({
        permissions: pending.permissions,
        toolName: pending.toolName,
      });
    }

    if (
      pending.kind === "permission_request" &&
      pending.toolName === CLAUDE_EXIT_PLAN_MODE_TOOL_NAME &&
      interactiveResponse.behavior === "allow"
    ) {
      restoreApprovedPlanPermissionMode(threadSession);
    }

    pending.resolve(
      buildInteractivePermissionResult(pending, interactiveResponse),
    );
    return;
  }

  const decoded = decodeClaudeCodeJsonRpcRequest(parsed);
  switch (decoded.kind) {
    case "not_a_request":
      return;
    case "unknown_method":
      logBridgeError(`Unknown method: ${decoded.method}`);
      sendError(
        decoded.id,
        BRIDGE_JSON_RPC_ERRORS.METHOD_NOT_FOUND,
        `Unknown method: ${decoded.method}`,
      );
      return;
    case "invalid_params": {
      const message = `Invalid params for ${decoded.method}: ${decoded.issues}`;
      logBridgeError(message);
      sendError(decoded.id, BRIDGE_JSON_RPC_ERRORS.INVALID_PARAMS, message);
      return;
    }
    case "request": {
      runBridgeRequest({
        request: decoded.request,
        handleRequest,
        sendError,
      });
      return;
    }
  }
}

export const handleLine = createBridgeLineHandler({ handleParsedMessage });

// Main entry point
let shuttingDown = false;

function shutdownGracefully(message: string): void {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  void closeThreadSessionsGracefully(message).finally(() => {
    process.exit(0);
  });
}

export const experimental_providerBridge = experimental_defineProviderBridge({
  handleLine,
  onSigterm: () => {
    shutdownGracefully(
      "Bridge shutting down while awaiting permission approval",
    );
  },
  onSigint: () => {
    shutdownGracefully("Bridge interrupted while awaiting permission approval");
  },
  onClose: () => {
    shutdownGracefully("Bridge closed while awaiting permission approval");
  },
});
