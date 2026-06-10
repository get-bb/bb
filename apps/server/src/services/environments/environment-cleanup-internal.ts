import type { WorkspaceProvisionType } from "@bb/domain";
import { resolveEnvironmentMergeBaseBranch, threadScope } from "@bb/domain";
import {
  countLiveThreadsInEnvironment,
  getEnvironment,
  getActiveSession,
  hasPendingThreadShutdownInEnvironment,
  listLiveThreadsInEnvironment,
  type RecoverStaleDestroyingEnvironmentCleanupResult,
  type DbNotifier,
  type DbConnection,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";
import {
  claimEnvironmentDestroy,
  clearEnvironmentCleanupRequestRecord,
  recoverStaleDestroyingEnvironmentCleanup,
  recordEnvironmentCleanupRequest,
  restoreEnvironmentAfterDestroyAttemptFailure,
  setEnvironmentRecordDestroyed,
  setEnvironmentStatus,
} from "@bb/db/internal-environment-lifecycle";
import { type HostDaemonOnlineRpcResult } from "@bb/host-daemon-contract";
import {
  emptyCommandResultSideEffects,
  type CommandResultReportForType,
  type CommandResultSideEffectsDeps,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandExecutionRecord,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  createLiveHostCommandExecution,
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import { deferAfterResponse } from "../lib/response-deferral.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { appendSystemErrorEventInTransaction } from "../threads/thread-events.js";
import { tryTransitionInTransaction } from "../threads/thread-transitions.js";
import { workspaceContextFromPath } from "./workspace-command-target.js";

interface EnvironmentDestroyTarget {
  hostId: string;
  id: string;
  path: string;
  workspaceProvisionType: WorkspaceProvisionType;
}

interface AdvanceEnvironmentCleanupArgs {
  environmentId: string;
}

interface RequestEnvironmentCleanupAdvanceArgs {
  environmentId: string | null | undefined;
}

interface RequestEnvironmentCleanupArgs {
  environmentId: string | null | undefined;
}

interface RecoverOrphanedEnvironmentDestroyRequestsArgs {
  now?: number;
  updatedBefore: number;
}

interface CancelPendingEnvironmentCleanupArgs {
  environmentId: string | null | undefined;
}

type CancelPendingEnvironmentCleanupResult =
  | "cancelled"
  | "in_progress"
  | "not_requested";

type EnvironmentDestroyCommand =
  HostDaemonCommandForType<"environment.destroy">;
type EnvironmentDestroyCommandResultReport =
  CommandResultReportForType<"environment.destroy">;

export interface SettleEnvironmentDestroyCommandResultArgs {
  command: EnvironmentDestroyCommand;
  deps: EnvironmentCleanupSettlementDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: EnvironmentDestroyCommandResultReport;
}

interface WouldCleanupEnvironmentArgs {
  environmentId: string | null | undefined;
  excludeThreadId?: string;
}

interface EnvironmentCleanupReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentCleanupWriteDeps extends EnvironmentCleanupReadDeps {
  hub: DbNotifier;
}

type EnvironmentCleanupRecoveryDeps = Pick<AppDeps, "db" | "hub">;

interface EnvironmentCleanupCancellationDeps extends Omit<
  EnvironmentCleanupWriteDeps,
  "db"
> {
  db: DbConnection;
}

interface EnvironmentCleanupSettlementDeps extends EnvironmentCleanupWriteDeps {
  db: DbTransaction;
}

type EnvironmentCleanupDecisionDeps = Pick<AppDeps, "db">;
type EnvironmentCleanupHostConnectionDeps = Pick<AppDeps, "db" | "hub">;
type EnvironmentCleanupPreflightResult =
  HostDaemonOnlineRpcResult<"environment.cleanup_preflight">;

function hasConnectedHostDaemon(
  deps: EnvironmentCleanupHostConnectionDeps,
  hostId: string,
): boolean {
  const session = getActiveSession(deps.db, hostId);
  return (
    session !== null &&
    session.leaseExpiresAt > Date.now() &&
    deps.hub.hasDaemonForHost(hostId)
  );
}

function cleanupPreflightAllowsDestroy(
  result: EnvironmentCleanupPreflightResult,
): boolean {
  switch (result.outcome) {
    case "safe_to_destroy":
    case "already_missing":
    case "not_inspectable":
      return true;
    case "blocked_by_changes":
    case "probe_failed":
      return false;
  }
}

async function workspaceCanBeSafelyCleaned(
  deps: LoggedWorkSessionDeps,
  environmentId: string,
): Promise<boolean> {
  const environment = getEnvironment(deps.db, environmentId);
  if (
    !environment ||
    !environment.managed ||
    environment.status !== "ready" ||
    !environment.path
  ) {
    return false;
  }

  if (!hasConnectedHostDaemon(deps, environment.hostId)) {
    return false;
  }

  if (!environment.isGitRepo) {
    return true;
  }

  const mergeBaseBranch = resolveEnvironmentMergeBaseBranch(environment);
  if (!mergeBaseBranch) {
    return false;
  }

  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: environment.hostId,
    timeoutMs: 30_000,
    command: {
      type: "environment.cleanup_preflight",
      environmentId: environment.id,
      workspaceContext: workspaceContextFromPath({
        path: environment.path,
        workspaceProvisionType: environment.workspaceProvisionType,
      }),
      mergeBaseBranch,
    },
  });
  return cleanupPreflightAllowsDestroy(result);
}

function canRequestCleanup(
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
): boolean {
  return environment.managed && environment.status !== "destroyed";
}

function isDestroyRequested(
  deps: EnvironmentCleanupReadDeps,
  environmentId: string,
): boolean {
  const environment = getEnvironment(deps.db, environmentId);
  return (
    environment !== null &&
    (environment.cleanupMode !== null || environment.status === "destroying")
  );
}

function restoreEnvironmentAfterCleanupCancellation(
  deps: EnvironmentCleanupWriteDeps,
  environment: NonNullable<ReturnType<typeof getEnvironment>>,
): void {
  if (environment.status !== "destroying") {
    return;
  }

  setEnvironmentStatus(deps.db, deps.hub, environment.id, {
    status: environment.path ? "ready" : "error",
  });
}

function markLiveThreadsErroredAfterDestroySuccess(
  deps: EnvironmentCleanupSettlementDeps,
  environmentId: string,
): void {
  const liveThreads = listLiveThreadsInEnvironment(deps.db, { environmentId });
  for (const thread of liveThreads) {
    appendSystemErrorEventInTransaction(deps, {
      threadId: thread.id,
      environmentId,
      code: "environment_workspace_destroyed",
      message:
        "The workspace for this thread was destroyed before the thread could be stopped.",
      scope: threadScope(),
    });
    tryTransitionInTransaction(deps.db, deps.hub, thread.id, "error");
  }
}

export function settleEnvironmentDestroyCommandResult(
  args: SettleEnvironmentDestroyCommandResultArgs,
): CommandResultSideEffectsResult {
  if (!args.report.ok) {
    const failedEnvironment = getEnvironment(
      args.deps.db,
      args.command.environmentId,
    );
    if (failedEnvironment && failedEnvironment.status === "destroying") {
      restoreEnvironmentAfterDestroyAttemptFailure(
        args.deps.db,
        args.deps.hub,
        {
          destroyAttemptId: args.execution.id,
          environmentId: args.command.environmentId,
          status: failedEnvironment.path ? "ready" : "error",
        },
      );
    }
    return emptyCommandResultSideEffects();
  }

  const environment = getEnvironment(args.deps.db, args.command.environmentId);
  if (!environment) {
    return emptyCommandResultSideEffects();
  }
  if (environment.status === "destroying") {
    setEnvironmentRecordDestroyed(
      args.deps.db,
      args.deps.hub,
      args.command.environmentId,
    );
  } else if (environment.status !== "destroyed") {
    return emptyCommandResultSideEffects();
  }

  markLiveThreadsErroredAfterDestroySuccess(
    args.deps,
    args.command.environmentId,
  );

  return {
    postCommitActions: [
      {
        name: "Terminal cleanup after environment destroy",
        context: {
          environmentId: environment.id,
        },
        run: (deps) =>
          deps.terminalSessions.closeDestroyedEnvironmentTerminals({
            environmentId: environment.id,
          }),
      },
    ],
  };
}

export function requestEnvironmentCleanup(
  deps: EnvironmentCleanupWriteDeps,
  args: RequestEnvironmentCleanupArgs,
): void {
  if (!args.environmentId) {
    return;
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || !canRequestCleanup(environment)) {
    return;
  }

  recordEnvironmentCleanupRequest(deps.db, deps.hub, environment.id, {});
}

export function cancelPendingEnvironmentCleanup(
  deps: EnvironmentCleanupCancellationDeps,
  args: CancelPendingEnvironmentCleanupArgs,
): CancelPendingEnvironmentCleanupResult {
  if (!args.environmentId) {
    return "not_requested";
  }

  const environmentId = args.environmentId;
  const notificationBuffer = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx) => {
      const txDeps = {
        db: tx,
        hub: notificationBuffer,
      };
      const environment = getEnvironment(tx, environmentId);
      if (!environment) {
        return "not_requested";
      }

      if (environment.status === "destroying") {
        return "in_progress";
      }

      if (environment.cleanupMode === null) {
        return "not_requested";
      }

      clearEnvironmentCleanupRequestRecord(
        tx,
        notificationBuffer,
        environment.id,
      );
      restoreEnvironmentAfterCleanupCancellation(txDeps, environment);
      return "cancelled";
    },
    { behavior: "immediate" },
  );

  notificationBuffer.flushInto(deps.hub);
  return result;
}

function dispatchEnvironmentDestroy(
  deps: CommandResultSideEffectsDeps,
  environment: EnvironmentDestroyTarget,
  execution: HostDaemonCommandExecutionRecord,
) {
  startLiveHostCommand(deps, {
    command: {
      type: "environment.destroy",
      environmentId: environment.id,
      workspaceContext: workspaceContextFromPath(environment),
    },
    execution,
    hostId: environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        { err: error, environmentId: environment.id },
        "Live environment destroy command failed",
      );
    },
  });
}

export function wouldCleanupEnvironment(
  deps: EnvironmentCleanupDecisionDeps,
  args: WouldCleanupEnvironmentArgs,
): boolean {
  if (!args.environmentId) {
    return false;
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || !environment.managed) {
    return false;
  }

  return (
    countLiveThreadsInEnvironment(deps.db, {
      environmentId: environment.id,
      excludeThreadId: args.excludeThreadId,
    }) === 0
  );
}

export function recoverOrphanedEnvironmentDestroyRequests(
  deps: EnvironmentCleanupRecoveryDeps,
  args: RecoverOrphanedEnvironmentDestroyRequestsArgs,
): RecoverStaleDestroyingEnvironmentCleanupResult {
  return recoverStaleDestroyingEnvironmentCleanup(deps.db, deps.hub, args);
}

async function advanceEnvironmentCleanup(
  deps: CommandResultSideEffectsDeps,
  args: AdvanceEnvironmentCleanupArgs,
): Promise<void> {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (
    !environment ||
    !environment.managed ||
    environment.status === "destroyed" ||
    !isDestroyRequested(deps, args.environmentId)
  ) {
    return;
  }

  if (
    countLiveThreadsInEnvironment(deps.db, { environmentId: environment.id }) >
    0
  ) {
    return;
  }

  if (
    hasPendingThreadShutdownInEnvironment(deps.db, {
      environmentId: environment.id,
    })
  ) {
    return;
  }

  if (!environment.path) {
    if (environment.status === "provisioning") {
      return;
    }

    setEnvironmentRecordDestroyed(deps.db, deps.hub, environment.id);
    return;
  }

  const canDestroyNow = await workspaceCanBeSafelyCleaned(deps, environment.id);
  if (!canDestroyNow) {
    return;
  }

  const refreshedEnvironment = getEnvironment(deps.db, environment.id);
  if (
    !refreshedEnvironment ||
    refreshedEnvironment.status !== "ready" ||
    !refreshedEnvironment.path
  ) {
    return;
  }

  if (
    countLiveThreadsInEnvironment(deps.db, {
      environmentId: refreshedEnvironment.id,
    }) > 0
  ) {
    return;
  }

  if (
    hasPendingThreadShutdownInEnvironment(deps.db, {
      environmentId: refreshedEnvironment.id,
    })
  ) {
    return;
  }

  const execution = createLiveHostCommandExecution(refreshedEnvironment.hostId);
  const claimedEnvironment = claimEnvironmentDestroy(deps.db, deps.hub, {
    destroyAttemptId: execution.id,
    environmentId: refreshedEnvironment.id,
  });
  if (!claimedEnvironment || !claimedEnvironment.path) {
    return;
  }

  dispatchEnvironmentDestroy(
    deps,
    {
      hostId: claimedEnvironment.hostId,
      id: claimedEnvironment.id,
      path: claimedEnvironment.path,
      workspaceProvisionType: claimedEnvironment.workspaceProvisionType,
    },
    execution,
  );
}

export async function runEnvironmentCleanupAdvance(
  deps: CommandResultSideEffectsDeps,
  args: AdvanceEnvironmentCleanupArgs,
): Promise<void> {
  await deps.lifecycleDedupers.environmentCleanupAdvance.run(
    args.environmentId,
    async () => {
      await advanceEnvironmentCleanup(deps, args);
    },
  );
}

export function requestEnvironmentCleanupAdvance(
  deps: CommandResultSideEffectsDeps,
  args: RequestEnvironmentCleanupAdvanceArgs,
): void {
  if (!args.environmentId) {
    return;
  }
  const environmentId = args.environmentId;

  deferAfterResponse({
    config: deps.config,
    context: {
      environmentId,
    },
    logger: deps.logger,
    name: "Environment cleanup advance request",
    work: () => runEnvironmentCleanupAdvance(deps, { environmentId }),
  });
}
