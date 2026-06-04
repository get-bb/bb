import {
  getActiveSession,
  queueCommand,
  queueCommandInTransaction,
  hasExistingThreadArchiveCommand,
  hasPendingHostCommandForThread,
  environments,
  events,
  threads,
} from "@bb/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  getBuiltInAgentProviderInfo,
  isAgentProviderId,
} from "@bb/agent-providers";
import type { DbTransaction } from "@bb/db";
import type {
  Environment,
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
import { ApiError } from "../../errors.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { getLastProviderThreadId } from "./thread-events.js";
import {
  resolveThreadRuntimeCommandConfig,
  type ResolvedThreadRuntimeCommandConfig,
  type ThreadRuntimeCommandEnvironment,
} from "./thread-runtime-config.js";
import { appendManagerToolReminder } from "./manager-tool-reminder.js";
import { resolveWorkflowsEnabledPolicy } from "./thread-default-policy.js";
import {
  buildExistingThreadExecutionInput,
  resolveExistingThreadExecutionPlan,
  type ExistingThreadExecutionInputRequest,
} from "./thread-execution-plan.js";
import { workspaceContextFromPath } from "../environments/workspace-command-target.js";
import { tryTransition } from "./thread-transitions.js";

export type ExecutionOptionsRequest = ExistingThreadExecutionInputRequest;

export interface QueueThreadStopCommandArgs {
  environmentId: string;
  hostId: string;
  threadId: string;
}

interface QueueThreadStartCommandEnvironment {
  cleanupRequestedAt: number | null;
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

export interface QueueThreadStartCommandArgs {
  environment: QueueThreadStartCommandEnvironment;
  execution: ResolvedThreadExecutionOptions;
  permissionEscalation: PermissionEscalation;
  input: PromptInput[];
  projectId: string;
  providerId: string;
  requestId: ClientTurnRequestId;
  thread: Thread;
}

interface PreparedTurnSubmitCommandBuildArgs {
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

interface QueueTurnSubmitCommandInTransactionArgs {
  command: Extract<HostDaemonCommand, { type: "turn.submit" }>;
  hostId: string;
  sessionId: string | null;
}

interface QueueTurnSubmitCommandArgs extends PrepareTurnSubmitCommandPayloadArgs {
  requestId: ClientTurnRequestId;
}

interface QueueThreadRenameCommandArgs {
  environment: ThreadHostCommandEnvironment;
  providerId: string;
  threadId: string;
  title: string;
}

interface QueueThreadUnarchiveCommandArgs {
  environment: ThreadUnarchiveCommandEnvironment;
  providerThreadId: string;
  thread: Thread;
}

interface EnsureThreadNativeArchiveSettledArgs {
  environment: Pick<Environment, "hostId">;
  thread: Pick<Thread, "id">;
}

interface QueueArchivedThreadProviderArchiveCommandArgs {
  threadId: string;
}

interface QueueThreadDeletedCommandArgs {
  environment: ThreadHostCommandEnvironment;
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

function toRuntimeExecutionOptions(
  args: RuntimeExecutionOptionsArgs,
): RuntimeThreadExecutionOptions {
  const base = {
    model: args.execution.model,
    serviceTier: args.execution.serviceTier,
    reasoningLevel: args.execution.reasoningLevel,
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
  args: QueueThreadStartCommandArgs,
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
    options: toRuntimeExecutionOptions(args),
    instructions: runtimeContext.instructions,
    dynamicTools: runtimeContext.dynamicTools,
    injectedSkillSources: runtimeContext.injectedSkillSources,
    ...(runtimeContext.disallowedTools?.length
      ? { disallowedTools: [...runtimeContext.disallowedTools] }
      : {}),
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
      ...(args.runtimeContext.disallowedTools?.length
        ? { disallowedTools: [...args.runtimeContext.disallowedTools] }
        : {}),
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
  let input = args.input;
  if (args.thread.type === "manager") {
    if (!isAgentProviderId(args.thread.providerId)) {
      throw new ApiError(
        500,
        "internal_error",
        `Manager thread has unsupported provider ${args.thread.providerId}`,
      );
    }
    input = appendManagerToolReminder(args.input, args.thread.providerId);
  }
  return buildPreparedTurnSubmitCommandPayload({
    environmentId: args.environment.id,
    execution: args.execution,
    permissionEscalation: args.permissionEscalation,
    input,
    providerThreadId,
    runtimeContext,
    target: args.target,
    threadId: args.thread.id,
  });
}

export function queueTurnSubmitCommandInTransaction(
  db: DbTransaction,
  args: QueueTurnSubmitCommandInTransactionArgs,
) {
  return queueCommandInTransaction(db, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    type: "turn.submit",
    payload: JSON.stringify(args.command),
  });
}

export async function queueTurnSubmitCommand(
  deps: LoggedWorkSessionDeps,
  args: QueueTurnSubmitCommandArgs,
): Promise<void> {
  ensureThreadNativeArchiveSettled(deps, {
    environment: args.environment,
    thread: args.thread,
  });
  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.environment.hostId,
  });
  const preparedCommand = await prepareTurnSubmitCommandPayload(deps, args);
  const command = addRequestIdToTurnSubmitCommandPayload({
    requestId: args.requestId,
    preparedCommand,
  });
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: "turn.submit",
    payload: JSON.stringify(command),
  });

  if (args.thread.status === "idle") {
    tryTransition(deps.db, deps.hub, args.thread.id, "active");
  }
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

export function queueThreadRenameCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: QueueThreadRenameCommandArgs,
): void {
  if (!providerSupportsThreadRename(args.providerId)) {
    return;
  }

  const session = getActiveSession(deps.db, args.environment.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session?.id ?? null,
    type: "thread.rename",
    payload: JSON.stringify({
      type: "thread.rename",
      environmentId: args.environment.id,
      threadId: args.threadId,
      title: args.title,
    }),
  });
}

export function queueThreadRenameCommandInTransaction(
  db: DbTransaction,
  args: QueueThreadRenameCommandArgs,
): boolean {
  if (!providerSupportsThreadRename(args.providerId)) {
    return false;
  }

  const session = getActiveSession(db, args.environment.hostId);
  queueCommandInTransaction(db, {
    hostId: args.environment.hostId,
    sessionId: session?.id ?? null,
    type: "thread.rename",
    payload: JSON.stringify({
      type: "thread.rename",
      environmentId: args.environment.id,
      threadId: args.threadId,
      title: args.title,
    }),
  });
  return true;
}

export function ensureThreadNativeArchiveSettled(
  deps: Pick<AppDeps, "db">,
  args: EnsureThreadNativeArchiveSettledArgs,
): void {
  if (
    !hasPendingHostCommandForThread(deps.db, {
      hostId: args.environment.hostId,
      threadId: args.thread.id,
      type: "thread.archive",
    })
  ) {
    return;
  }

  throw new ApiError(
    409,
    "thread_archive_in_progress",
    "Thread archive is still syncing with the provider",
  );
}

export function queueArchivedThreadProviderArchiveCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: QueueArchivedThreadProviderArchiveCommandArgs,
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

  if (
    hasExistingThreadArchiveCommand(deps.db, {
      hostId: environment.hostId,
      providerId: thread.providerId,
      providerThreadId,
      threadId: thread.id,
    })
  ) {
    return false;
  }

  const session = getActiveSession(deps.db, environment.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: environment.hostId,
    sessionId: session?.id ?? null,
    type: "thread.archive",
    payload: JSON.stringify({
      type: "thread.archive",
      environmentId: environment.id,
      threadId: thread.id,
      workspaceContext,
      providerId: thread.providerId,
      providerThreadId,
    }),
  });
  return true;
}

export function queueThreadUnarchiveCommand(
  deps: Pick<AppDeps, "db" | "hub">,
  args: QueueThreadUnarchiveCommandArgs,
): boolean {
  if (!providerSupportsThreadArchiveForwarding(args.thread.providerId)) {
    return false;
  }
  if (args.environment.status !== "ready") {
    return false;
  }

  const session = getActiveSession(deps.db, args.environment.hostId);
  queueCommand(deps.db, deps.hub, {
    hostId: args.environment.hostId,
    sessionId: session?.id ?? null,
    type: "thread.unarchive",
    payload: JSON.stringify({
      type: "thread.unarchive",
      environmentId: args.environment.id,
      threadId: args.thread.id,
      providerId: args.thread.providerId,
      providerThreadId: args.providerThreadId,
    }),
  });
  return true;
}

export function queueThreadDeletedCommandInTransaction(
  db: DbTransaction,
  args: QueueThreadDeletedCommandArgs,
): boolean {
  const session = getActiveSession(db, args.environment.hostId);
  if (!session) {
    return false;
  }
  queueCommandInTransaction(db, {
    hostId: args.environment.hostId,
    sessionId: session.id,
    type: "thread.deleted",
    payload: JSON.stringify({
      type: "thread.deleted",
      environmentId: args.environment.id,
      threadId: args.threadId,
    }),
  });
  return true;
}

export function buildThreadStopCommand(
  args: QueueThreadStopCommandArgs,
): Extract<HostDaemonCommand, { type: "thread.stop" }> {
  return {
    type: "thread.stop",
    environmentId: args.environmentId,
    threadId: args.threadId,
  };
}
