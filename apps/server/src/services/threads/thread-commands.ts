import { environments, events, getExperiments, threads } from "@bb/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import {
  DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
  type ClaudeCodeMockCliTrafficConfig,
  PromptInput,
  ProjectExecutionDefaults,
  PermissionEscalation,
  ResolvedThreadExecutionOptions,
  RuntimeThreadExecutionOptions,
  Thread,
  ClientTurnRequestId,
  EnvironmentStatus,
  WorkspaceProvisionType,
} from "@bb/domain";
import type {
  HostDaemonCommand,
  TurnSubmitTarget,
} from "@bb/host-daemon-contract";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import { ApiError } from "../../errors.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import { getLastProviderThreadId } from "./thread-events.js";
import {
  resolveThreadRuntimeCommandConfig,
  type ResolvedThreadRuntimeCommandConfig,
  type ThreadRuntimeCommandEnvironment,
} from "./thread-runtime-config.js";
import { resolveWorkflowsEnabledPolicy } from "./thread-default-policy.js";
import {
  buildExistingThreadExecutionInput,
  resolveExistingThreadExecutionPlan,
  type ExistingThreadExecutionInputRequest,
} from "./thread-execution-plan.js";
import { workspaceContextFromPath } from "../environments/workspace-command-target.js";

export type ExecutionOptionsRequest = ExistingThreadExecutionInputRequest;

export interface ThreadStopCommandArgs {
  environmentId: string;
  hostId: string;
  threadId: string;
}

interface ThreadStartCommandEnvironment {
  hostId: string;
  id: string;
  path: string | null;
  status: EnvironmentStatus;
  workspaceProvisionType: WorkspaceProvisionType;
}

interface ThreadHostCommandEnvironment {
  hostId: string;
  id: string;
}

interface ThreadUnarchiveCommandEnvironment {
  hostId: string;
  id: string;
  status: EnvironmentStatus;
}

export interface ThreadStartCommandArgs {
  environment: ThreadStartCommandEnvironment;
  execution: ResolvedThreadExecutionOptions;
  permissionEscalation: PermissionEscalation;
  input: PromptInput[];
  projectId: string;
  providerId: string;
  requestId: ClientTurnRequestId;
  syncGeneratedTitle: boolean;
  thread: Thread;
}

interface PreparedTurnSubmitCommandBuildArgs {
  claudeCodeMockCliTraffic: ClaudeCodeMockCliTrafficConfig;
  environmentId: string;
  execution: ResolvedThreadExecutionOptions;
  permissionEscalation: PermissionEscalation;
  input: PromptInput[];
  providerThreadId: string;
  runtimeContext: ResolvedThreadRuntimeCommandConfig;
  target: TurnSubmitTarget;
  threadId: string;
}

interface PrepareTurnSubmitCommandPayloadArgs {
  environment: ThreadRuntimeCommandEnvironment;
  execution: ResolvedThreadExecutionOptions;
  permissionEscalation: PermissionEscalation;
  input: PromptInput[];
  providerThreadId?: string;
  target: TurnSubmitTarget;
  thread: Thread;
}

interface FinalizeTurnSubmitCommandPayloadArgs {
  requestId: ClientTurnRequestId;
  preparedCommand: PreparedTurnSubmitCommandPayload;
}

export type PreparedTurnSubmitCommandPayload = Omit<
  Extract<HostDaemonCommand, { type: "turn.submit" }>,
  "requestId"
>;

interface RuntimeExecutionOptionsArgs {
  claudeCodeMockCliTraffic: ClaudeCodeMockCliTrafficConfig;
  execution: ResolvedThreadExecutionOptions;
  permissionEscalation: PermissionEscalation;
  providerId: string;
}

interface BuildExecutionOptionsArgs {
  projectDefaults?: ProjectExecutionDefaults | null;
  threadId: string;
}

type BuildExecutionOptionsSource =
  | "client/thread/start"
  | "client/turn/requested"
  | "client/turn/start";

interface DispatchThreadRenameCommandArgs {
  environment: ThreadHostCommandEnvironment;
  providerId: string;
  threadId: string;
  title: string;
}

interface DispatchThreadUnarchiveCommandArgs {
  environment: ThreadUnarchiveCommandEnvironment;
  providerThreadId: string;
  thread: Thread;
}

interface DispatchArchivedThreadProviderArchiveCommandArgs {
  threadId: string;
}

function providerSupportsThreadRename(providerId: string): boolean {
  if (!isAgentProviderId(providerId)) {
    return true;
  }

  return getBuiltInAgentProviderInfo(providerId).capabilities.supportsRename;
}

function providerSupportsThreadArchiveForwarding(providerId: string): boolean {
  if (!isAgentProviderId(providerId)) {
    return false;
  }

  return getBuiltInAgentProviderInfo(providerId).capabilities.supportsArchive;
}

function resolveClaudeCodeMockCliTrafficConfig(
  deps: Pick<AppDeps, "db">,
): ClaudeCodeMockCliTrafficConfig {
  return {
    enabled: getExperiments(deps.db).claudeCodeMockCliTraffic,
    endpoint: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_ENDPOINT,
  };
}

function toRuntimeExecutionOptions(
  args: RuntimeExecutionOptionsArgs,
): RuntimeThreadExecutionOptions {
  const base = {
    model: args.execution.model,
    serviceTier: args.execution.serviceTier,
    reasoningLevel: args.execution.reasoningLevel,
    claudeCodeMockCliTraffic: args.claudeCodeMockCliTraffic,
    workflowsEnabled: resolveWorkflowsEnabledPolicy(args.providerId),
  };
  if (args.execution.permissionMode === "full") {
    return {
      ...base,
      permissionMode: args.execution.permissionMode,
      permissionEscalation: null,
    };
  }
  return {
    ...base,
    permissionMode: args.execution.permissionMode,
    permissionEscalation: args.permissionEscalation,
  };
}

export async function buildExecutionOptions(
  deps: Pick<AppDeps, "db" | "hub">,
  request: ExecutionOptionsRequest,
  args: BuildExecutionOptionsArgs,
  source: BuildExecutionOptionsSource,
): Promise<ResolvedThreadExecutionOptions> {
  const plan = await resolveExistingThreadExecutionPlan(deps, {
    ...(args.projectDefaults !== undefined
      ? { projectDefaults: args.projectDefaults }
      : {}),
    executionSource: source,
    input: buildExistingThreadExecutionInput(request),
    threadId: args.threadId,
  });
  return plan.resolvedExecution;
}

export async function buildThreadStartCommand(
  deps: LoggedWorkSessionDeps,
  args: ThreadStartCommandArgs,
): Promise<Extract<HostDaemonCommand, { type: "thread.start" }>> {
  const runtimeContext = await resolveThreadRuntimeCommandConfig(deps, {
    thread: args.thread,
    environment: args.environment,
  });
  return {
    type: "thread.start",
    environmentId: args.environment.id,
    threadId: args.thread.id,
    workspaceContext: workspaceContextFromPath({
      path: runtimeContext.workspacePath,
      workspaceProvisionType: runtimeContext.workspaceProvisionType,
    }),
    projectId: args.projectId,
    providerId: args.providerId,
    requestId: args.requestId,
    input: args.input,
    options: toRuntimeExecutionOptions({
      ...args,
      claudeCodeMockCliTraffic: resolveClaudeCodeMockCliTrafficConfig(deps),
    }),
    instructions: runtimeContext.instructions,
    dynamicTools: runtimeContext.dynamicTools,
    injectedSkillSources: runtimeContext.injectedSkillSources,
    instructionMode: runtimeContext.instructionMode,
    threadStoragePath: runtimeContext.threadStoragePath,
  };
}

function buildPreparedTurnSubmitCommandPayload(
  args: PreparedTurnSubmitCommandBuildArgs,
): PreparedTurnSubmitCommandPayload {
  return {
    type: "turn.submit",
    environmentId: args.environmentId,
    threadId: args.threadId,
    input: args.input,
    options: toRuntimeExecutionOptions({
      ...args,
      claudeCodeMockCliTraffic: args.claudeCodeMockCliTraffic,
      providerId: args.runtimeContext.providerId,
    }),
    target: args.target,
    resumeContext: {
      workspaceContext: workspaceContextFromPath({
        path: args.runtimeContext.workspacePath,
        workspaceProvisionType: args.runtimeContext.workspaceProvisionType,
      }),
      projectId: args.runtimeContext.projectId,
      providerId: args.runtimeContext.providerId,
      providerThreadId: args.providerThreadId,
      instructions: args.runtimeContext.instructions,
      dynamicTools: args.runtimeContext.dynamicTools,
      injectedSkillSources: args.runtimeContext.injectedSkillSources,
      instructionMode: args.runtimeContext.instructionMode,
    },
  };
}

export function addRequestIdToTurnSubmitCommandPayload(
  args: FinalizeTurnSubmitCommandPayloadArgs,
): Extract<HostDaemonCommand, { type: "turn.submit" }> {
  return {
    ...args.preparedCommand,
    requestId: args.requestId,
  };
}

export async function prepareTurnSubmitCommandPayload(
  deps: LoggedWorkSessionDeps,
  args: PrepareTurnSubmitCommandPayloadArgs,
): Promise<PreparedTurnSubmitCommandPayload> {
  const providerThreadId = requireProviderThreadId(
    args.providerThreadId ?? getLastProviderThreadId(deps, args.thread.id),
    args.thread.id,
  );
  const runtimeContext = await resolveThreadRuntimeCommandConfig(deps, {
    thread: args.thread,
    environment: args.environment,
  });
  return buildPreparedTurnSubmitCommandPayload({
    claudeCodeMockCliTraffic: resolveClaudeCodeMockCliTrafficConfig(deps),
    environmentId: args.environment.id,
    execution: args.execution,
    permissionEscalation: args.permissionEscalation,
    input: args.input,
    providerThreadId,
    runtimeContext,
    target: args.target,
    threadId: args.thread.id,
  });
}

function requireProviderThreadId(
  providerThreadId: string | null | undefined,
  threadId: string,
): string {
  if (!providerThreadId) {
    throw new ApiError(
      409,
      "invalid_request",
      `Thread ${threadId} has no provider session`,
    );
  }

  return providerThreadId;
}

function threadHasLiveChildren(
  deps: Pick<AppDeps, "db">,
  threadId: string,
): boolean {
  const row = deps.db
    .select({ id: threads.id })
    .from(threads)
    .where(
      and(
        eq(threads.parentThreadId, threadId),
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

function threadHasCodexSpawnAgentToolCall(
  deps: Pick<AppDeps, "db">,
  threadId: string,
): boolean {
  const row = deps.db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.itemKind, "toolCall"),
        sql`json_extract(${events.data}, '$.item.tool') = 'spawnAgent'`,
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

export function dispatchThreadRenameCommand(
  deps: CommandResultSideEffectsDeps,
  args: DispatchThreadRenameCommandArgs,
): void {
  if (!providerSupportsThreadRename(args.providerId)) {
    return;
  }

  startLiveHostCommand(deps, {
    command: {
      type: "thread.rename",
      environmentId: args.environment.id,
      threadId: args.threadId,
      title: args.title,
    },
    hostId: args.environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, threadId: args.threadId },
        "Live thread rename command failed",
      );
    },
  });
}

export function dispatchArchivedThreadProviderArchiveCommand(
  deps: CommandResultSideEffectsDeps,
  args: DispatchArchivedThreadProviderArchiveCommandArgs,
): boolean {
  const thread = deps.db
    .select()
    .from(threads)
    .where(eq(threads.id, args.threadId))
    .get();
  if (!thread || thread.archivedAt === null || thread.deletedAt !== null) {
    return false;
  }

  const providerThreadId = getLastProviderThreadId(deps, thread.id);
  if (!providerThreadId || !thread.environmentId) {
    return false;
  }

  const environment = deps.db
    .select()
    .from(environments)
    .where(eq(environments.id, thread.environmentId))
    .get();
  if (!environment) {
    return false;
  }
  if (environment.status !== "ready") {
    return false;
  }

  if (!providerSupportsThreadArchiveForwarding(thread.providerId)) {
    return false;
  }

  if (
    threadHasLiveChildren(deps, thread.id) ||
    threadHasCodexSpawnAgentToolCall(deps, thread.id)
  ) {
    return false;
  }

  if (!environment.path) {
    return false;
  }
  const workspaceContext = workspaceContextFromPath({
    path: environment.path,
    workspaceProvisionType: environment.workspaceProvisionType,
  });

  startLiveHostCommand(deps, {
    command: {
      type: "thread.archive",
      environmentId: environment.id,
      threadId: thread.id,
      workspaceContext,
      providerId: thread.providerId,
      providerThreadId,
    },
    hostId: environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, threadId: thread.id },
        "Live thread archive command failed",
      );
    },
  });
  return true;
}

export function dispatchThreadUnarchiveCommand(
  deps: CommandResultSideEffectsDeps,
  args: DispatchThreadUnarchiveCommandArgs,
): boolean {
  if (!providerSupportsThreadArchiveForwarding(args.thread.providerId)) {
    return false;
  }
  if (args.environment.status !== "ready") {
    return false;
  }

  startLiveHostCommand(deps, {
    command: {
      type: "thread.unarchive",
      environmentId: args.environment.id,
      threadId: args.thread.id,
      providerId: args.thread.providerId,
      providerThreadId: args.providerThreadId,
    },
    hostId: args.environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, threadId: args.thread.id },
        "Live thread unarchive command failed",
      );
    },
  });
  return true;
}

export function buildThreadStopCommand(
  args: ThreadStopCommandArgs,
): Extract<HostDaemonCommand, { type: "thread.stop" }> {
  return {
    type: "thread.stop",
    environmentId: args.environmentId,
    threadId: args.threadId,
  };
}
