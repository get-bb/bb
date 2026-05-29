import {
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import { getDefaultProjectSource, getProject, getThread } from "@bb/db";
import type {
  DynamicTool,
  InstructionMode,
  PermissionEscalation,
  PermissionMode,
  ProjectExecutionDefaults,
  ReasoningLevel,
  ResolvedThreadExecutionOptions,
  Thread,
  ThreadExecutionOptions,
  ThreadExecutionSource,
  ThreadTurnInitiator,
  WorkspaceProvisionType,
  EnvironmentStatus,
} from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import { ApiError } from "../../errors.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import { getLastExecutionOptions } from "./thread-events.js";
import { requireThreadStorageContext } from "./thread-storage.js";
import {
  DEFAULT_REASONING_LEVEL,
  DEFAULT_SERVICE_TIER,
  resolveThreadExecutionPermissionMode,
} from "./thread-default-policy.js";

type ReasoningPolicyProviderId = "claude-code" | "codex" | "pi";
const SUPPORTED_REASONING_LEVELS_BY_PROVIDER: Record<
  ReasoningPolicyProviderId,
  readonly ReasoningLevel[]
> = {
  "claude-code": ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh"],
  pi: ["low", "medium", "high", "xhigh"],
};

/**
 * The coarse, per-provider reasoning levels. Used as a fallback when a precise
 * per-model `supportedReasoningEfforts` set is unavailable (e.g. validating a
 * reasoning override against a legacy/selected-only model not in the active
 * catalog). Returns an empty list for unknown providers.
 */
export function getSupportedReasoningLevelsForProvider(
  providerId: string,
): readonly ReasoningLevel[] {
  if (!isAgentProviderId(providerId)) {
    return [];
  }
  return SUPPORTED_REASONING_LEVELS_BY_PROVIDER[providerId];
}
const STANDARD_AGENT_INSTRUCTIONS = renderTemplate(
  "standardAgentInstructions",
  {},
);
const MESSAGE_USER_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: {
      type: "string",
      description:
        "Exact message text to show to the user. Keep it concise, factual, and appropriate for the user conversation.",
    },
  },
  required: ["text"],
};
const MANAGER_DYNAMIC_TOOLS: DynamicTool[] = [
  {
    name: "message_user",
    description:
      "IMPORTANT: you need to call this for the user to see messages you send. Send a concise message that is visible to the user from the manager thread. Use this for status updates, questions, approval requests, blockers, and completion notes. Plain assistant text is internal and is not shown to users.",
    inputSchema: MESSAGE_USER_TOOL_SCHEMA,
  },
];
const MANAGER_DISALLOWED_TOOLS = [
  "ExitPlanMode",
  "NotebookEdit",
  "Task",
] as const;

function resolveLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export interface ThreadRuntimeCommandEnvironment {
  cleanupRequestedAt: number | null;
  hostId: string;
  id: string;
  path: string | null;
  status: EnvironmentStatus;
  workspaceProvisionType: WorkspaceProvisionType;
}

export interface ResolveExecutionOptionsArgs {
  projectDefaults?: ProjectExecutionDefaults | null;
  requestedExecution: RequestedExecutionOptions;
  threadId: string;
}

export interface RequestedExecutionOptions extends ThreadExecutionOptions {
  source: ThreadExecutionSource;
}

export interface ResolveThreadRuntimeCommandConfigArgs {
  environment: ThreadRuntimeCommandEnvironment;
  thread: Thread;
}

export interface ResolvePermissionEscalationArgs {
  initiator: ThreadTurnInitiator;
  thread: Thread;
}

export interface ResolvedThreadRuntimeCommandConfig {
  dynamicTools: DynamicTool[];
  disallowedTools?: readonly string[];
  instructionMode: InstructionMode;
  instructions: string;
  projectId: string;
  providerId: string;
  /** Only set for manager threads. */
  threadStoragePath?: string;
  workspacePath: string;
  workspaceProvisionType: WorkspaceProvisionType;
}

function requireWorkspacePath(
  environment: ThreadRuntimeCommandEnvironment,
): string {
  if (!environment.path) {
    throwEnvironmentNotReady(environment);
  }

  return environment.path;
}

function validateProviderPermissionMode(
  providerId: string | undefined,
  permissionMode: PermissionMode,
): void {
  if (!providerId || !isAgentProviderId(providerId)) {
    return;
  }

  const provider = getBuiltInAgentProviderInfo(providerId);
  if (provider.capabilities.supportedPermissionModes.includes(permissionMode)) {
    return;
  }

  throw new ApiError(
    400,
    "invalid_request",
    `Provider ${providerId} only supports ${provider.capabilities.supportedPermissionModes.join(", ")} permission mode.`,
  );
}

function validateProviderReasoningLevel(
  providerId: string | undefined,
  reasoningLevel: ReasoningLevel,
): void {
  if (!providerId || !isAgentProviderId(providerId)) {
    return;
  }

  const supportedLevels = SUPPORTED_REASONING_LEVELS_BY_PROVIDER[providerId];
  if (supportedLevels.includes(reasoningLevel)) {
    return;
  }

  throw new ApiError(
    400,
    "invalid_request",
    `Provider ${providerId} does not support ${reasoningLevel} reasoning level. Supported reasoning levels: ${supportedLevels.join(", ")}.`,
  );
}

export function resolvePermissionEscalation(
  args: ResolvePermissionEscalationArgs,
): PermissionEscalation {
  if (
    args.initiator === "system" ||
    args.thread.parentThreadId !== null ||
    args.thread.type === "manager"
  ) {
    return "deny";
  }

  return "ask";
}

export async function resolveExecutionOptions(
  deps: Pick<AppDeps, "db">,
  args: ResolveExecutionOptionsArgs,
): Promise<ResolvedThreadExecutionOptions> {
  const lastExecution = getLastExecutionOptions(deps, args.threadId);
  const projectExecution = args.projectDefaults ?? null;
  const thread = getThread(deps.db, args.threadId);
  if (!thread) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  // The sticky thread-level override sits between the explicit per-turn request
  // (a one-off `tell --model` still wins for that turn) and `lastExecution` (so
  // it persists across turns that don't specify a model/reasoning level). The
  // next turn's `reconfigureThreadIfNeeded` applies the change to the live
  // session.
  const model =
    args.requestedExecution.model ??
    thread.modelOverride ??
    lastExecution?.model ??
    projectExecution?.model;
  if (!model) {
    throw new ApiError(
      500,
      "internal_error",
      `Thread ${args.threadId} has no stored execution model`,
    );
  }
  const parentThread =
    thread.parentThreadId !== null
      ? getThread(deps.db, thread.parentThreadId)
      : null;

  const permissionMode = resolveThreadExecutionPermissionMode({
    requestedPermissionMode: args.requestedExecution.permissionMode,
    lastExecutionPermissionMode: lastExecution?.permissionMode,
    parentThread,
    projectExecutionPermissionMode: projectExecution?.permissionMode,
    thread,
  });
  validateProviderPermissionMode(thread.providerId, permissionMode);
  const reasoningLevel =
    args.requestedExecution.reasoningLevel ??
    thread.reasoningLevelOverride ??
    lastExecution?.reasoningLevel ??
    projectExecution?.reasoningLevel ??
    DEFAULT_REASONING_LEVEL;
  validateProviderReasoningLevel(thread.providerId, reasoningLevel);

  return {
    model,
    serviceTier:
      args.requestedExecution.serviceTier ??
      lastExecution?.serviceTier ??
      projectExecution?.serviceTier ??
      DEFAULT_SERVICE_TIER,
    reasoningLevel,
    permissionMode,
    source: args.requestedExecution.source,
  };
}

export async function resolveThreadRuntimeCommandConfig(
  deps: LoggedWorkSessionDeps,
  args: ResolveThreadRuntimeCommandConfigArgs,
): Promise<ResolvedThreadRuntimeCommandConfig> {
  const workspacePath = requireWorkspacePath(args.environment);
  const project = getProject(deps.db, args.thread.projectId);
  if (!project) {
    throw new ApiError(404, "project_not_found", "Project not found");
  }

  const defaultSource = getDefaultProjectSource(deps.db, args.thread.projectId);
  const projectRootPath =
    defaultSource?.type === "local_path" ? defaultSource.path : workspacePath;
  const { workspaceProvisionType } = args.environment;

  if (args.thread.type !== "manager") {
    return {
      dynamicTools: [],
      instructionMode: "append",
      instructions: STANDARD_AGENT_INSTRUCTIONS,
      projectId: args.thread.projectId,
      providerId: args.thread.providerId,
      ...(args.thread.environmentId === null
        ? { threadStoragePath: workspacePath }
        : {}),
      workspacePath,
      workspaceProvisionType,
    };
  }
  const threadStorageContext = await requireThreadStorageContext(deps, {
    hostId: args.environment.hostId,
    threadId: args.thread.id,
  });

  return {
    dynamicTools: MANAGER_DYNAMIC_TOOLS,
    disallowedTools: MANAGER_DISALLOWED_TOOLS,
    instructionMode: "replace",
    instructions: renderTemplate("managerAgentInstructions", {
      hostId: args.environment.hostId,
      localTimezone: resolveLocalTimezone(),
      managerDataDir: threadStorageContext.dataDir,
      managerThreadId: args.thread.id,
      threadStoragePath: threadStorageContext.threadStoragePath,
      projectId: args.thread.projectId,
      projectName: project.name,
      projectRootPath,
    }),
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
    threadStoragePath: threadStorageContext.threadStoragePath,
    workspacePath,
    workspaceProvisionType,
  };
}
