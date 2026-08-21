import { environments, events, threads } from "@bb/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  PromptInput,
  PromptMode,
  ProjectExecutionDefaults,
  PermissionEscalation,
  ResolvedThreadExecutionOptions,
  RuntimeThreadExecutionOptions,
  Thread,
  ClientTurnRequestId,
  EnvironmentStatus,
  promptInputHasCommandMention,
} from "@bb/domain";
import {
  type HostDaemonCommand,
  type ThreadStopIntent,
  type TurnSubmitTarget,
} from "@bb/host-daemon-contract";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import { ApiError } from "../../errors.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import { getLastProviderThreadId } from "./thread-events.js";
import type { ThreadForkDescriptor } from "./thread-provisioning-context.js";
import {
  resolveThreadRuntimeCommandConfig,
  type ResolvedThreadRuntimeCommandConfig,
  type ThreadRuntimeCommandEnvironment,
} from "./thread-runtime-config.js";
import {
  buildExistingThreadExecutionInput,
  resolveExistingThreadExecutionPlan,
  type ExistingThreadExecutionInputRequest,
} from "./thread-execution-plan.js";
import { clampPermissionModeToHost } from "../hosts/permission-ceiling.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { resolveProviderPlanCommand } from "../providers/provider-plan-command.js";
import { workspaceContextFromPath } from "../environments/workspace-command-target.js";
import { resolveAcpLaunchSpecForProviderId } from "../system/acp-launch-spec.js";
import {
  requireBridgeLaunchForProviderId,
  resolveBridgeLaunchForProviderId,
} from "../system/provider-bridge-launch.js";

type ExecutionOptionsRequest = ExistingThreadExecutionInputRequest;

export interface ThreadStopCommandArgs {
  environmentId: string;
  hostId: string;
  intent: ThreadStopIntent;
  threadId: string;
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
  environment: ThreadRuntimeCommandEnvironment;
  execution: ResolvedThreadExecutionOptions;
  // Non-null ⇒ clone the parent's provider session at its branch point (native
  // fork) instead of starting fresh. null ⇒ a normal start.
  fork: ThreadForkDescriptor | null;
  permissionEscalation: PermissionEscalation;
  input: PromptInput[];
  inputGroups?: PromptInput[][];
  projectId: string;
  providerId: string;
  requestId: ClientTurnRequestId;
  syncGeneratedTitle: boolean;
  thread: Thread;
}

interface PreparedTurnSubmitCommandBuildArgs {
  deps: Pick<
    AppDeps,
    "config" | "db" | "providerRegistry" | "pluginHostArtifacts"
  >;
  environmentId: string;
  hostId: string;
  execution: ResolvedThreadExecutionOptions;
  permissionEscalation: PermissionEscalation;
  input: PromptInput[];
  inputGroups?: PromptInput[][];
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
  inputGroups?: PromptInput[][];
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
  deps: Pick<AppDeps, "db" | "providerRegistry">;
  execution: ResolvedThreadExecutionOptions;
  hostId: string;
  input: PromptInput[];
  permissionEscalation: PermissionEscalation;
  projectId: string;
  providerId: string;
  threadId: string;
}

interface BuildExecutionOptionsArgs {
  /** Machine the work lands on; omit to read it from the thread's environment. */
  hostId?: string | null;
  projectDefaults?: ProjectExecutionDefaults | null;
  threadId: string;
}

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

function providerSupportsThreadRename(
  registry: ProviderRegistryService,
  providerId: string,
): boolean {
  const registration = registry.get(providerId);
  if (!registration) {
    // Unregistered ids (dynamic/custom ACP agents) keep receiving renames,
    // exactly as they did before the registry.
    return true;
  }
  return registration.info.capabilities.supportsThreadRename;
}

function providerSupportsThreadArchiveForwarding(
  registry: ProviderRegistryService,
  providerId: string,
): boolean {
  const registration = registry.get(providerId);
  if (!registration) {
    return false;
  }
  return registration.info.capabilities.supportsThreadArchive;
}

/**
 * The BB prompt mode this prompt entered, if any. Plan mode is entered through
 * the provider's declared `plan` composer action, so a provider that declares
 * none never sees `promptMode` — the `/plan` text stays an ordinary mention.
 */
function resolvePromptMode(
  registry: ProviderRegistryService,
  args: { input: PromptInput[]; providerId: string },
): PromptMode | undefined {
  const planCommand = resolveProviderPlanCommand(registry, args.providerId);
  if (planCommand === null) return undefined;
  return promptInputHasCommandMention(args.input, {
    trigger: planCommand.trigger,
    name: planCommand.name,
  })
    ? "plan"
    : undefined;
}

/**
 * Last-mile clamp before the daemon runs the turn. The execution plan already
 * clamps, but a queued message carries the mode it was enqueued with, so the
 * machine's current ceiling is re-applied here.
 */
function toRuntimeExecutionOptions(
  args: RuntimeExecutionOptionsArgs,
): RuntimeThreadExecutionOptions {
  const permissionMode = clampPermissionModeToHost(args.deps, {
    hostId: args.hostId,
    permissionMode: args.execution.permissionMode,
    providerId: args.providerId,
  });
  const promptMode = resolvePromptMode(args.deps.providerRegistry, {
    input: args.input,
    providerId: args.providerId,
  });
  // The owning plugin derives its provider-scoped options per command; an
  // unregistered id (a dynamic ACP agent) derives none. A hook that throws
  // fails the command with the plugin named rather than running the turn
  // with default knobs.
  const providerOptions =
    args.deps.providerRegistry.get(args.providerId)?.deriveProviderOptions({
      threadId: args.threadId,
      projectId: args.projectId,
      model: args.execution.model,
      permissionMode,
      ...(promptMode !== undefined ? { promptMode } : {}),
    }) ?? {};
  const base = {
    model: args.execution.model,
    serviceTier: args.execution.serviceTier,
    reasoningLevel: args.execution.reasoningLevel,
    ...(promptMode !== undefined ? { promptMode } : {}),
    providerOptions,
  };
  if (permissionMode === "full") {
    return {
      ...base,
      permissionMode,
      permissionScope: "full",
      approvalReviewer: null,
      permissionEscalation: null,
    };
  }
  if (permissionMode === "auto") {
    return {
      ...base,
      permissionMode: "auto",
      permissionScope: "workspace",
      approvalReviewer: "automatic",
      permissionEscalation: args.permissionEscalation,
    };
  }
  return {
    ...base,
    permissionMode: "accept-edits",
    permissionScope: "workspace",
    approvalReviewer: "user",
    permissionEscalation: args.permissionEscalation,
  };
}

export async function buildExecutionOptions(
  deps: Pick<AppDeps, "db" | "hub" | "providerRegistry">,
  request: ExecutionOptionsRequest,
  args: BuildExecutionOptionsArgs,
): Promise<ResolvedThreadExecutionOptions> {
  const plan = await resolveExistingThreadExecutionPlan(deps, {
    ...(args.projectDefaults !== undefined
      ? { projectDefaults: args.projectDefaults }
      : {}),
    ...(args.hostId !== undefined ? { hostId: args.hostId } : {}),
    executionSource: "client/turn/requested",
    input: buildExistingThreadExecutionInput(request),
    threadId: args.threadId,
  });
  return plan.resolvedExecution;
}

export async function buildThreadStartCommand(
  deps: LoggedWorkSessionDeps,
  args: ThreadStartCommandArgs,
): Promise<Extract<HostDaemonCommand, { type: "thread.start" }>> {
  // A graduated provider only has a bridge while its plugin is registered, and
  // plugins load after the listener starts serving. Wait, or a turn submitted
  // during that window has no bridgeLaunch to carry and is refused.
  await deps.providerRegistry.whenRegistrationsSettled();
  const runtimeContext = await resolveThreadRuntimeCommandConfig(deps, {
    thread: args.thread,
    environment: args.environment,
    model: args.execution.model,
  });
  const acpLaunchSpec = resolveAcpLaunchSpecForProviderId(
    deps,
    args.providerId,
  );
  const bridgeLaunch = requireBridgeLaunchForProviderId(deps, args.providerId);
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
    ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
    bridgeLaunch,
    requestId: args.requestId,
    input: args.input,
    ...(args.inputGroups !== undefined
      ? { inputGroups: args.inputGroups }
      : {}),
    options: toRuntimeExecutionOptions({
      ...args,
      deps,
      hostId: args.environment.hostId,
      input: args.input,
      threadId: args.thread.id,
    }),
    instructions: runtimeContext.instructions,
    dynamicTools: runtimeContext.dynamicTools,
    injectedSkillSources: runtimeContext.injectedSkillSources,
    instructionMode: runtimeContext.instructionMode,
    threadStoragePath: runtimeContext.threadStoragePath,
    ...(args.fork ? { fork: args.fork } : {}),
  };
}

function buildPreparedTurnSubmitCommandPayload(
  args: PreparedTurnSubmitCommandBuildArgs,
): PreparedTurnSubmitCommandPayload {
  const acpLaunchSpec = resolveAcpLaunchSpecForProviderId(
    args.deps,
    args.runtimeContext.providerId,
  );
  const bridgeLaunch = requireBridgeLaunchForProviderId(
    args.deps,
    args.runtimeContext.providerId,
  );
  return {
    type: "turn.submit",
    environmentId: args.environmentId,
    threadId: args.threadId,
    ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
    bridgeLaunch,
    input: args.input,
    ...(args.inputGroups !== undefined
      ? { inputGroups: args.inputGroups }
      : {}),
    options: toRuntimeExecutionOptions({
      ...args,
      input: args.input,
      projectId: args.runtimeContext.projectId,
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
      ...(acpLaunchSpec !== undefined ? { acpLaunchSpec } : {}),
      bridgeLaunch,
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
  await deps.providerRegistry.whenRegistrationsSettled();
  const providerThreadId = requireProviderThreadId(
    args.providerThreadId ?? getLastProviderThreadId(deps, args.thread.id),
    args.thread.id,
  );
  const runtimeContext = await resolveThreadRuntimeCommandConfig(deps, {
    thread: args.thread,
    environment: args.environment,
    model: args.execution.model,
  });
  return buildPreparedTurnSubmitCommandPayload({
    deps,
    environmentId: args.environment.id,
    hostId: args.environment.hostId,
    execution: args.execution,
    permissionEscalation: args.permissionEscalation,
    input: args.input,
    ...(args.inputGroups !== undefined
      ? { inputGroups: args.inputGroups }
      : {}),
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
  if (!providerSupportsThreadRename(deps.providerRegistry, args.providerId)) {
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

  if (
    !providerSupportsThreadArchiveForwarding(
      deps.providerRegistry,
      thread.providerId,
    )
  ) {
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

  // Archive can have to spawn the provider bridge from scratch (fresh daemon,
  // reaped idle session), so it carries the same launch spec as thread.start.
  // Forwarding is best-effort: with no bridge there is nothing to mirror the
  // archive onto, so skip rather than dispatch a command the daemon rejects.
  const bridgeLaunch = resolveBridgeLaunchForProviderId(
    deps,
    thread.providerId,
  );
  if (bridgeLaunch === null) {
    return false;
  }

  startLiveHostCommand(deps, {
    command: {
      type: "thread.archive",
      environmentId: environment.id,
      threadId: thread.id,
      workspaceContext,
      providerId: thread.providerId,
      providerThreadId,
      bridgeLaunch,
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
  if (
    !providerSupportsThreadArchiveForwarding(
      deps.providerRegistry,
      args.thread.providerId,
    )
  ) {
    return false;
  }
  if (args.environment.status !== "ready") {
    return false;
  }

  // Unarchive always runs on a fresh provider-maintenance runtime, so it can
  // never reuse a live process and must carry its own launch spec. Same
  // best-effort rule as archive: no bridge, nothing to unarchive on.
  const bridgeLaunch = resolveBridgeLaunchForProviderId(
    deps,
    args.thread.providerId,
  );
  if (bridgeLaunch === null) {
    return false;
  }

  startLiveHostCommand(deps, {
    command: {
      type: "thread.unarchive",
      environmentId: args.environment.id,
      threadId: args.thread.id,
      providerId: args.thread.providerId,
      providerThreadId: args.providerThreadId,
      bridgeLaunch,
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
    intent: args.intent,
    threadId: args.threadId,
  };
}
