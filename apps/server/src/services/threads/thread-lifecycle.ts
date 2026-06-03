import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
} from "drizzle-orm";
import {
  cancelCommandInTransaction,
  clearThreadStopRequested,
  deleteThread,
  environments,
  events,
  getActiveSession,
  getCommand,
  getEnvironment,
  getThread,
  getThreadOperation,
  getThreadOperationByCommandId,
  listThreadIdsWithLatestHostDaemonRestartInterruption,
  listThreadTurnInterruptionEventStates,
  markThreadStopRequested,
  queueCommand,
  threads,
  transitionThreadStatusInTransaction,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
  type HostDaemonCommandRow,
} from "@bb/db";
import type { ThreadOperationRow } from "@bb/db";
import { assertNever } from "@bb/core-ui";
import { z } from "zod";
import {
  markThreadOperationRecordCompleted,
  markThreadOperationRecordFailed,
  markThreadOperationRecordQueued,
  upsertThreadOperationRecord,
} from "@bb/db/internal-lifecycle";
import {
  isActiveLifecycleOperationState,
  type PromptInput,
  type PermissionEscalation,
  type ResolvedThreadExecutionOptions,
  type SystemThreadInterruptedReason,
  type Thread,
  type ThreadEventScope,
  type ThreadEventType,
  type ThreadStatus,
  type WorkspaceProvisionType,
  systemThreadInterruptedReasonSchema,
  threadScope,
  turnScope,
} from "@bb/domain";
import {
  threadStartCommandSchema,
  threadStopCommandSchema,
} from "@bb/host-daemon-contract";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
  LoggedWorkSessionDeps,
  PendingInteractionWorkSessionDeps,
  WorkSessionDeps,
} from "../../types.js";
import {
  advanceEnvironmentCleanup,
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
  runEnvironmentCleanupAdvance,
} from "../environments/environment-cleanup.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultFailureReportForType,
  type CommandResultPostCommitAction,
  type CommandResultReportForType,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";
import {
  appendSystemErrorEventInTransaction,
  appendThreadEventInTransaction,
  appendThreadEventsInTransaction,
  appendThreadInterruptedEventInTransaction,
  getActiveTurnId,
  getLastProviderThreadId,
} from "./thread-events.js";
import {
  tryTransition,
  tryTransitionInTransaction,
} from "./thread-transitions.js";
import {
  buildThreadStartCommand,
  buildThreadStopCommand,
  queueArchivedThreadProviderArchiveCommand,
  queueThreadDeletedCommandInTransaction,
  queueThreadRenameCommandInTransaction,
  queueTurnSubmitCommand,
  type QueueThreadStartCommandArgs,
  type QueueThreadStopCommandArgs,
} from "./thread-commands.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { createAsyncDeduper } from "../lib/async-deduper.js";
import { parseJsonWithSchema } from "../lib/json-parsing.js";
import { throwThreadNotWritable } from "../lib/lifecycle-api-errors.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  queueManagedThreadTurnNotificationBestEffort,
  type QueueManagedThreadTurnNotificationArgs,
} from "./managed-thread-notifications.js";
import { completeThreadProvisioningForStartHandoff } from "./thread-provisioning-handoff.js";
import { threadProvisionCommonPayloadSchema } from "./thread-provisioning-context.js";
import { isPreStartThreadStatus } from "./thread-status.js";

type QueueReadyThreadTurnCommandResult = "thread.start" | "turn.submit";
type ThreadStartCommand = Awaited<ReturnType<typeof buildThreadStartCommand>>;
type ThreadStopCommand = ReturnType<typeof buildThreadStopCommand>;
type TurnSubmitCommand = HostDaemonCommandForType<"turn.submit">;
type ThreadEventAppendArgs = Parameters<
  typeof appendThreadEventsInTransaction
>[1][number];

type ThreadFailureCommand = ThreadStartCommand | TurnSubmitCommand;

type ThreadFailureResultReport = CommandResultFailureReportForType<
  ThreadFailureCommand["type"]
>;
type ThreadStartCommandResultReport =
  CommandResultReportForType<"thread.start">;
type TurnSubmitCommandResultReport = CommandResultReportForType<"turn.submit">;
type ThreadStopCommandResultReport = CommandResultReportForType<"thread.stop">;

const threadStartRequestDeduper = createAsyncDeduper<string, void>();

export interface AdvanceThreadOperationArgs {
  hostId: string;
  threadId: string;
}

export interface QueueReadyThreadTurnCommandArgs {
  environment: {
    cleanupRequestedAt: number | null;
    hostId: string;
    id: string;
    path: string;
    status: QueueThreadStartCommandArgs["environment"]["status"];
    workspaceProvisionType: WorkspaceProvisionType;
  };
  requestId: QueueThreadStartCommandArgs["requestId"];
  execution: ResolvedThreadExecutionOptions;
  permissionEscalation: PermissionEscalation;
  input: PromptInput[];
  thread: Thread;
}

export interface RequestThreadStopArgs extends QueueThreadStopCommandArgs {
  interruptionReason: SystemThreadInterruptedReason;
  stopRequestedAt: number | null;
}

export interface FinalizeStoppedThreadArgs {
  cancelPendingCommand?: boolean;
  expectedCommandId?: string;
  threadId: string;
}

export interface InterruptActiveTurnForThreadArgs {
  environmentId: string | null;
  reason: SystemThreadInterruptedReason;
  threadId: string;
}

export interface InterruptActiveThreadArgs {
  environmentId: string | null;
  threadId: string;
}

export interface InterruptActiveThreadsArgs {
  reason: SystemThreadInterruptedReason;
  threads: readonly InterruptActiveThreadArgs[];
}

export interface InterruptedActiveThreadResult {
  interruptedTurnId: string | null;
  threadId: string;
}

export interface InterruptActiveThreadsResult {
  threads: InterruptedActiveThreadResult[];
}

export interface ReconcileDaemonReportedThreadsArgs {
  activeThreadIds: readonly string[];
  hostId: string;
}

export interface ThreadStopAndCleanupEnvironment {
  hostId: string;
  id: string;
}

export interface ThreadStopAndCleanupThread {
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

export interface RequestThreadStopAndFinalizeArgs {
  cancelPendingCommand?: boolean;
  environment: ThreadStopAndCleanupEnvironment | null;
  thread: ThreadStopAndCleanupThread;
}

export interface ThreadOperationMutationArgs {
  threadId: string;
}

export interface ThreadOperationCommandMutationArgs {
  commandId: string;
}

export interface FailThreadOperationForCommandArgs extends ThreadOperationCommandMutationArgs {
  failureReason: string;
}

export interface QueueSettledArchivedThreadProviderArchiveCommandArgs {
  threadId: string;
}

interface ThreadCommandResultSettlementDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

export interface SettleThreadCommandFailureArgs {
  command: ThreadFailureCommand;
  deps: ThreadCommandResultSettlementDeps;
  report: ThreadFailureResultReport;
}

export interface SettleThreadStartCommandResultArgs {
  command: ThreadStartCommand;
  commandRow: HostDaemonCommandRow;
  deps: FinalizeStoppedThreadTransactionDeps;
  report: ThreadStartCommandResultReport;
}

export interface SettleTurnSubmitCommandResultArgs {
  command: TurnSubmitCommand;
  deps: ThreadCommandResultSettlementDeps;
  report: TurnSubmitCommandResultReport;
}

export interface SettleThreadStopCommandResultArgs {
  command: ThreadStopCommand;
  commandRow: HostDaemonCommandRow;
  deps: FinalizeStoppedThreadTransactionDeps;
  report: ThreadStopCommandResultReport;
}

interface ThreadStopOperationPayload {
  command: ThreadStopCommand;
  interruptionReason: SystemThreadInterruptedReason;
}

const threadStopOperationPayloadSchema = z.union([
  threadStopCommandSchema.transform(
    (command): ThreadStopOperationPayload => ({
      command,
      interruptionReason: "manual-stop",
    }),
  ),
  z.object({
    command: threadStopCommandSchema,
    interruptionReason: systemThreadInterruptedReasonSchema,
  }),
]);

function nextStatusForInterruptedThread(
  reason: SystemThreadInterruptedReason,
): Extract<ThreadStatus, "idle" | "error"> {
  switch (reason) {
    case "manual-stop":
    case "host-daemon-restarted":
      return "idle";
    case "provider-turn-idle":
      return "error";
    default:
      return assertNever(reason);
  }
}

function pendingInteractionStopReason(
  reason: SystemThreadInterruptedReason,
): string {
  switch (reason) {
    case "manual-stop":
      return "Thread stopped by user request";
    case "host-daemon-restarted":
      return "Host daemon restarted while awaiting user interaction";
    case "provider-turn-idle":
      return "Thread stopped after the provider stopped sending progress";
    default:
      return assertNever(reason);
  }
}

function buildThreadStopOperationPayload(
  args: RequestThreadStopArgs,
): ThreadStopOperationPayload {
  return {
    command: buildThreadStopCommand(args),
    interruptionReason: args.interruptionReason,
  };
}

function parseThreadStopOperationPayload(
  payload: string,
): ThreadStopOperationPayload {
  return parseJsonWithSchema(payload, threadStopOperationPayloadSchema);
}

function readThreadStopInterruptionReason(
  operation: ThreadOperationRow | null,
): SystemThreadInterruptedReason | null {
  if (!operation) {
    return null;
  }
  try {
    return parseThreadStopOperationPayload(operation.payload)
      .interruptionReason;
  } catch {
    return null;
  }
}

function resolveRequestedThreadStopInterruptionReason(
  existingOperation: ThreadOperationRow | null,
  args: RequestThreadStopArgs,
): SystemThreadInterruptedReason {
  if (args.stopRequestedAt === null) {
    return args.interruptionReason;
  }
  return (
    readThreadStopInterruptionReason(existingOperation) ??
    args.interruptionReason
  );
}

interface RequestThreadStartHandoffArgs {
  baseCommand: ThreadStartCommand;
  environmentId: string;
  threadId: string;
}

interface RequestThreadStartHandoffResult {
  completedProvisionSequence: number | null;
  startOperationCreated: boolean;
}

interface ThreadLifecycleReadDeps {
  db: DbQueryConnection;
}

interface ThreadLifecycleWriteDeps extends ThreadLifecycleReadDeps {
  hub: DbNotifier;
}

interface ThreadLifecycleCommandQueueDeps {
  db: AppDeps["db"];
  hub: AppDeps["hub"];
}

interface ThreadLifecycleTransactionDeps extends ThreadLifecycleWriteDeps {
  db: DbTransaction;
}

interface FinalizeStoppedThreadTransactionDeps extends ThreadLifecycleTransactionDeps {
  pendingInteractions: AppDeps["pendingInteractions"];
}

interface HasQueuedThreadOperationCommandArgs {
  commandId: string | null;
  db: DbQueryConnection;
}

interface ApplyActiveTurnInterruptionArgs {
  activeTurnId: string;
  environmentId: string | null;
  providerThreadId: string | null;
  reason: SystemThreadInterruptedReason;
  threadId: string;
}

function hasQueuedThreadOperationCommandForDb(
  args: HasQueuedThreadOperationCommandArgs,
): boolean {
  if (!args.commandId) {
    return false;
  }

  const command = getCommand(args.db, args.commandId);
  return (
    command !== null &&
    (command.state === "pending" || command.state === "fetched")
  );
}

function hasQueuedThreadOperationCommand(
  deps: ThreadLifecycleReadDeps,
  commandId: string | null,
): boolean {
  return hasQueuedThreadOperationCommandForDb({
    db: deps.db,
    commandId,
  });
}

function getActiveThreadOperation(
  deps: ThreadLifecycleReadDeps,
  args: {
    kind: "start" | "stop";
    threadId: string;
  },
) {
  const operation = getThreadOperation(deps.db, args);
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return null;
  }

  return operation;
}

function getActiveThreadOperationByCommandId(
  deps: ThreadLifecycleReadDeps,
  args: {
    commandId: string;
    kind: "start" | "stop";
  },
) {
  const operation = getThreadOperationByCommandId(deps.db, args.commandId);
  if (
    !operation ||
    operation.kind !== args.kind ||
    !isActiveLifecycleOperationState(operation.state)
  ) {
    return null;
  }

  return operation;
}

function getThreadOperationCommandState(
  deps: ThreadLifecycleReadDeps,
  commandId: string | null,
): "pending" | "fetched" | "settled" | null {
  if (!commandId) {
    return null;
  }

  const command = getCommand(deps.db, commandId);
  if (!command) {
    return null;
  }
  if (command.state === "pending" || command.state === "fetched") {
    return command.state;
  }

  return "settled";
}

function applyActiveTurnInterruptionInTransaction(
  db: DbTransaction,
  args: ApplyActiveTurnInterruptionArgs,
): void {
  appendThreadEventInTransaction(db, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    providerThreadId: args.providerThreadId,
    type: "turn/completed",
    scope: turnScope(args.activeTurnId),
    data: {
      providerThreadId: args.providerThreadId,
      status: "interrupted",
    },
  });
  appendThreadInterruptedEventInTransaction(db, {
    threadId: args.threadId,
    reason: args.reason,
  });
  transitionThreadStatusInTransaction(db, {
    id: args.threadId,
    newStatus: nextStatusForInterruptedThread(args.reason),
  });
}

export function hasActiveThreadStartOperation(
  deps: ThreadLifecycleReadDeps,
  threadId: string,
): boolean {
  return (
    getActiveThreadOperation(deps, {
      threadId,
      kind: "start",
    }) !== null
  );
}

export function hasActiveThreadStopOperation(
  deps: ThreadLifecycleReadDeps,
  threadId: string,
): boolean {
  return (
    getActiveThreadOperation(deps, {
      threadId,
      kind: "stop",
    }) !== null
  );
}

export function queueSettledArchivedThreadProviderArchiveCommand(
  deps: ThreadLifecycleCommandQueueDeps,
  args: QueueSettledArchivedThreadProviderArchiveCommandArgs,
): boolean {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.status === "active") {
    return false;
  }
  if (
    hasActiveThreadStartOperation(deps, thread.id) ||
    hasActiveThreadStopOperation(deps, thread.id)
  ) {
    return false;
  }

  return queueArchivedThreadProviderArchiveCommand(deps, {
    threadId: thread.id,
  });
}

function shouldSyncGeneratedThreadTitle(
  deps: ThreadLifecycleReadDeps,
  threadId: string,
): boolean {
  const operation = getThreadOperation(deps.db, {
    threadId,
    kind: "provision",
  });
  if (!operation) {
    return false;
  }
  const request = parseJsonWithSchema(
    operation.payload,
    threadProvisionCommonPayloadSchema,
  );
  return !request.titleProvided;
}

function getThreadFailureCommandErrorScope(
  command: ThreadFailureCommand,
): ThreadEventScope {
  if (command.type !== "turn.submit") {
    return threadScope();
  }

  return command.target.mode !== "start" && command.target.expectedTurnId
    ? turnScope(command.target.expectedTurnId)
    : threadScope();
}

function hasExpectedTurnCompletedEvent(
  deps: ThreadCommandResultSettlementDeps,
  command: ThreadFailureCommand,
): boolean {
  if (command.type !== "turn.submit" || command.target.mode === "start") {
    return false;
  }
  const turnId = command.target.expectedTurnId;
  if (!turnId) {
    return false;
  }

  return (
    deps.db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.threadId, command.threadId),
          eq(events.turnId, turnId),
          eq(events.type, "turn/completed"),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function buildManagedThreadCommandFailureNotification(
  args: QueueManagedThreadTurnNotificationArgs,
): CommandResultPostCommitAction {
  return {
    name: "Managed thread command failure notification",
    context: {
      threadId: args.managedThreadId,
    },
    run: (deps) =>
      queueManagedThreadTurnNotificationBestEffort(deps, {
        managedThreadId: args.managedThreadId,
        managerThreadId: args.managerThreadId,
        title: args.title,
        turnStatus: args.turnStatus,
      }),
  };
}

export function settleThreadCommandFailure(
  args: SettleThreadCommandFailureArgs,
): CommandResultSideEffectsResult {
  const postCommitActions: CommandResultPostCommitAction[] = [];
  const thread = getThread(args.deps.db, args.command.threadId);
  if (!thread || thread.deletedAt !== null) {
    return emptyCommandResultSideEffects();
  }
  if (hasExpectedTurnCompletedEvent(args.deps, args.command)) {
    return emptyCommandResultSideEffects();
  }
  appendSystemErrorEventInTransaction(args.deps, {
    threadId: thread.id,
    environmentId: thread.environmentId,
    code: "thread_command_failed",
    message: `Command ${args.report.type} failed`,
    detail: args.report.errorMessage,
    scope: getThreadFailureCommandErrorScope(args.command),
  });
  tryTransitionInTransaction(args.deps.db, args.deps.hub, thread.id, "error");
  if (thread.parentThreadId !== null) {
    postCommitActions.push(
      buildManagedThreadCommandFailureNotification({
        managedThreadId: thread.id,
        managerThreadId: thread.parentThreadId,
        title: thread.title,
        turnStatus: "failed",
      }),
    );
  }
  return { postCommitActions };
}

export function settleThreadStartCommandResult(
  args: SettleThreadStartCommandResultArgs,
): CommandResultSideEffectsResult {
  const postCommitActions: CommandResultPostCommitAction[] = [];
  const thread = getThread(args.deps.db, args.command.threadId);
  if (!thread) {
    return emptyCommandResultSideEffects();
  }
  if (!args.report.ok) {
    if (
      hasActiveThreadStartOperationForCommand(args.deps, {
        commandId: args.commandRow.id,
      })
    ) {
      failThreadStartForCommand(args.deps, {
        commandId: args.commandRow.id,
        failureReason: args.report.errorMessage,
      });
    }
    return settleThreadCommandFailure({
      command: args.command,
      deps: args.deps,
      report: args.report,
    });
  }

  if (
    !hasActiveThreadStartOperationForCommand(args.deps, {
      commandId: args.commandRow.id,
    })
  ) {
    return emptyCommandResultSideEffects();
  }

  completeThreadStartForCommand(args.deps, {
    commandId: args.commandRow.id,
  });
  const currentThread = getThread(args.deps.db, args.command.threadId);
  if (currentThread && currentThread.deletedAt !== null) {
    const finalized = finalizeStoppedThreadInTransaction(args.deps, {
      threadId: currentThread.id,
    });
    if (finalized) {
      postCommitActions.push({
        name: "Environment cleanup advance after deleted thread start finalize",
        context: {
          environmentId: args.command.environmentId,
          threadId: currentThread.id,
        },
        run: (deps) =>
          runEnvironmentCleanupAdvance(deps, {
            environmentId: args.command.environmentId,
          }),
      });
    }
    return { postCommitActions };
  }
  if (thread.title && shouldSyncGeneratedThreadTitle(args.deps, thread.id)) {
    const queuedRename = queueThreadRenameCommandInTransaction(args.deps.db, {
      environment: {
        id: args.command.environmentId,
        hostId: args.commandRow.hostId,
      },
      providerId: thread.providerId,
      threadId: thread.id,
      title: thread.title,
    });
    if (queuedRename) {
      args.deps.hub.notifyCommand(args.commandRow.hostId);
    }
  }
  return { postCommitActions };
}

export function settleTurnSubmitCommandResult(
  args: SettleTurnSubmitCommandResultArgs,
): CommandResultSideEffectsResult {
  if (!args.report.ok) {
    return settleThreadCommandFailure({
      command: args.command,
      deps: args.deps,
      report: args.report,
    });
  }
  return emptyCommandResultSideEffects();
}

export function ensureThreadCanQueueStartRequest(
  deps: ThreadLifecycleReadDeps,
  thread: Thread,
): void {
  if (
    isPreStartThreadStatus(thread.status) &&
    hasActiveThreadStartOperation(deps, thread.id)
  ) {
    throwThreadNotWritable(
      thread,
      "still_starting",
      "Thread is still starting",
    );
  }
}

export function hasActiveThreadStartOperationForCommand(
  deps: ThreadLifecycleReadDeps,
  args: ThreadOperationCommandMutationArgs,
): boolean {
  return (
    getActiveThreadOperationByCommandId(deps, {
      commandId: args.commandId,
      kind: "start",
    }) !== null
  );
}

export function hasActiveThreadStopOperationForCommand(
  deps: ThreadLifecycleReadDeps,
  args: ThreadOperationCommandMutationArgs,
): boolean {
  return (
    getActiveThreadOperationByCommandId(deps, {
      commandId: args.commandId,
      kind: "stop",
    }) !== null
  );
}

function completeThreadOperation(
  deps: ThreadLifecycleReadDeps,
  args: {
    kind: "start" | "stop";
    threadId: string;
  },
): boolean {
  const operation = getActiveThreadOperation(deps, args);
  if (!operation) {
    return false;
  }

  markThreadOperationRecordCompleted(deps.db, {
    threadId: args.threadId,
    kind: operation.kind,
  });
  return true;
}

function completeThreadOperationForCommand(
  deps: ThreadLifecycleReadDeps,
  args: {
    commandId: string;
    kind: "start" | "stop";
  },
): boolean {
  const operation = getActiveThreadOperationByCommandId(deps, args);
  if (!operation) {
    return false;
  }

  markThreadOperationRecordCompleted(deps.db, {
    threadId: operation.threadId,
    kind: operation.kind,
  });
  return true;
}

function failThreadOperationForCommand(
  deps: ThreadLifecycleReadDeps,
  args: {
    commandId: string;
    failureReason: string;
    kind: "start" | "stop";
  },
): boolean {
  const operation = getActiveThreadOperationByCommandId(deps, args);
  if (!operation) {
    return false;
  }

  markThreadOperationRecordFailed(deps.db, {
    threadId: operation.threadId,
    kind: operation.kind,
    failureReason: args.failureReason,
  });
  return true;
}

export function completeThreadStart(
  deps: ThreadLifecycleReadDeps,
  args: ThreadOperationMutationArgs,
): boolean {
  return completeThreadOperation(deps, {
    threadId: args.threadId,
    kind: "start",
  });
}

export function completeThreadStartForCommand(
  deps: ThreadLifecycleReadDeps,
  args: ThreadOperationCommandMutationArgs,
): boolean {
  return completeThreadOperationForCommand(deps, {
    commandId: args.commandId,
    kind: "start",
  });
}

export function failThreadStartForCommand(
  deps: ThreadLifecycleReadDeps,
  args: FailThreadOperationForCommandArgs,
): boolean {
  return failThreadOperationForCommand(deps, {
    commandId: args.commandId,
    kind: "start",
    failureReason: args.failureReason,
  });
}

export function failThreadStopForCommand(
  deps: ThreadLifecycleReadDeps,
  args: FailThreadOperationForCommandArgs,
): boolean {
  return failThreadOperationForCommand(deps, {
    commandId: args.commandId,
    kind: "stop",
    failureReason: args.failureReason,
  });
}

export function settleThreadStopCommandResult(
  args: SettleThreadStopCommandResultArgs,
): CommandResultSideEffectsResult {
  if (
    !hasActiveThreadStopOperationForCommand(args.deps, {
      commandId: args.commandRow.id,
    })
  ) {
    return emptyCommandResultSideEffects();
  }

  if (!args.report.ok) {
    failThreadStopForCommand(args.deps, {
      commandId: args.commandRow.id,
      failureReason: args.report.errorMessage,
    });
    return emptyCommandResultSideEffects();
  }

  finalizeStoppedThreadInTransaction(args.deps, {
    cancelPendingCommand: false,
    expectedCommandId: args.commandRow.id,
    threadId: args.command.threadId,
  });

  return {
    postCommitActions: [
      {
        name: "Provider archive forwarding after thread stop",
        context: {
          environmentId: args.command.environmentId,
          threadId: args.command.threadId,
        },
        run: (deps) => {
          queueSettledArchivedThreadProviderArchiveCommand(deps, {
            threadId: args.command.threadId,
          });
        },
      },
      {
        name: "Environment cleanup advance after thread stop",
        context: {
          environmentId: args.command.environmentId,
          threadId: args.command.threadId,
        },
        run: (deps) =>
          runEnvironmentCleanupAdvance(deps, {
            environmentId: args.command.environmentId,
          }),
      },
    ],
  };
}

async function advanceActiveThreadStartIfPresent(
  deps: WorkSessionDeps,
  args: QueueThreadStartCommandArgs,
): Promise<boolean> {
  const operation = getThreadOperation(deps.db, {
    threadId: args.thread.id,
    kind: "start",
  });
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return false;
  }

  if (hasQueuedThreadOperationCommand(deps, operation.commandId)) {
    return true;
  }
  if (operation.state !== "requested") {
    return false;
  }

  await advanceThreadStart(deps, {
    hostId: args.environment.hostId,
    threadId: args.thread.id,
  });
  return true;
}

function hasQueuedActiveThreadStart(
  deps: WorkSessionDeps,
  args: QueueThreadStartCommandArgs,
): boolean {
  const operation = getThreadOperation(deps.db, {
    threadId: args.thread.id,
    kind: "start",
  });
  return (
    operation !== null &&
    isActiveLifecycleOperationState(operation.state) &&
    hasQueuedThreadOperationCommand(deps, operation.commandId)
  );
}

/**
 * Makes the provision-to-start durability boundary atomic: after a crash, the
 * thread should have either an active provision op to retry or an active start
 * op for the lifecycle sweep to advance.
 */
function requestThreadStartHandoff(
  deps: Pick<AppDeps, "db" | "hub">,
  args: RequestThreadStartHandoffArgs,
): RequestThreadStartHandoffResult {
  const result: RequestThreadStartHandoffResult = deps.db.transaction(
    (tx) => {
      const existingStartOperation = getThreadOperation(tx, {
        threadId: args.threadId,
        kind: "start",
      });
      if (
        existingStartOperation &&
        isActiveLifecycleOperationState(existingStartOperation.state) &&
        hasQueuedThreadOperationCommandForDb({
          db: tx,
          commandId: existingStartOperation.commandId,
        })
      ) {
        return {
          completedProvisionSequence: null,
          startOperationCreated: false,
        };
      }

      const completedProvisionSequence =
        completeThreadProvisioningForStartHandoff(tx, {
          threadId: args.threadId,
          environmentId: args.environmentId,
        });
      upsertThreadOperationRecord(tx, {
        threadId: args.threadId,
        kind: "start",
        payload: JSON.stringify(args.baseCommand),
      });
      return {
        completedProvisionSequence,
        startOperationCreated: true,
      };
    },
    { behavior: "immediate" },
  );

  if (result.completedProvisionSequence !== null) {
    deps.hub.notifyThread(args.threadId, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });
  }
  return result;
}

export async function requestThreadStart(
  deps: LoggedWorkSessionDeps,
  args: QueueThreadStartCommandArgs,
): Promise<void> {
  await threadStartRequestDeduper.run(args.thread.id, () =>
    requestThreadStartOnce(deps, args),
  );
}

async function requestThreadStartOnce(
  deps: LoggedWorkSessionDeps,
  args: QueueThreadStartCommandArgs,
): Promise<void> {
  if (await advanceActiveThreadStartIfPresent(deps, args)) {
    return;
  }

  const baseCommand = await buildThreadStartCommand(deps, {
    ...args,
  });
  if (hasQueuedActiveThreadStart(deps, args)) {
    return;
  }

  const handoff = requestThreadStartHandoff(deps, {
    baseCommand,
    environmentId: args.environment.id,
    threadId: args.thread.id,
  });
  if (!handoff.startOperationCreated) {
    await advanceActiveThreadStartIfPresent(deps, args);
    return;
  }

  await advanceThreadStart(deps, {
    hostId: args.environment.hostId,
    threadId: args.thread.id,
  });
}

export async function advanceThreadStart(
  deps: WorkSessionDeps,
  args: AdvanceThreadOperationArgs,
): Promise<string | null> {
  const operation = getThreadOperation(deps.db, {
    threadId: args.threadId,
    kind: "start",
  });
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return null;
  }

  if (hasQueuedThreadOperationCommand(deps, operation.commandId)) {
    return operation.commandId;
  }

  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.hostId,
  });

  const command = parseJsonWithSchema(
    operation.payload,
    threadStartCommandSchema,
  );
  const queuedCommand = queueCommand(deps.db, deps.hub, {
    hostId: args.hostId,
    sessionId: session.id,
    type: command.type,
    payload: JSON.stringify(command),
  });
  markThreadOperationRecordQueued(deps.db, {
    threadId: args.threadId,
    kind: "start",
    commandId: queuedCommand.id,
  });
  return queuedCommand.id;
}

export async function queueReadyThreadTurnCommand(
  deps: LoggedWorkSessionDeps,
  args: QueueReadyThreadTurnCommandArgs,
): Promise<QueueReadyThreadTurnCommandResult> {
  const providerThreadId = getLastProviderThreadId(deps, args.thread.id);
  if (providerThreadId) {
    await queueTurnSubmitCommand(deps, {
      thread: args.thread,
      input: args.input,
      requestId: args.requestId,
      execution: args.execution,
      permissionEscalation: args.permissionEscalation,
      environment: args.environment,
      providerThreadId,
      target: { mode: "start" },
    });
    return "turn.submit";
  }

  await requestThreadStart(deps, {
    thread: args.thread,
    environment: args.environment,
    input: args.input,
    managerTemplateName: null,
    requestId: args.requestId,
    execution: args.execution,
    permissionEscalation: args.permissionEscalation,
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
  });
  return "thread.start";
}

export function requestThreadStop(
  deps: Pick<AppDeps, "db" | "hub">,
  args: RequestThreadStopArgs,
): void {
  if (args.stopRequestedAt === null) {
    markThreadStopRequested(deps.db, deps.hub, {
      threadId: args.threadId,
    });
  }

  const existingOperation = getThreadOperation(deps.db, {
    threadId: args.threadId,
    kind: "stop",
  });
  if (
    existingOperation &&
    isActiveLifecycleOperationState(existingOperation.state)
  ) {
    if (hasQueuedThreadOperationCommand(deps, existingOperation.commandId)) {
      return;
    }
    advanceThreadStop(deps, {
      hostId: args.hostId,
      threadId: args.threadId,
    });
    return;
  }

  const payload = buildThreadStopOperationPayload({
    ...args,
    interruptionReason: resolveRequestedThreadStopInterruptionReason(
      existingOperation,
      args,
    ),
  });
  upsertThreadOperationRecord(deps.db, {
    threadId: args.threadId,
    kind: "stop",
    payload: JSON.stringify(payload),
  });
  advanceThreadStop(deps, {
    hostId: args.hostId,
    threadId: args.threadId,
  });
}

export function requestThreadStopIfNeeded(
  deps: Pick<AppDeps, "db" | "hub">,
  thread: Pick<Thread, "id" | "status" | "stopRequestedAt">,
  environment: {
    hostId: string;
    id: string;
  },
): void {
  if (
    thread.status !== "active" &&
    !hasActiveThreadStartOperation(deps, thread.id)
  ) {
    return;
  }
  requestThreadStop(deps, {
    environmentId: environment.id,
    hostId: environment.hostId,
    interruptionReason: "manual-stop",
    stopRequestedAt: thread.stopRequestedAt,
    threadId: thread.id,
  });
}

export function interruptActiveTurnForThread(
  deps: Pick<AppDeps, "db" | "hub">,
  args: InterruptActiveTurnForThreadArgs,
): boolean {
  const activeTurnId = getActiveTurnId(deps, args.threadId);
  if (!activeTurnId) {
    return false;
  }

  const providerThreadId = getLastProviderThreadId(deps, args.threadId);

  deps.db.transaction(
    (tx) => {
      applyActiveTurnInterruptionInTransaction(tx, {
        activeTurnId,
        environmentId: args.environmentId,
        providerThreadId,
        reason: args.reason,
        threadId: args.threadId,
      });
    },
    { behavior: "immediate" },
  );
  deps.hub.notifyThread(args.threadId, ["events-appended", "status-changed"], {
    eventTypes: ["turn/completed", "system/thread/interrupted"],
  });

  return true;
}

function interruptActiveTurnForThreadInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  args: InterruptActiveTurnForThreadArgs,
): boolean {
  const activeTurnId = getActiveTurnId(deps, args.threadId);
  if (!activeTurnId) {
    return false;
  }

  const providerThreadId = getLastProviderThreadId(deps, args.threadId);

  applyActiveTurnInterruptionInTransaction(deps.db, {
    activeTurnId,
    environmentId: args.environmentId,
    providerThreadId,
    reason: args.reason,
    threadId: args.threadId,
  });
  deps.hub.notifyThread(args.threadId, ["events-appended", "status-changed"], {
    eventTypes: ["turn/completed", "system/thread/interrupted"],
  });

  return true;
}

/**
 * Reconciles threads whose server status is active after the host runtime no
 * longer reports them. Every supplied thread gets a thread interruption event;
 * threads with an open turn also get an interrupted turn completion event.
 */
export function interruptActiveThreads(
  deps: Pick<AppDeps, "db" | "hub" | "pendingInteractions">,
  args: InterruptActiveThreadsArgs,
): InterruptActiveThreadsResult {
  if (args.threads.length === 0) {
    return { threads: [] };
  }

  const results: InterruptedActiveThreadResult[] = [];
  const threadIds = args.threads.map((thread) => thread.threadId);
  const nextStatus = nextStatusForInterruptedThread(args.reason);

  deps.db.transaction(
    (tx) => {
      const stateByThreadId = new Map(
        listThreadTurnInterruptionEventStates(tx, { threadIds }).map(
          (state) => [state.threadId, state],
        ),
      );
      const eventArgs: ThreadEventAppendArgs[] = [];

      for (const thread of args.threads) {
        const state = stateByThreadId.get(thread.threadId);
        const activeTurnId = state?.activeTurnId ?? null;
        const providerThreadId = state?.latestProviderThreadId ?? null;

        if (activeTurnId !== null) {
          eventArgs.push({
            threadId: thread.threadId,
            environmentId: thread.environmentId,
            providerThreadId,
            type: "turn/completed",
            scope: turnScope(activeTurnId),
            data: {
              providerThreadId,
              status: "interrupted",
            },
          });
        }

        eventArgs.push({
          threadId: thread.threadId,
          type: "system/thread/interrupted",
          scope: threadScope(),
          data: {
            reason: args.reason,
          },
        });
        results.push({
          threadId: thread.threadId,
          interruptedTurnId: activeTurnId,
        });
      }

      appendThreadEventsInTransaction(tx, eventArgs);

      for (const thread of args.threads) {
        transitionThreadStatusInTransaction(tx, {
          id: thread.threadId,
          newStatus: nextStatus,
        });
      }
    },
    { behavior: "immediate" },
  );

  deps.pendingInteractions.interruptPendingInteractionsForThreadIds({
    threadIds: results.map((result) => result.threadId),
    reason: pendingInteractionStopReason(args.reason),
  });

  for (const result of results) {
    const eventTypes: ThreadEventType[] = ["system/thread/interrupted"];
    if (result.interruptedTurnId !== null) {
      eventTypes.unshift("turn/completed");
    }
    deps.hub.notifyThread(
      result.threadId,
      ["events-appended", "status-changed"],
      {
        eventTypes,
      },
    );
  }

  return { threads: results };
}

function advanceThreadStop(
  deps: Pick<AppDeps, "db" | "hub">,
  args: AdvanceThreadOperationArgs,
): string | null {
  const operation = getThreadOperation(deps.db, {
    threadId: args.threadId,
    kind: "stop",
  });
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return null;
  }

  if (hasQueuedThreadOperationCommand(deps, operation.commandId)) {
    return operation.commandId;
  }

  const session = getActiveSession(deps.db, args.hostId);
  const { command } = parseThreadStopOperationPayload(operation.payload);
  const queuedCommand = queueCommand(deps.db, deps.hub, {
    hostId: args.hostId,
    sessionId: session?.id ?? null,
    type: command.type,
    payload: JSON.stringify(command),
  });
  markThreadOperationRecordQueued(deps.db, {
    threadId: args.threadId,
    kind: "stop",
    commandId: queuedCommand.id,
  });
  return queuedCommand.id;
}

export function finalizeStoppedThread(
  deps: PendingInteractionWorkSessionDeps,
  args: FinalizeStoppedThreadArgs,
): boolean {
  const notificationBuffer = new NotificationBuffer();
  const finalized = deps.db.transaction(
    (tx) =>
      finalizeStoppedThreadInTransaction(
        {
          ...deps,
          db: tx,
          hub: notificationBuffer,
        },
        args,
      ),
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);
  if (finalized) {
    queueSettledArchivedThreadProviderArchiveCommand(deps, {
      threadId: args.threadId,
    });
  }
  return finalized;
}

export function finalizeStoppedThreadInTransaction(
  deps: FinalizeStoppedThreadTransactionDeps,
  args: FinalizeStoppedThreadArgs,
): boolean {
  const currentThread = getThread(deps.db, args.threadId);
  if (!currentThread) {
    return true;
  }

  const startOperation = getActiveThreadOperation(deps, {
    threadId: args.threadId,
    kind: "start",
  });
  if (startOperation) {
    return false;
  }

  const stopOperation = getActiveThreadOperation(deps, {
    threadId: args.threadId,
    kind: "stop",
  });
  if (
    args.expectedCommandId &&
    stopOperation &&
    stopOperation.commandId !== args.expectedCommandId
  ) {
    return false;
  }
  const stopCommandState = getThreadOperationCommandState(
    deps,
    stopOperation?.commandId ?? null,
  );
  const isSettlingExpectedCommand =
    args.expectedCommandId !== undefined &&
    stopOperation?.commandId === args.expectedCommandId;
  if (stopCommandState === "fetched" && !isSettlingExpectedCommand) {
    return false;
  }
  if (
    stopCommandState === "pending" &&
    stopOperation?.commandId &&
    !isSettlingExpectedCommand
  ) {
    if (args.cancelPendingCommand === false) {
      return false;
    }
    cancelCommandInTransaction(deps.db, {
      commandId: stopOperation.commandId,
    });
  }

  const interruptionReason =
    readThreadStopInterruptionReason(stopOperation) ?? "manual-stop";
  let appendedThreadInterruptedEvent = false;
  if (currentThread.status === "active") {
    appendedThreadInterruptedEvent = interruptActiveTurnForThreadInTransaction(
      deps,
      {
        environmentId: currentThread.environmentId,
        threadId: currentThread.id,
        reason: interruptionReason,
      },
    );
    if (!appendedThreadInterruptedEvent) {
      tryTransitionInTransaction(
        deps.db,
        deps.hub,
        currentThread.id,
        nextStatusForInterruptedThread(interruptionReason),
      );
    }
  }

  completeThreadOperation(deps, {
    threadId: args.threadId,
    kind: "stop",
  });

  if (currentThread.stopRequestedAt !== null) {
    clearThreadStopRequested(deps.db, deps.hub, currentThread.id);
  }

  const finalizedThread = getThread(deps.db, args.threadId);
  if (!finalizedThread) {
    return true;
  }

  if (finalizedThread.deletedAt === null) {
    deps.pendingInteractions.interruptPendingInteractionsForThreadIdsInTransaction(
      deps,
      {
        threadIds: [finalizedThread.id],
        reason: pendingInteractionStopReason(interruptionReason),
      },
    );
    if (!appendedThreadInterruptedEvent) {
      appendThreadInterruptedEventInTransaction(deps.db, {
        threadId: finalizedThread.id,
        reason: interruptionReason,
      });
      deps.hub.notifyThread(finalizedThread.id, ["events-appended"], {
        eventTypes: ["system/thread/interrupted"],
      });
    }
  }

  if (finalizedThread.deletedAt !== null) {
    deps.pendingInteractions.interruptPendingInteractionsForThreadIdsInTransaction(
      deps,
      {
        threadIds: [finalizedThread.id],
        reason: "Thread was deleted while awaiting user interaction",
      },
    );

    const environmentId = finalizedThread.environmentId;
    const environment = environmentId
      ? getEnvironment(deps.db, environmentId)
      : null;
    if (environment) {
      const queuedDelete = queueThreadDeletedCommandInTransaction(deps.db, {
        environment: { hostId: environment.hostId, id: environment.id },
        threadId: finalizedThread.id,
      });
      if (!queuedDelete) {
        return false;
      }
      deps.hub.notifyCommand(environment.hostId);
    }
    deleteThread(deps.db, deps.hub, finalizedThread.id);
    requestEnvironmentCleanup(deps, {
      environmentId,
    });
    return true;
  }

  return true;
}

export async function finalizeStoppedThreadAndAdvanceCleanup(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: FinalizeStoppedThreadArgs,
): Promise<boolean> {
  const threadBeforeFinalize = getThread(deps.db, args.threadId);
  const finalized = finalizeStoppedThread(deps, args);
  if (!finalized) {
    return false;
  }

  const threadAfterFinalize = getThread(deps.db, args.threadId);
  const environmentId =
    threadAfterFinalize?.environmentId ??
    threadBeforeFinalize?.environmentId ??
    null;
  if (environmentId) {
    await advanceEnvironmentCleanup(deps, { environmentId });
  }
  return true;
}

export function finalizeStoppedThreadAndRequestCleanupAdvance(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: FinalizeStoppedThreadArgs,
): boolean {
  const threadBeforeFinalize = getThread(deps.db, args.threadId);
  const finalized = finalizeStoppedThread(deps, args);
  if (!finalized) {
    return false;
  }

  const threadAfterFinalize = getThread(deps.db, args.threadId);
  const environmentId =
    threadAfterFinalize?.environmentId ??
    threadBeforeFinalize?.environmentId ??
    null;
  requestEnvironmentCleanupAdvance(deps, { environmentId });
  return true;
}

export function requestThreadStopAndFinalize(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: RequestThreadStopAndFinalizeArgs,
): boolean {
  if (args.environment) {
    requestThreadStopIfNeeded(deps, args.thread, args.environment);
  }
  return finalizeStoppedThread(deps, {
    cancelPendingCommand: args.cancelPendingCommand,
    threadId: args.thread.id,
  });
}

export async function reconcileDaemonReportedThreads(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: ReconcileDaemonReportedThreadsArgs,
): Promise<void> {
  const activeThreadIdSet = new Set(args.activeThreadIds);

  const pendingThreads = deps.db
    .select({
      deletedAt: threads.deletedAt,
      environmentId: environments.id,
      id: threads.id,
      status: threads.status,
      stopRequestedAt: threads.stopRequestedAt,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        inArray(threads.status, [
          "active",
          "created",
          "idle",
          "error",
          "provisioning",
        ]),
        or(isNotNull(threads.deletedAt), isNotNull(threads.stopRequestedAt)),
      ),
    )
    .all();

  for (const thread of pendingThreads) {
    if (activeThreadIdSet.has(thread.id)) {
      requestThreadStop(deps, {
        environmentId: thread.environmentId,
        hostId: args.hostId,
        interruptionReason: "manual-stop",
        stopRequestedAt: thread.stopRequestedAt,
        threadId: thread.id,
      });
      continue;
    }

    finalizeStoppedThreadAndRequestCleanupAdvance(deps, {
      threadId: thread.id,
    });
  }

  if (args.activeThreadIds.length > 0) {
    const erroredThreads = deps.db
      .select({ id: threads.id })
      .from(threads)
      .innerJoin(environments, eq(threads.environmentId, environments.id))
      .where(
        and(
          eq(environments.hostId, args.hostId),
          eq(threads.status, "error"),
          isNull(threads.deletedAt),
          isNull(threads.stopRequestedAt),
          inArray(threads.id, [...args.activeThreadIds]),
        ),
      )
      .all();

    for (const thread of erroredThreads) {
      tryTransition(deps.db, deps.hub, thread.id, "active");
    }
  }

  const activeButMissing = deps.db
    .select({ environmentId: environments.id, id: threads.id })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        eq(threads.status, "active"),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
        args.activeThreadIds.length > 0
          ? notInArray(threads.id, [...args.activeThreadIds])
          : undefined,
      ),
    )
    .all();

  interruptActiveThreads(deps, {
    threads: activeButMissing.map((thread) => ({
      environmentId: thread.environmentId,
      threadId: thread.id,
    })),
    reason: "host-daemon-restarted",
  });

  if (args.activeThreadIds.length === 0) {
    return;
  }

  const inactiveButActive = deps.db
    .select({ id: threads.id })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        inArray(threads.status, ["created", "provisioning", "idle"]),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
        inArray(threads.id, [...args.activeThreadIds]),
      ),
    )
    .all();

  const blockedRevivalThreadIds = new Set(
    listThreadIdsWithLatestHostDaemonRestartInterruption(deps.db, {
      threadIds: inactiveButActive.map((thread) => thread.id),
    }),
  );

  for (const thread of inactiveButActive) {
    if (blockedRevivalThreadIds.has(thread.id)) {
      continue;
    }
    tryTransition(deps.db, deps.hub, thread.id, "active");
    completeThreadStart(deps, {
      threadId: thread.id,
    });
  }
}
