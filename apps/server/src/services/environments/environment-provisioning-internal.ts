import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  events,
  type DbConnection,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
  getEnvironment,
  getThread,
  listStoredThreadProvisioningRowsByProvisioningId,
  threads,
} from "@bb/db";
import {
  applyProvisionedEnvironmentRecord,
  setEnvironmentStatus,
} from "@bb/db/internal-environment-lifecycle";
import type {
  Environment,
  ProvisioningTranscriptEntry,
  SystemThreadProvisioningStatus,
  ThreadStatus,
} from "@bb/domain";
import {
  systemThreadProvisioningEventDataSchema,
  threadScope,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  appendSystemErrorEventInTransaction,
  appendThreadProvisioningEventInTransaction,
  buildCwdBranchEntries,
} from "../threads/thread-events.js";
import {
  buildEnvironmentProvisionCommand,
  buildManagedBranchName,
  SETUP_TIMEOUT_MS,
  requireSourceForHost,
  storedBaseBranchNameToSpec,
} from "../threads/thread-create-helpers.js";
import {
  resolveManagedTargetPath,
  resolvePersonalTargetPath,
} from "../threads/worktree-paths.js";
import {
  buildDirectEnvironmentProvisionRequest,
  type EnvironmentProvisionRequest,
} from "./environment-provision-request.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import {
  createLiveHostCommandExecution,
  expectedLiveHostCommandErrorLogFields,
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
} from "../hosts/live-command.js";
import { tryTransitionInTransaction } from "../threads/thread-transitions.js";
import {
  forgetActiveThreadProvisionContext,
  getActiveThreadProvisionContext,
} from "../threads/thread-provisioning-active-context.js";
import {
  advanceThreadProvisioning,
  recordThreadProvisionWorkspaceReadyInTransaction,
} from "../threads/thread-provisioning.js";
import {
  finalizeStoppedThreadAndRequestCleanupAdvance,
  finalizeStoppedThreadInTransaction,
  requestThreadStopForCurrentState,
} from "../threads/thread-lifecycle.js";
import {
  requestEnvironmentCleanup,
  runEnvironmentCleanupAdvance,
} from "./environment-cleanup-internal.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultPostCommitAction,
  type CommandResultSideEffectsDeps,
  type CommandResultReportForType,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandExecutionRecord,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";

type EnvironmentProvisionCommand =
  HostDaemonCommandForType<"environment.provision">;
type EnvironmentProvisionCommandResultReport =
  CommandResultReportForType<"environment.provision">;
type EnvironmentProvisionCancelCommand =
  HostDaemonCommandForType<"environment.provision.cancel">;
type EnvironmentProvisionCancelCommandResultReport =
  CommandResultReportForType<"environment.provision.cancel">;

interface EnvironmentProvisionReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentProvisionWriteDeps extends EnvironmentProvisionReadDeps {
  db: DbConnection | DbTransaction;
  hub: DbNotifier;
}

interface EnvironmentProvisionTransactionDeps extends EnvironmentProvisionWriteDeps {
  db: DbTransaction;
  logger: AppDeps["logger"];
  pendingInteractions: AppDeps["pendingInteractions"];
}

interface RequestEnvironmentProvisioningArgs {
  environmentId: string;
}

interface AdvanceEnvironmentProvisioningArgs {
  environmentId: string | null | undefined;
  request?: EnvironmentProvisionRequest | null;
}

interface SettleEnvironmentProvisionCommandResultArgs {
  command: EnvironmentProvisionCommand;
  deps: EnvironmentProvisionTransactionDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: EnvironmentProvisionCommandResultReport;
}

interface SettleEnvironmentProvisionCancelCommandResultArgs {
  command: EnvironmentProvisionCancelCommand;
  deps: EnvironmentProvisionTransactionDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: EnvironmentProvisionCancelCommandResultReport;
}

interface FailEnvironmentProvisioningDurablyArgs {
  environmentId: string;
  failureEntry: ProvisioningTranscriptEntry;
  failureReason: string;
  provisioningId: string;
}

interface StartTrackedEnvironmentProvisionCommandArgs {
  environment: Environment;
  request: EnvironmentProvisionRequest;
}

interface InterruptUnrecoverableEnvironmentProvisioningArgs {
  environmentId: string;
  reason: string;
}

interface LiveEnvironmentThread {
  environmentId: string | null;
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

interface StopRequestedEnvironmentProvisionThread {
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

interface AppendThreadProvisioningEventToEnvironmentThreadsArgs {
  entries: ProvisioningTranscriptEntry[];
  environmentId: string;
  fallbackProvisioningId: string;
  status: SystemThreadProvisioningStatus;
  threads?: LiveEnvironmentThread[];
}

function listLiveEnvironmentThreads(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
): LiveEnvironmentThread[] {
  return deps.db
    .select({
      environmentId: threads.environmentId,
      id: threads.id,
      status: threads.status,
      stopRequestedAt: threads.stopRequestedAt,
    })
    .from(threads)
    .where(
      and(eq(threads.environmentId, environmentId), isNull(threads.deletedAt)),
    )
    .all();
}

function listStopRequestedEnvironmentProvisionThreads(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
): StopRequestedEnvironmentProvisionThread[] {
  return deps.db
    .select({
      id: threads.id,
      status: threads.status,
      stopRequestedAt: threads.stopRequestedAt,
    })
    .from(threads)
    .where(
      and(
        eq(threads.environmentId, environmentId),
        inArray(threads.status, ["created", "provisioning"]),
        // This settlement is for explicit user stop intent only. Archived and
        // deleted threads continue through their existing cleanup paths.
        isNull(threads.archivedAt),
        isNull(threads.deletedAt),
        isNotNull(threads.stopRequestedAt),
      ),
    )
    .all();
}

function resolveLiveThreadProvisioningId(
  thread: LiveEnvironmentThread,
  fallbackProvisioningId: string,
): string {
  const context = getActiveThreadProvisionContext(thread.id);
  if (context?.state.environmentId === thread.environmentId) {
    return context.state.provisioningId;
  }
  return fallbackProvisioningId;
}

function appendThreadProvisioningEventToEnvironmentThreadsInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: AppendThreadProvisioningEventToEnvironmentThreadsArgs,
): void {
  const liveThreads =
    args.threads ?? listLiveEnvironmentThreads(deps, args.environmentId);

  for (const thread of liveThreads) {
    const provisioningId = resolveLiveThreadProvisioningId(
      thread,
      args.fallbackProvisioningId,
    );
    appendThreadProvisioningEventInTransaction(deps.db, {
      entries: args.entries,
      environmentId: args.environmentId,
      provisioningId,
      status: args.status,
      threadId: thread.id,
    });
    deps.hub.notifyThread(thread.id, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });
  }
}

function isWorkspaceProvisioningTranscriptEntry(
  entry: ProvisioningTranscriptEntry,
): boolean {
  return WORKSPACE_PROVISIONING_TRANSCRIPT_KEYS.has(entry.key);
}

const WORKSPACE_PROVISIONING_TRANSCRIPT_KEYS = new Set([
  "git-checkout-completed",
  "git-checkout-failed",
  "git-checkout-started",
  "git-clone-completed",
  "git-clone-failed",
  "git-clone-started",
  "git-worktree-command",
  "git-worktree-completed",
  "git-worktree-failed",
  "git-worktree-started",
  "setup-completed",
  "setup-failed",
  "setup-started",
  "workspace-branch",
  "workspace-path",
  "workspace-source",
  "workspace-target",
]);

const activeEnvironmentProvisionRpcEnvironmentIds = new Set<string>();

export function hasLiveEnvironmentProvisionInFlight(
  environmentId: string,
): boolean {
  return activeEnvironmentProvisionRpcEnvironmentIds.has(environmentId);
}

function hasStreamedProvisioningTranscript(
  deps: EnvironmentProvisionReadDeps,
  threadId: string,
  provisioningId: string,
): boolean {
  const rows = listStoredThreadProvisioningRowsByProvisioningId(deps.db, {
    threadId,
    provisioningId,
  });

  return rows.some((row) => {
    const eventData = systemThreadProvisioningEventDataSchema.parse(
      JSON.parse(row.data),
    );
    return (
      eventData.provisioningId === provisioningId &&
      eventData.entries.some(isWorkspaceProvisioningTranscriptEntry)
    );
  });
}

function hasActiveThreadProvisioningContext(
  thread: LiveEnvironmentThread,
): boolean {
  const context = getActiveThreadProvisionContext(thread.id);
  return context?.state.environmentId === thread.environmentId;
}

function hasThreadProvisionCancellationIntent(
  deps: EnvironmentProvisionReadDeps,
  threadId: string,
): boolean {
  return getThread(deps.db, threadId)?.stopRequestedAt !== null;
}

interface HasThreadProvisionCancellationOutcomeArgs {
  provisioningId: string;
  threadId: string;
}

interface HasLatestThreadProvisionCancellationOutcomeArgs {
  environmentId: string | null;
  threadId: string;
}

function hasThreadProvisionCancellationOutcome(
  deps: EnvironmentProvisionReadDeps,
  args: HasThreadProvisionCancellationOutcomeArgs,
): boolean {
  const rows = listStoredThreadProvisioningRowsByProvisioningId(deps.db, {
    provisioningId: args.provisioningId,
    threadId: args.threadId,
  });

  return rows.some((row) => {
    const eventData = systemThreadProvisioningEventDataSchema.parse(
      JSON.parse(row.data),
    );
    return (
      eventData.provisioningId === args.provisioningId &&
      eventData.status === "cancelled"
    );
  });
}

function hasLatestThreadProvisionCancellationOutcome(
  deps: EnvironmentProvisionReadDeps,
  args: HasLatestThreadProvisionCancellationOutcomeArgs,
): boolean {
  if (args.environmentId === null) {
    return false;
  }

  const row = deps.db
    .select({ data: events.data })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.environmentId, args.environmentId),
        eq(events.type, "system/thread-provisioning"),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  if (!row) {
    return false;
  }

  const eventData = systemThreadProvisioningEventDataSchema.parse(
    JSON.parse(row.data),
  );
  return eventData.status === "cancelled";
}

interface ShouldPreserveThreadProvisionCancellationOutcomeArgs {
  provisioningId: string;
  thread: LiveEnvironmentThread;
}

function shouldPreserveThreadProvisionCancellationOutcome(
  deps: EnvironmentProvisionReadDeps,
  args: ShouldPreserveThreadProvisionCancellationOutcomeArgs,
): boolean {
  return (
    args.thread.stopRequestedAt !== null ||
    hasThreadProvisionCancellationIntent(deps, args.thread.id) ||
    hasThreadProvisionCancellationOutcome(deps, {
      provisioningId: args.provisioningId,
      threadId: args.thread.id,
    }) ||
    hasLatestThreadProvisionCancellationOutcome(deps, {
      environmentId: args.thread.environmentId,
      threadId: args.thread.id,
    })
  );
}

interface HasOnlyCancelledOrStoppedProvisioningOutcomeThreadsArgs {
  provisioningId: string;
  threads: LiveEnvironmentThread[];
}

interface RestoreProvisioningEnvironmentAfterCancelledProvisioningOutcomeArgs {
  environment: Environment;
}

function hasOnlyCancelledOrStoppedProvisioningOutcomeThreads(
  deps: EnvironmentProvisionReadDeps,
  args: HasOnlyCancelledOrStoppedProvisioningOutcomeThreadsArgs,
): boolean {
  return (
    args.threads.length > 0 &&
    args.threads.every((thread) =>
      shouldPreserveThreadProvisionCancellationOutcome(deps, {
        provisioningId: args.provisioningId,
        thread,
      }),
    )
  );
}

function restoreProvisioningEnvironmentAfterCancelledProvisioningOutcomeInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: RestoreProvisioningEnvironmentAfterCancelledProvisioningOutcomeArgs,
): boolean {
  if (args.environment.status === "destroyed") {
    return false;
  }

  if (args.environment.status === "provisioning") {
    setEnvironmentStatus(deps.db, deps.hub, args.environment.id, {
      status: args.environment.path ? "ready" : "error",
    });
  }

  return true;
}

interface ProvisionedEnvironmentBranchMetadata {
  baseBranch?: string | null;
  mergeBaseBranch?: string | null;
}

function resolveProvisionedEnvironmentBranchMetadata(
  command: EnvironmentProvisionCommand,
): ProvisionedEnvironmentBranchMetadata {
  if (command.workspaceProvisionType !== "unmanaged") {
    return {};
  }

  if (!command.checkout) {
    return {};
  }

  if (command.checkout.kind === "new") {
    return {
      baseBranch: null,
      mergeBaseBranch: command.checkout.baseBranch,
    };
  }

  return {
    baseBranch: null,
    mergeBaseBranch: null,
  };
}

function recordEnvironmentProvisioningFailureInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: FailEnvironmentProvisioningDurablyArgs,
): boolean {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return false;
  }
  const liveThreads = listLiveEnvironmentThreads(deps, environment.id);
  const failureThreads = liveThreads.filter(
    (thread) =>
      !shouldPreserveThreadProvisionCancellationOutcome(deps, {
        provisioningId: args.provisioningId,
        thread,
      }),
  );
  if (
    failureThreads.length === 0 &&
    hasOnlyCancelledOrStoppedProvisioningOutcomeThreads(deps, {
      provisioningId: args.provisioningId,
      threads: liveThreads,
    })
  ) {
    return restoreProvisioningEnvironmentAfterCancelledProvisioningOutcomeInTransaction(
      deps,
      { environment },
    );
  }

  if (environment.status !== "destroyed" && environment.status !== "error") {
    setEnvironmentStatus(deps.db, deps.hub, environment.id, {
      status: "error",
    });
  }

  appendThreadProvisioningEventToEnvironmentThreadsInTransaction(deps, {
    environmentId: environment.id,
    fallbackProvisioningId: args.provisioningId,
    status: "failed",
    threads: failureThreads,
    entries: [args.failureEntry],
  });

  for (const thread of failureThreads) {
    forgetActiveThreadProvisionContext(thread.id);
    appendSystemErrorEventInTransaction(deps, {
      threadId: thread.id,
      environmentId: environment.id,
      code: "thread_provisioning_failed",
      message: "Provisioning thread failed",
      detail: args.failureReason,
      scope: threadScope(),
    });
    tryTransitionInTransaction(deps.db, deps.hub, thread.id, "error");
  }

  return true;
}

export function settleEnvironmentProvisionCommandResult(
  args: SettleEnvironmentProvisionCommandResultArgs,
): CommandResultSideEffectsResult {
  const postCommitActions: CommandResultPostCommitAction[] = [];
  const initiator = args.command.initiator;
  if (!initiator) {
    setEnvironmentStatus(
      args.deps.db,
      args.deps.hub,
      args.command.environmentId,
      {
        status: "error",
      },
    );
    return emptyCommandResultSideEffects();
  }
  const environmentProvisioningId = initiator.provisioningId;

  const boundThreads = args.deps.db
    .select()
    .from(threads)
    .where(eq(threads.environmentId, args.command.environmentId))
    .all();

  if (args.report.ok) {
    applyProvisionedEnvironmentRecord(
      args.deps.db,
      args.deps.hub,
      args.command.environmentId,
      {
        path: args.report.result.path,
        status: "ready",
        isGitRepo: args.report.result.isGitRepo,
        isWorktree: args.report.result.isWorktree,
        branchName: args.report.result.branchName,
        defaultBranch: args.report.result.defaultBranch,
        ...resolveProvisionedEnvironmentBranchMetadata(args.command),
      },
    );
    args.deps.hub.notifyEnvironment(args.command.environmentId, [
      "work-status-changed",
    ]);

    const cwdBranchEntries = buildCwdBranchEntries({
      path: args.report.result.path,
      branchName: args.report.result.branchName,
    });

    for (const thread of boundThreads) {
      if (thread.deletedAt !== null) {
        const finalized = finalizeStoppedThreadInTransaction(args.deps, {
          threadId: thread.id,
        });
        if (finalized) {
          postCommitActions.push({
            name: "Environment cleanup advance after deleted thread finalize",
            context: {
              environmentId: args.command.environmentId,
              threadId: thread.id,
            },
            run: (deps) =>
              runEnvironmentCleanupAdvance(deps, {
                environmentId: args.command.environmentId,
              }),
          });
        } else {
          postCommitActions.push({
            name: "Deleted thread finalization retry after environment provision",
            context: {
              environmentId: args.command.environmentId,
              threadId: thread.id,
            },
            run: (deps) => {
              finalizeStoppedThreadAndRequestCleanupAdvance(deps, {
                threadId: thread.id,
              });
            },
          });
        }
        continue;
      }
      if (
        thread.archivedAt !== null ||
        shouldPreserveThreadProvisionCancellationOutcome(args.deps, {
          provisioningId: environmentProvisioningId,
          thread,
        })
      ) {
        continue;
      }

      const isInitiator = thread.id === args.command.initiator?.threadId;
      const hasStreamedTranscript =
        isInitiator && args.command.initiator
          ? hasStreamedProvisioningTranscript(
              args.deps,
              thread.id,
              args.command.initiator.provisioningId,
            )
          : false;
      const entries = hasStreamedTranscript
        ? []
        : isInitiator && args.report.result.transcript.length > 0
          ? args.report.result.transcript
          : cwdBranchEntries;

      if (!hasActiveThreadProvisioningContext(thread)) {
        appendThreadProvisioningEventInTransaction(args.deps.db, {
          threadId: thread.id,
          environmentId: args.command.environmentId,
          provisioningId: environmentProvisioningId,
          status: thread.status === "provisioning" ? "active" : "completed",
          entries,
        });
        args.deps.hub.notifyThread(thread.id, ["events-appended"], {
          eventTypes: ["system/thread-provisioning"],
        });
        continue;
      }

      recordThreadProvisionWorkspaceReadyInTransaction(args.deps, {
        threadId: thread.id,
        environmentId: args.command.environmentId,
        entries,
      });
      postCommitActions.push({
        name: "Thread provisioning advance after workspace ready",
        context: {
          environmentId: args.command.environmentId,
          threadId: thread.id,
        },
        run: (deps) => advanceThreadProvisioning(deps, { threadId: thread.id }),
      });
    }

    postCommitActions.push({
      name: "Environment cleanup advance after provision result",
      context: {
        environmentId: args.command.environmentId,
      },
      run: (deps) =>
        runEnvironmentCleanupAdvance(deps, {
          environmentId: args.command.environmentId,
        }),
    });
    return { postCommitActions };
  }

  const failureHandled = recordEnvironmentProvisioningFailureInTransaction(
    args.deps,
    {
      environmentId: args.command.environmentId,
      failureReason: args.report.errorMessage,
      provisioningId: environmentProvisioningId,
      failureEntry: {
        type: "step",
        key: "workspace-failed",
        text: "Workspace setup failed",
        status: "failed",
        startedAt: args.execution.createdAt,
        metadata: { durationMs: Date.now() - args.execution.createdAt },
      },
    },
  );
  if (failureHandled) {
    postCommitActions.push({
      name: "Environment cleanup advance after provision failure",
      context: {
        environmentId: args.command.environmentId,
      },
      run: (deps) => {
        requestEnvironmentCleanup(deps, {
          environmentId: args.command.environmentId,
        });
        runEnvironmentCleanupAdvance(deps, {
          environmentId: args.command.environmentId,
        });
      },
    });
  }
  return { postCommitActions };
}

export function settleEnvironmentProvisionCancelCommandResult(
  args: SettleEnvironmentProvisionCancelCommandResultArgs,
): CommandResultSideEffectsResult {
  const stoppedThreads = listStopRequestedEnvironmentProvisionThreads(
    args.deps,
    args.command.environmentId,
  );
  if (!args.report.ok) {
    const environment = getEnvironment(
      args.deps.db,
      args.command.environmentId,
    );
    args.deps.logger.warn(
      {
        activeProvisionState:
          environment?.status === "provisioning" ? "provisioning" : null,
        executionId: args.execution.id,
        environmentId: args.command.environmentId,
        errorCode: args.report.errorCode,
        errorMessage: args.report.errorMessage,
        stoppedThreadCount: stoppedThreads.length,
        stoppedThreadIds: stoppedThreads.map((thread) => thread.id),
      },
      "Environment provision cancel command failed",
    );

    if (!environment || stoppedThreads.length === 0) {
      return emptyCommandResultSideEffects();
    }

    return {
      postCommitActions: [
        {
          name: "Retry thread stop after provision cancellation failure",
          context: {
            environmentId: args.command.environmentId,
          },
          run: (deps) => {
            for (const thread of stoppedThreads) {
              requestThreadStopForCurrentState(
                deps,
                {
                  environmentId: args.command.environmentId,
                  id: thread.id,
                  status: thread.status,
                  stopRequestedAt: thread.stopRequestedAt,
                },
                {
                  hostId: environment.hostId,
                  id: environment.id,
                },
              );
            }
          },
        },
      ],
    };
  }

  const postCommitActions: CommandResultPostCommitAction[] = [];
  const environment = getEnvironment(args.deps.db, args.command.environmentId);
  const restoredProvisioningEnvironment =
    environment?.status === "provisioning";
  if (environment?.status === "provisioning") {
    setEnvironmentStatus(args.deps.db, args.deps.hub, environment.id, {
      status: environment.path ? "ready" : "error",
    });
  }

  let finalizedThread = false;
  for (const thread of stoppedThreads) {
    finalizedThread =
      finalizeStoppedThreadInTransaction(args.deps, {
        threadId: thread.id,
      }) || finalizedThread;
  }

  if (finalizedThread || restoredProvisioningEnvironment) {
    postCommitActions.push({
      name: "Environment cleanup advance after provision cancellation",
      context: {
        environmentId: args.command.environmentId,
      },
      run: (deps) => {
        requestEnvironmentCleanup(deps, {
          environmentId: args.command.environmentId,
        });
        runEnvironmentCleanupAdvance(deps, {
          environmentId: args.command.environmentId,
        });
      },
    });
  }

  return { postCommitActions };
}

export function requestEnvironmentProvisioning(
  deps: EnvironmentProvisionWriteDeps,
  args: RequestEnvironmentProvisioningArgs,
): void {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return;
  }
  if (environment.status !== "provisioning") {
    setEnvironmentStatus(deps.db, deps.hub, environment.id, {
      status: "provisioning",
    });
  }
}

export function interruptUnrecoverableEnvironmentProvisioning(
  deps: CommandResultSideEffectsDeps,
  args: InterruptUnrecoverableEnvironmentProvisioningArgs,
): void {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || environment.status !== "provisioning") {
    return;
  }

  const now = Date.now();
  deps.db.transaction(
    (tx) => {
      recordEnvironmentProvisioningFailureInTransaction(
        {
          ...deps,
          db: tx,
        },
        {
          environmentId: environment.id,
          failureReason: args.reason,
          provisioningId: `env-${environment.id}-interrupted`,
          failureEntry: {
            type: "step",
            key: "workspace-failed",
            text: "Workspace setup interrupted",
            status: "failed",
            startedAt: now,
            metadata: { durationMs: 0 },
          },
        },
      );
    },
    { behavior: "immediate" },
  );
}

function startTrackedEnvironmentProvisionCommand(
  deps: CommandResultSideEffectsDeps,
  args: StartTrackedEnvironmentProvisionCommandArgs,
): void {
  if (hasLiveEnvironmentProvisionInFlight(args.environment.id)) {
    return;
  }
  const execution = createLiveHostCommandExecution(args.environment.hostId);
  activeEnvironmentProvisionRpcEnvironmentIds.add(args.environment.id);
  void runLiveHostCommand(deps, {
    command: args.request.command,
    execution,
    hostId: args.environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  })
    .catch((error) => {
      const expectedErrorFields =
        error instanceof Error
          ? expectedLiveHostCommandErrorLogFields(error)
          : null;
      if (expectedErrorFields !== null) {
        deps.logger.debug(
          {
            commandType: args.request.command.type,
            environmentId: args.environment.id,
            ...expectedErrorFields,
            executionId: execution.id,
            hostId: args.environment.hostId,
            initiatorThreadId: args.request.command.initiator?.threadId ?? null,
            provisioningId:
              args.request.command.initiator?.provisioningId ?? null,
          },
          "Live environment provisioning cancelled",
        );
        return;
      }
      deps.logger.warn(
        {
          commandType: args.request.command.type,
          err: error,
          environmentId: args.environment.id,
          executionId: execution.id,
          hostId: args.environment.hostId,
        },
        "Live environment provision command failed",
      );
    })
    .finally(() => {
      activeEnvironmentProvisionRpcEnvironmentIds.delete(args.environment.id);
    });
}

export async function advanceEnvironmentProvisioning(
  deps: CommandResultSideEffectsDeps,
  args: AdvanceEnvironmentProvisioningArgs,
): Promise<string | null> {
  if (!args.environmentId) {
    return null;
  }

  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || environment.status === "destroyed") {
    return null;
  }
  if (!args.request) {
    if (hasLiveEnvironmentProvisionInFlight(environment.id)) {
      return null;
    }
    interruptUnrecoverableEnvironmentProvisioning(deps, {
      environmentId: environment.id,
      reason:
        "Environment setup did not finish. Retry provisioning to continue.",
    });
    return null;
  }
  startTrackedEnvironmentProvisionCommand(deps, {
    environment,
    request: args.request,
  });
  return null;
}

export const MANAGED_REPROVISION_STARTED = "started" as const;
export const MANAGED_REPROVISION_IN_PROGRESS = "already-provisioning" as const;
interface StartedManagedReprovision {
  provisionEventSequence: number;
  status: typeof MANAGED_REPROVISION_STARTED;
}
type ManagedReprovisionResult =
  | StartedManagedReprovision
  | typeof MANAGED_REPROVISION_IN_PROGRESS;

interface ActiveManagedEnvironmentProvisionArgs {
  environmentId: string;
}

interface DispatchManagedEnvironmentReprovisionArgs {
  environment: Environment;
  projectId: string;
  provisionEventSequence: number;
  provisioningId: string;
  threadId: string;
}

export function hasActiveManagedEnvironmentProvision(
  deps: Pick<AppDeps, "db">,
  args: ActiveManagedEnvironmentProvisionArgs,
): boolean {
  return getEnvironment(deps.db, args.environmentId)?.status === "provisioning";
}

export async function dispatchManagedEnvironmentReprovision(
  deps: CommandResultSideEffectsDeps,
  args: DispatchManagedEnvironmentReprovisionArgs,
): Promise<ManagedReprovisionResult> {
  const provisionType = args.environment.workspaceProvisionType;
  if (!args.environment.managed || provisionType === "unmanaged") {
    throw new ApiError(
      409,
      "invalid_request",
      "Environment cannot be reprovisioned automatically",
      {
        details: {
          managed: args.environment.managed,
          workspaceProvisionType: provisionType,
        },
      },
    );
  }

  if (
    hasActiveManagedEnvironmentProvision(deps, {
      environmentId: args.environment.id,
    })
  ) {
    return MANAGED_REPROVISION_IN_PROGRESS;
  }

  const hostSession = await ensureHostSessionReadyForWork(deps, {
    hostId: args.environment.hostId,
  });

  const initiator = {
    threadId: args.threadId,
    provisioningId: args.provisioningId,
  };
  const command =
    provisionType === "personal"
      ? buildEnvironmentProvisionCommand({
          environmentId: args.environment.id,
          hostId: args.environment.hostId,
          initiator,
          targetPath:
            args.environment.path ??
            resolvePersonalTargetPath({
              dataDir: hostSession.dataDir,
              environmentId: args.environment.id,
            }),
          workspaceProvisionType: provisionType,
        })
      : (() => {
          const source = requireSourceForHost(
            deps,
            args.projectId,
            args.environment.hostId,
          );
          const targetPath =
            args.environment.path ??
            resolveManagedTargetPath({
              dataDir: hostSession.dataDir,
              environmentId: args.environment.id,
              sourcePath: source.path,
            });
          const branchName =
            args.environment.branchName ??
            buildManagedBranchName({ threadId: args.threadId });
          const baseBranch = storedBaseBranchNameToSpec(
            args.environment.baseBranch,
          );
          return buildEnvironmentProvisionCommand({
            branchName,
            baseBranch,
            environmentId: args.environment.id,
            hostId: args.environment.hostId,
            initiator,
            sourcePath: source.path,
            targetPath,
            workspaceProvisionType: provisionType,
            setupTimeoutMs: SETUP_TIMEOUT_MS,
          });
        })();

  requestEnvironmentProvisioning(deps, {
    environmentId: args.environment.id,
  });
  await advanceEnvironmentProvisioning(deps, {
    environmentId: args.environment.id,
    request: buildDirectEnvironmentProvisionRequest({
      command,
      provisioningId: args.provisioningId,
    }),
  });
  return {
    provisionEventSequence: args.provisionEventSequence,
    status: MANAGED_REPROVISION_STARTED,
  };
}
