#!/usr/bin/env node

/**
 * Claude Code bridge process.
 *
 * Thin JSON-RPC shell that manages Claude Agent SDK sessions and forwards
 * raw `SDKMessage` events to the parent process. The parent (host-daemon)
 * passes these to the adapter's `translateEvent` for conversion to
 * `ThreadEvent[]`.
 *
 * The bridge does NOT translate events — it only:
 * - Manages SDK session lifecycle (start, resume, stop, push input)
 * - Forwards raw SDK messages as `{ method: "sdk/message", params: { threadId, message } }`
 * - Forwards tool call requests to the parent and feeds responses back to the SDK
 * - Emits `thread/identity` when the SDK session ID is captured
 */

import { randomUUID } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
  type PendingInteractionGrantedPermissionProfile,
  type PermissionEscalation,
  type ReasoningLevel,
} from "@bb/domain";
import {
  forkSession,
  type CanUseTool,
  type HookCallback,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { extractEnvOverrides } from "../../shared/adapter-utils.js";
import {
  decodeBridgeJsonRpcResponse,
  type BridgeToolCallRequest,
} from "../../shared/bridge-tool-calls.js";
import {
  createBridgeIo,
  createBridgeLineHandler,
  runBridgeRequest,
  startBridgeStdio,
} from "../../shared/bridge-harness.js";
import {
  createBridgeSessionRegistry,
  type PendingBridgeToolCall,
} from "../../shared/bridge-session-registry.js";
import { withoutBridgeRuntimeEnv } from "../../shared/bridge-runtime-env.js";
import { shouldAutoDenyInteractiveRequest } from "../../shared/permission-policy.js";
import { SdkSession, type SdkSessionOptions } from "./sdk-session.js";
import { listClaudeCodeBridgeModels } from "./model-list.js";
import {
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
  buildReadonlyDenialMessage,
  buildMutableFlagSettings,
  buildSessionOptions,
  buildWorkspaceWriteDenialMessage,
  toSdkEffort,
  type BuildSessionOptionsArgs,
  type PermissionEscalationWorkContext,
} from "./session-options.js";
import {
  startClaudeCodeMockCliTrafficProxy,
  type ClaudeCodeMockCliTrafficProxy,
} from "./mock-cli-traffic-proxy.js";
import { buildReadonlyBashUpdatedInput } from "./readonly-bash-policy.js";
import {
  buildBridgeMcpServer,
  getAllowedToolNames,
  BRIDGE_MCP_SERVER_NAME,
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
  mockCliTrafficProxy: ClaudeCodeMockCliTrafficProxy | null;
  pendingToolCalls: Map<string | number, PendingBridgeToolCall>;
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
  mockCliTrafficProxy: ClaudeCodeMockCliTrafficProxy | null;
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

interface PreparedSessionEnv {
  env: NodeJS.ProcessEnv;
  mockCliTrafficProxy: ClaudeCodeMockCliTrafficProxy | null;
}

interface SessionConstructionConfig {
  claudeCodeMockCliTraffic: ThreadResumeParams["claudeCodeMockCliTraffic"];
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

interface PrepareSessionEnvParams {
  claudeCodeMockCliTraffic: ThreadStartParams["claudeCodeMockCliTraffic"];
  config?: ThreadStartParams["config"];
  threadId: ThreadStartParams["threadId"];
}

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
let toolCallRequestIdCounter = 0;

// Runtime waits on thread/stop until the SDK stream drains or this timeout
// forces the session closed. Stop remains a best-effort success boundary.
const THREAD_STOP_CLOSE_TIMEOUT_MS = 4_000;

const { send, sendResult, sendError } = createBridgeIo<
  SdkMessageNotification | BridgeEventNotification | BridgeToolCallRequest
>();

const {
  closeThreadSession,
  closeThreadSessionsGracefully,
  createForwardToolCall,
  handleToolCallResponse,
  resolvePendingSessionWork,
  sessions,
} = createBridgeSessionRegistry<ThreadSession>({
  closeSessionGracefully: (threadSession) =>
    closeClaudeThreadSession(threadSession, true),
  getProviderThreadId: (threadSession, threadId) =>
    threadSession.providerThreadId ?? threadId,
  nextToolCallRequestId: () => {
    toolCallRequestIdCounter += 1;
    return toolCallRequestIdCounter;
  },
  resolveAdditionalPendingWork: resolvePendingInteractiveRequests,
  sendToolCall: send,
  stopSession: (threadSession) =>
    closeClaudeThreadSession(threadSession, false),
});

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

function ignoreInputConsumption(promise: Promise<void>): void {
  void promise.catch(() => {});
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

function queuePromptInputs(
  threadSession: ThreadSession,
  inputs: readonly string[],
  permissionEscalation: PermissionEscalation | null,
): boolean {
  if (!threadSession.session.canPushInput()) {
    return false;
  }
  for (const input of inputs) {
    ignoreInputConsumption(
      pushPromptInput(threadSession, input, permissionEscalation),
    );
  }
  return true;
}

async function applyLiveSessionSettings(
  threadSession: ThreadSession,
  next: ClaudeLiveSessionSettings,
): Promise<void> {
  const current = threadSession.liveSettings;
  if (current.model !== next.model) {
    await threadSession.session.setModel(next.model);
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

function sendSdkMessage(threadId: string, message: SDKMessage): void {
  send({
    jsonrpc: "2.0",
    method: "sdk/message",
    params: { threadId, message },
  });
}

function sendThreadIdentity(threadId: string, providerThreadId: string): void {
  send({
    jsonrpc: "2.0",
    method: "thread/identity",
    params: {
      threadId,
      providerThreadId,
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
    claudeCodeMockCliTraffic: params.claudeCodeMockCliTraffic,
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

  return {
    session,
    sessionConstructionConfig: args.sessionConstructionConfig,
    sessionOptions: args.sessionOptions,
    sessionSerial,
    closing: false,
    streamEnded: false,
    mockCliTrafficProxy: args.mockCliTrafficProxy,
    pendingToolCalls: new Map(),
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
  args.threadSession.mockCliTrafficProxy = null;
  resolvePendingSessionWork(args.threadSession, args.reason);
  args.threadSession.session.stop();

  // This is not a user-requested thread close: the thread remains active and
  // immediately owns the replacement session. `closingSessions` only gates
  // external stop/replace requests, so a stop after this point should target
  // the replacement, not wait on the poisoned resume session.
  sessions.set(args.threadId, args.replacementSession);
  args.replacementSession.session.start(args.providerThreadId);
  sendThreadIdentity(args.threadId, args.providerThreadId);
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
    mockCliTrafficProxy: args.threadSession.mockCliTrafficProxy,
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
    sendSdkMessage(args.threadIdRef.current, message);
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

    send({
      jsonrpc: "2.0",
      method: "error",
      params: { threadId: args.threadIdRef.current, message },
    });
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
  try {
    if (graceful) {
      await threadSession.session.closeGracefully(THREAD_STOP_CLOSE_TIMEOUT_MS);
    } else {
      threadSession.session.stop();
    }
  } finally {
    await threadSession.mockCliTrafficProxy?.close();
    threadSession.mockCliTrafficProxy = null;
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

function appendNoProxyLoopback(value: string | undefined): string {
  const entries = new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
  entries.add("127.0.0.1");
  entries.add("localhost");
  return [...entries].join(",");
}

async function prepareSessionEnv(
  params: PrepareSessionEnvParams,
): Promise<PreparedSessionEnv> {
  const envOverrides = extractEnvOverrides(params.config);
  if (!params.claudeCodeMockCliTraffic.enabled) {
    return {
      env: buildSessionEnv(envOverrides),
      mockCliTrafficProxy: null,
    };
  }

  const mockCliTrafficProxy = await startClaudeCodeMockCliTrafficProxy({
    endpoint: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
    threadId: params.threadId,
  });
  return {
    env: buildSessionEnv({
      ...envOverrides,
      ANTHROPIC_BASE_URL: mockCliTrafficProxy.baseUrl,
      NO_PROXY: appendNoProxyLoopback(
        envOverrides.NO_PROXY ?? process.env.NO_PROXY,
      ),
      no_proxy: appendNoProxyLoopback(
        envOverrides.no_proxy ?? process.env.no_proxy,
      ),
    }),
    mockCliTrafficProxy,
  };
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

      toolCallRequestIdCounter += 1;
      const requestId = toolCallRequestIdCounter;

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

      args.signal.addEventListener("abort", onAbort, { once: true });
      threadSession.pendingInteractiveRequests.set(requestId, {
        itemId: args.toolUseId,
        kind: "permission_request",
        originalInput: args.input,
        permissions: params.permissions,
        resolve: finish,
        toolName: args.toolName,
      });

      send({
        jsonrpc: "2.0",
        id: requestId,
        method: CLAUDE_PERMISSION_REQUEST_APPROVAL_METHOD,
        params,
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
      toolCallRequestIdCounter += 1;
      const requestId = toolCallRequestIdCounter;

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

      args.signal.addEventListener("abort", onAbort, { once: true });
      threadSession.pendingInteractiveRequests.set(requestId, {
        itemId: args.toolUseId,
        kind: "user_question",
        resolve: finish,
      });

      send({
        jsonrpc: "2.0",
        id: requestId,
        method: CLAUDE_USER_QUESTION_REQUEST_METHOD,
        params,
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
      sendResult(request.id, { ok: true });
      break;
    case "model/list":
      sendResult(request.id, await listClaudeCodeBridgeModels());
      break;
    case "thread/start":
      await handleThreadStart(request.id, request.params);
      break;
    case "thread/resume":
      await handleThreadResume(request.id, request.params);
      break;
    case "thread/fork":
      await handleThreadFork(request.id, request.params);
      break;
    case "turn/start":
      await handleTurnStart(request.id, request.params);
      break;
    case "turn/steer":
      await handleTurnSteer(request.id, request.params);
      break;
    case "thread/stop":
      sendResult(request.id, await handleThreadStop(request.params));
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

  const preparedEnv = await prepareSessionEnv(params);
  const sessionOptions = buildTrackedSessionOptions(
    params,
    preparedEnv.env,
    threadIdRef,
  );
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
    mockCliTrafficProxy: preparedEnv.mockCliTrafficProxy,
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

  sendResult(id, { threadId: threadIdRef.current, providerThreadId });
  sendThreadIdentity(threadIdRef.current, providerThreadId);
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
      toInitialLiveSessionSettings(params),
    );
    existing.permissionEscalation = params.permissionEscalation;
    sendResult(id, {
      threadId,
      providerThreadId: requestedProviderThreadId,
    });
    return;
  }

  if (existing) {
    await closeThreadSession({
      graceful: false,
      message: "Thread session replaced while awaiting permission approval",
      threadId,
    });
  }

  const preparedEnv = await prepareSessionEnv(params);
  const threadIdRef = { current: threadId };
  const sessionOptions = buildTrackedSessionOptions(
    params,
    preparedEnv.env,
    threadIdRef,
  );
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
    mockCliTrafficProxy: preparedEnv.mockCliTrafficProxy,
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

  sendResult(id, {
    threadId,
    providerThreadId: requestedProviderThreadId ?? null,
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

  const preparedEnv = await prepareSessionEnv(params);
  const threadIdRef = { current: threadId };
  const sessionOptions = buildTrackedSessionOptions(
    params,
    preparedEnv.env,
    threadIdRef,
  );
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
    mockCliTrafficProxy: preparedEnv.mockCliTrafficProxy,
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

  sendResult(id, { threadId, providerThreadId: forkedProviderThreadId });
  sendThreadIdentity(threadId, forkedProviderThreadId);
}

function buildPromptTexts(
  input: unknown,
  inputGroups: unknown[][] | undefined,
): string[] | undefined {
  const groups = inputGroups ?? [input];
  const texts: string[] = [];
  for (const group of groups) {
    const text = buildPromptText(group);
    if (text === undefined) {
      return undefined;
    }
    texts.push(text);
  }
  return texts;
}

async function handleTurnStart(
  id: string | number,
  params: TurnStartParams,
): Promise<void> {
  const inputs = buildPromptTexts(params.input, params.inputGroups);
  if (!inputs) {
    sendError(id, -32602, "Missing input text");
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
      withTurnLiveSessionSettings(threadSession.liveSettings, params),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
    return;
  }

  if (!queuePromptInputs(threadSession, inputs, params.permissionEscalation)) {
    sendError(id, -32000, "Claude SDK input stream is closed");
    return;
  }
  threadSession.permissionEscalation = params.permissionEscalation;
  sendResult(id, { threadId: params.threadId });
}

async function handleTurnSteer(
  id: string | number,
  params: TurnSteerParams,
): Promise<void> {
  const inputs = buildPromptTexts(params.input, params.inputGroups);
  if (!inputs) {
    sendError(id, -32602, "Missing input text");
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
      withTurnLiveSessionSettings(threadSession.liveSettings, params),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
    return;
  }

  if (inputs.length > 1) {
    if (
      !queuePromptInputs(threadSession, inputs, params.permissionEscalation)
    ) {
      sendError(id, -32000, "Claude SDK input stream is closed");
      return;
    }
    threadSession.permissionEscalation = params.permissionEscalation;
    sendResult(id, { threadId: params.threadId });
    return;
  }

  try {
    await pushPromptInput(
      threadSession,
      inputs[0] ?? "",
      params.permissionEscalation,
    );
    // A failed steer must not change the running turn's escalation.
    threadSession.permissionEscalation = params.permissionEscalation;
    sendResult(id, { threadId: params.threadId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendError(id, -32000, message);
  }
}

async function handleThreadStop(
  params: ThreadStopParams,
): Promise<ClaudeCodeThreadStopResult> {
  await closeThreadSession({
    graceful: true,
    message: "Thread stopped while awaiting permission approval",
    threadId: params.threadId,
  });
  return { ok: true };
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

    const parsedResponse = claudeInteractiveResponseSchema.safeParse(
      response.result,
    );
    if (!parsedResponse.success) {
      pending.resolve({
        behavior: "deny",
        message: "Invalid interactive response payload",
        toolUseID: pending.itemId,
      });
      return;
    }

    const interactiveResponse = parsedResponse.data;
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
      sendError(decoded.id, -32601, `Unknown method: ${decoded.method}`);
      return;
    case "invalid_params": {
      const message = `Invalid params for ${decoded.method}: ${decoded.issues}`;
      logBridgeError(message);
      sendError(decoded.id, -32602, message);
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

startBridgeStdio({
  importMetaUrl: import.meta.url,
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
