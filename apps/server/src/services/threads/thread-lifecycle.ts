import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
} from "drizzle-orm";
import {
  clearThreadStopRequested,
  deleteThread,
  environments,
  events,
  getEnvironment,
  getLatestThreadInterruptedReason,
  getThread,
  listThreadIdsWithLatestHostDaemonRestartInterruption,
  listThreadTurnInterruptionEventStates,
  markThreadStopRequested,
  threads,
  transitionThreadStatusInTransaction,
  type DbNotifier,
  type DbQueryConnection,
  type DbTransaction,
} from "@bb/db";
import { assertNever } from "@bb/core-ui";
import {
  type ProvisioningTranscriptEntry,
  type SystemThreadInterruptedReason,
  type Thread,
  type ThreadEventScope,
  type ThreadEventType,
  type ThreadStatus,
  threadScope,
  turnScope,
} from "@bb/domain";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
  LoggedWorkSessionDeps,
} from "../../types.js";
import {
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
  runEnvironmentCleanupAdvance,
} from "../environments/environment-cleanup-internal.js";
import { cancelEnvironmentProvisioningForThreadStopInTransaction } from "../environments/environment-provisioning-cancellation.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultFailureReportForType,
  type CommandResultPostCommitAction,
  type CommandResultSideEffectsDeps,
  type CommandResultReportForType,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandExecutionRecord,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";
import {
  appendSystemErrorEventInTransaction,
  buildSystemErrorEventData,
  appendThreadEventInTransaction,
  appendThreadEventsInTransaction,
  appendThreadInterruptedEventInTransaction,
  appendThreadProvisioningEventInTransaction,
  getActiveTurnId,
  getLastProviderThreadId,
} from "./thread-events.js";
import {
  tryTransition,
  tryTransitionInTransaction,
} from "./thread-transitions.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildThreadStartCommand,
  buildThreadStopCommand,
  prepareTurnSubmitCommandPayload,
  dispatchArchivedThreadProviderArchiveCommand,
  dispatchThreadRenameCommand,
  type ThreadStartCommandArgs,
  type ThreadStopCommandArgs,
} from "./thread-commands.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import { createAsyncDeduper } from "../lib/async-deduper.js";
import { throwThreadNotWritable } from "../lib/lifecycle-api-errors.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import { queueChildThreadTurnNotificationBestEffort } from "./child-thread-notifications.js";
import {
  forgetActiveThreadProvisionContext,
  getActiveThreadProvisionContext,
} from "./thread-provisioning-active-context.js";
import { isPreStartThreadStatus } from "./thread-status.js";

type ReadyThreadTurnDispatchKind = "thread.start" | "turn.submit";
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

export interface PreparedThreadStartCommand {
  command: ThreadStartCommand;
  mode: "thread.start";
  sessionId: string;
}

export interface PreparedReadyTurnSubmitCommand {
  command: TurnSubmitCommand;
  mode: "turn.submit";
  sessionId: string;
}

export type PreparedReadyThreadTurnCommand =
  | PreparedThreadStartCommand
  | PreparedReadyTurnSubmitCommand;

export interface PrepareReadyThreadTurnDispatchInTransactionArgs {
  command: PreparedReadyThreadTurnCommand;
  thread: Thread;
}

const threadStartRequestDeduper = createAsyncDeduper<string, void>();
const activeThreadStartRpcThreadIds = new Set<string>();
const activeThreadStartGeneratedTitleSyncThreadIds = new Set<string>();
const activeThreadStopRpcThreadIds = new Set<string>();

export function hasLiveThreadStartInFlight(threadId: string): boolean {
  return activeThreadStartRpcThreadIds.has(threadId);
}

export function hasLiveThreadStopInFlight(threadId: string): boolean {
  return activeThreadStopRpcThreadIds.has(threadId);
}

interface CompleteThreadStartArgs {
  threadId: string;
}

interface ThreadStartSuccessActivationArgs {
  commandStartedAt: number;
  providerThreadId: string;
  thread: Thread;
}

interface HasThreadInterruptedEventAtOrAfterArgs {
  createdAt: number;
  threadId: string;
}

interface HasProviderTurnCompletedEventAtOrAfterArgs {
  createdAt: number;
  providerThreadId: string;
  threadId: string;
}

export interface RequestThreadStopArgs extends ThreadStopCommandArgs {
  interruptionReason: SystemThreadInterruptedReason;
  stopRequestedAt: number | null;
}

interface RequestThreadStopForCurrentStateEnvironment {
  hostId: string;
  id: string;
}

type RequestThreadStopForCurrentStateDeps =
  LoggedPendingInteractionWorkSessionDeps;

interface RequestThreadStopForCurrentStateThread {
  environmentId: string | null;
  id: string;
  status: ThreadStatus;
  stopRequestedAt: number | null;
}

interface RequestPreStartThreadStopResult {
  cancelHostId: string | null;
  environmentId: string | null;
  finalized: boolean;
}

interface ProvisioningInterruptedThread {
  environmentId: string | null;
  id: string;
}

interface FinalizeStoppedThreadArgs {
  threadId: string;
}

interface InterruptActiveTurnForThreadArgs {
  environmentId: string | null;
  reason: SystemThreadInterruptedReason;
  threadId: string;
}

interface InterruptActiveThreadArgs {
  environmentId: string | null;
  threadId: string;
}

interface InterruptActiveThreadsArgs {
  reason: SystemThreadInterruptedReason;
  threads: readonly InterruptActiveThreadArgs[];
}

interface InterruptActiveThreadsForHostArgs {
  hostId: string;
  reason: SystemThreadInterruptedReason;
}

interface InterruptedActiveThreadResult {
  failureEventAppended: boolean;
  interruptedTurnId: string | null;
  threadId: string;
}

interface InterruptActiveThreadsResult {
  threads: InterruptedActiveThreadResult[];
}

interface ReconcileDaemonReportedThreadsArgs {
  activeThreadIds: readonly string[];
  hostId: string;
}

interface DispatchSettledArchivedThreadProviderArchiveCommandArgs {
  threadId: string;
}

interface ThreadCommandResultSettlementDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

interface SettleThreadCommandFailureArgs {
  command: ThreadFailureCommand;
  deps: ThreadCommandResultSettlementDeps;
  report: ThreadFailureResultReport;
}

interface SettleThreadStartCommandResultArgs {
  command: ThreadStartCommand;
  deps: FinalizeStoppedThreadTransactionDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: ThreadStartCommandResultReport;
}

interface SettleTurnSubmitCommandResultArgs {
  command: TurnSubmitCommand;
  deps: ThreadCommandResultSettlementDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: TurnSubmitCommandResultReport;
}

interface SettleThreadStopCommandResultArgs {
  command: ThreadStopCommand;
  deps: FinalizeStoppedThreadTransactionDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: ThreadStopCommandResultReport;
}

function nextStatusForInterruptedThread(
  reason: SystemThreadInterruptedReason,
): Extract<ThreadStatus, "idle" | "error"> {
  switch (reason) {
    case "manual-stop":
      return "idle";
    case "host-daemon-restarted":
      return "error";
    // Legacy persisted watchdog interruption; no current producer.
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
    // Legacy persisted watchdog interruption; no current producer.
    case "provider-turn-idle":
      return "Thread stopped after the provider stopped sending progress";
    default:
      return assertNever(reason);
  }
}

function threadCommandFailureMessageForInterruption(
  reason: SystemThreadInterruptedReason,
): string | null {
  switch (reason) {
    case "manual-stop":
      return null;
    case "host-daemon-restarted":
      return "Thread interrupted because the host daemon disconnected";
    // Legacy persisted watchdog interruption; no current producer.
    case "provider-turn-idle":
      return "Live runtime work failed because the provider stopped sending progress";
    default:
      return assertNever(reason);
  }
}

function threadCommandFailureDetailForInterruption(
  reason: SystemThreadInterruptedReason,
): string {
  switch (reason) {
    case "manual-stop":
      return "Thread stopped by user request";
    case "host-daemon-restarted":
      return "Please retry the thread to continue.";
    // Legacy persisted watchdog interruption; no current producer.
    case "provider-turn-idle":
      return "Provider stopped sending progress while the thread was running";
    default:
      return assertNever(reason);
  }
}

interface DispatchThreadStartFromRequestArgs {
  command: ThreadStartCommand;
  hostId: string;
  sessionId: string;
  sourceThreadStatus: ThreadStatus;
  threadId: string;
}

type ThreadStartDispatchDisposition = "blocked" | "started" | "existing-start";

interface DispatchThreadStartFromRequestResult {
  completedProvisionSequence: number | null;
  disposition: ThreadStartDispatchDisposition;
}

interface ThreadLifecycleReadDeps {
  db: DbQueryConnection;
}

interface ThreadLifecycleWriteDeps extends ThreadLifecycleReadDeps {
  hub: DbNotifier;
}

type ThreadLifecycleCommandDispatchDeps = CommandResultSideEffectsDeps;

interface ThreadLifecycleTransactionDeps extends ThreadLifecycleWriteDeps {
  db: DbTransaction;
}

interface FinalizeStoppedThreadTransactionDeps extends ThreadLifecycleTransactionDeps {
  pendingInteractions: AppDeps["pendingInteractions"];
}

interface ApplyActiveTurnInterruptionArgs {
  activeTurnId: string;
  environmentId: string | null;
  providerThreadId: string | null;
  reason: SystemThreadInterruptedReason;
  threadId: string;
}

interface MarkThreadStopRequestedWithEventArgs {
  reason: SystemThreadInterruptedReason;
  requestedAt?: number;
  threadId: string;
}

function hasActiveThreadProvisioningContext(threadId: string): boolean {
  return getActiveThreadProvisionContext(threadId) !== null;
}

function hasThreadInterruptedEvent(
  deps: ThreadLifecycleReadDeps,
  threadId: string,
): boolean {
  const row = deps.db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.threadId, threadId),
        eq(events.type, "system/thread/interrupted"),
      ),
    )
    .limit(1)
    .get();
  return row !== undefined;
}

function buildProvisioningStoppedEntry(): ProvisioningTranscriptEntry {
  return {
    type: "step",
    key: "provisioning-stopped",
    text: "Provisioning stopped by user request",
    status: "completed",
    startedAt: Date.now(),
  };
}

function appendProvisioningInterruptedEventInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  thread: ProvisioningInterruptedThread,
): void {
  const currentThread = getThread(deps.db, thread.id);
  const context = getActiveThreadProvisionContext(thread.id);
  if (!currentThread || !context) {
    return;
  }
  const environmentId = context.state.environmentId ?? thread.environmentId;
  if (environmentId === null) {
    return;
  }

  appendThreadProvisioningEventInTransaction(deps.db, {
    threadId: thread.id,
    environmentId,
    provisioningId: context.state.provisioningId,
    status: "cancelled",
    entries: [buildProvisioningStoppedEntry()],
  });
  deps.hub.notifyThread(thread.id, ["events-appended"], {
    eventTypes: ["system/thread-provisioning"],
  });
}

function appendThreadInterruptedEventIfMissingInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  args: MarkThreadStopRequestedWithEventArgs,
): boolean {
  if (hasThreadInterruptedEvent(deps, args.threadId)) {
    return false;
  }
  appendThreadInterruptedEventInTransaction(deps.db, {
    threadId: args.threadId,
    reason: args.reason,
  });
  deps.hub.notifyThread(args.threadId, ["events-appended"], {
    eventTypes: ["system/thread/interrupted"],
  });
  return true;
}

function markThreadStopRequestedWithEventInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  args: MarkThreadStopRequestedWithEventArgs,
): boolean {
  const currentThread = getThread(deps.db, args.threadId);
  if (!currentThread || currentThread.stopRequestedAt !== null) {
    return false;
  }
  markThreadStopRequested(deps.db, deps.hub, {
    requestedAt: args.requestedAt,
    threadId: args.threadId,
  });
  appendThreadInterruptedEventInTransaction(deps.db, {
    threadId: args.threadId,
    reason: args.reason,
  });
  deps.hub.notifyThread(args.threadId, ["events-appended"], {
    eventTypes: ["system/thread/interrupted"],
  });
  return true;
}

function applyActiveTurnInterruptionInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  args: ApplyActiveTurnInterruptionArgs,
): boolean {
  appendThreadEventInTransaction(deps.db, {
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
  const appendedThreadInterruptedEvent =
    appendThreadInterruptedEventIfMissingInTransaction(deps, args);
  transitionThreadStatusInTransaction(deps.db, {
    id: args.threadId,
    newStatus: nextStatusForInterruptedThread(args.reason),
  });
  return appendedThreadInterruptedEvent;
}

export function dispatchSettledArchivedThreadProviderArchiveCommand(
  deps: ThreadLifecycleCommandDispatchDeps,
  args: DispatchSettledArchivedThreadProviderArchiveCommandArgs,
): boolean {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.status === "active") {
    return false;
  }
  if (
    hasLiveThreadStartInFlight(thread.id) ||
    thread.stopRequestedAt !== null
  ) {
    return false;
  }

  return dispatchArchivedThreadProviderArchiveCommand(deps, {
    threadId: thread.id,
  });
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

function hasThreadInterruptedEventAtOrAfter(
  deps: ThreadLifecycleReadDeps,
  args: HasThreadInterruptedEventAtOrAfterArgs,
): boolean {
  return (
    deps.db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.type, "system/thread/interrupted"),
          gte(events.createdAt, args.createdAt),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function hasProviderTurnCompletedEventAtOrAfter(
  deps: ThreadLifecycleReadDeps,
  args: HasProviderTurnCompletedEventAtOrAfterArgs,
): boolean {
  return (
    deps.db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.threadId, args.threadId),
          eq(events.providerThreadId, args.providerThreadId),
          eq(events.type, "turn/completed"),
          gte(events.createdAt, args.createdAt),
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}

function canActivateThreadAfterSuccessfulStart(
  deps: ThreadLifecycleReadDeps,
  args: ThreadStartSuccessActivationArgs,
): boolean {
  if (
    args.thread.deletedAt !== null ||
    args.thread.archivedAt !== null ||
    args.thread.stopRequestedAt !== null
  ) {
    return false;
  }
  if (
    !isPreStartThreadStatus(args.thread.status) &&
    args.thread.status !== "idle" &&
    args.thread.status !== "error"
  ) {
    return false;
  }

  return (
    !hasThreadInterruptedEventAtOrAfter(deps, {
      createdAt: args.commandStartedAt,
      threadId: args.thread.id,
    }) &&
    !hasProviderTurnCompletedEventAtOrAfter(deps, {
      createdAt: args.commandStartedAt,
      providerThreadId: args.providerThreadId,
      threadId: args.thread.id,
    })
  );
}

function settleThreadCommandFailure(
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
    const parentThreadId = thread.parentThreadId;
    postCommitActions.push({
      name: "Child thread command failure notification",
      context: {
        threadId: thread.id,
      },
      run: (deps) =>
        queueChildThreadTurnNotificationBestEffort(deps, {
          childThread: thread,
          parentThreadId,
          turnStatus: "failed",
        }),
    });
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
    forgetActiveThreadProvisionContext(thread.id);
    return settleThreadCommandFailure({
      command: args.command,
      deps: args.deps,
      report: args.report,
    });
  }

  const shouldSyncTitle =
    thread.title !== null &&
    activeThreadStartGeneratedTitleSyncThreadIds.has(thread.id);
  completeThreadStart(args.deps, { threadId: thread.id });
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
  if (
    currentThread &&
    canActivateThreadAfterSuccessfulStart(args.deps, {
      commandStartedAt: args.execution.createdAt,
      providerThreadId: args.report.result.providerThreadId,
      thread: currentThread,
    })
  ) {
    tryTransitionInTransaction(
      args.deps.db,
      args.deps.hub,
      currentThread.id,
      "active",
    );
  }
  const threadTitle = thread.title;
  if (threadTitle && shouldSyncTitle) {
    postCommitActions.push({
      name: "Generated thread title provider rename",
      context: {
        environmentId: args.command.environmentId,
        hostId: args.execution.hostId,
        threadId: thread.id,
      },
      run: (deps) =>
        dispatchThreadRenameCommand(deps, {
          environment: {
            id: args.command.environmentId,
            hostId: args.execution.hostId,
          },
          providerId: thread.providerId,
          threadId: thread.id,
          title: threadTitle,
        }),
    });
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

export function ensureThreadCanStartRequest(thread: Thread): void {
  if (isPreStartThreadStatus(thread.status)) {
    throwThreadNotWritable(
      thread,
      "still_starting",
      "Thread is still starting",
    );
  }
}

export async function prepareReadyThreadTurnCommand(
  deps: LoggedWorkSessionDeps,
  args: ThreadStartCommandArgs,
): Promise<PreparedReadyThreadTurnCommand> {
  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.environment.hostId,
  });
  const providerThreadId = getLastProviderThreadId(deps, args.thread.id);
  if (providerThreadId) {
    const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
      environment: args.environment,
      execution: args.execution,
      input: args.input,
      permissionEscalation: args.permissionEscalation,
      providerThreadId,
      target: { mode: "start" },
      thread: args.thread,
    });
    return {
      command: addRequestIdToTurnSubmitCommandPayload({
        preparedCommand,
        requestId: args.requestId,
      }),
      mode: "turn.submit",
      sessionId: session.id,
    };
  }

  return {
    command: await buildThreadStartCommand(deps, args),
    mode: "thread.start",
    sessionId: session.id,
  };
}

export function prepareReadyThreadTurnDispatchInTransaction(
  _tx: DbTransaction,
  args: PrepareReadyThreadTurnDispatchInTransactionArgs,
): ReadyThreadTurnDispatchKind {
  if (args.command.mode === "turn.submit") {
    return "turn.submit";
  }

  ensureThreadCanStartRequest(args.thread);
  return "thread.start";
}

export function completeThreadStart(
  deps: ThreadLifecycleReadDeps,
  args: CompleteThreadStartArgs,
): boolean {
  const thread = getThread(deps.db, args.threadId);
  const hadContext = hasActiveThreadProvisioningContext(args.threadId);
  forgetActiveThreadProvisionContext(args.threadId);
  return hadContext || thread?.status === "active";
}

export function settleThreadStopCommandResult(
  args: SettleThreadStopCommandResultArgs,
): CommandResultSideEffectsResult {
  if (!args.report.ok) {
    return emptyCommandResultSideEffects();
  }

  finalizeStoppedThreadInTransaction(args.deps, {
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
          dispatchSettledArchivedThreadProviderArchiveCommand(deps, {
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

function dispatchThreadStartFromRequest(
  deps: Pick<AppDeps, "db" | "hub">,
  args: DispatchThreadStartFromRequestArgs,
): DispatchThreadStartFromRequestResult {
  const result: DispatchThreadStartFromRequestResult = deps.db.transaction(
    (tx) => {
      const currentThread = getThread(tx, args.threadId);
      const isProvisionHandoff = args.sourceThreadStatus === "provisioning";
      const activeProvisionContext = isProvisionHandoff
        ? getActiveThreadProvisionContext(args.threadId)
        : null;
      if (
        !currentThread ||
        currentThread.deletedAt !== null ||
        currentThread.archivedAt !== null ||
        currentThread.stopRequestedAt !== null
      ) {
        return {
          completedProvisionSequence: null,
          disposition: "blocked",
        };
      }

      if (
        isProvisionHandoff &&
        (!isPreStartThreadStatus(currentThread.status) ||
          activeProvisionContext === null)
      ) {
        return {
          completedProvisionSequence: null,
          disposition: "blocked",
        };
      }

      let completedProvisionSequence: number | null = null;
      if (activeProvisionContext !== null) {
        completedProvisionSequence = appendThreadProvisioningEventInTransaction(
          tx,
          {
            threadId: args.threadId,
            environmentId: args.command.environmentId,
            provisioningId: activeProvisionContext.state.provisioningId,
            status: "completed",
            entries: [],
          },
        );
      }

      return {
        completedProvisionSequence,
        disposition: "started",
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
  deps: CommandResultSideEffectsDeps,
  args: ThreadStartCommandArgs,
): Promise<void> {
  await threadStartRequestDeduper.run(args.thread.id, () =>
    requestThreadStartOnce(deps, args),
  );
}

async function requestThreadStartOnce(
  deps: CommandResultSideEffectsDeps,
  args: ThreadStartCommandArgs,
): Promise<void> {
  if (hasLiveThreadStartInFlight(args.thread.id)) {
    return;
  }

  const command = await buildThreadStartCommand(deps, {
    ...args,
  });
  if (hasLiveThreadStartInFlight(args.thread.id)) {
    return;
  }

  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.environment.hostId,
  });
  const result = dispatchThreadStartFromRequest(deps, {
    command,
    hostId: args.environment.hostId,
    sessionId: session.id,
    sourceThreadStatus: args.thread.status,
    threadId: args.thread.id,
  });
  if (result.disposition === "started") {
    activeThreadStartRpcThreadIds.add(args.thread.id);
    if (args.syncGeneratedTitle) {
      activeThreadStartGeneratedTitleSyncThreadIds.add(args.thread.id);
    }
    void runLiveHostCommand(deps, {
      command,
      hostId: args.environment.hostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    })
      .catch((error) => {
        deps.logger.warn(
          { err: error, threadId: args.thread.id },
          "Live thread start command failed",
        );
      })
      .finally(() => {
        activeThreadStartRpcThreadIds.delete(args.thread.id);
        activeThreadStartGeneratedTitleSyncThreadIds.delete(args.thread.id);
      });
  }
}

export function requestThreadStop(
  deps: CommandResultSideEffectsDeps,
  args: RequestThreadStopArgs,
): void {
  if (args.stopRequestedAt === null) {
    const notificationBuffer = new NotificationBuffer();
    deps.db.transaction(
      (tx) => {
        markThreadStopRequestedWithEventInTransaction(
          {
            ...deps,
            db: tx,
            hub: notificationBuffer,
          },
          {
            reason: args.interruptionReason,
            threadId: args.threadId,
          },
        );
      },
      { behavior: "immediate" },
    );
    notificationBuffer.flushInto(deps.hub);
  }

  const currentThread = getThread(deps.db, args.threadId);
  if (
    !currentThread ||
    currentThread.stopRequestedAt === null ||
    hasLiveThreadStopInFlight(args.threadId)
  ) {
    return;
  }

  activeThreadStopRpcThreadIds.add(args.threadId);
  void runLiveHostCommand(deps, {
    command: buildThreadStopCommand(args),
    hostId: args.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  })
    .catch((error) => {
      deps.logger.warn(
        { err: error, threadId: args.threadId },
        "Live thread stop command failed",
      );
    })
    .finally(() => {
      activeThreadStopRpcThreadIds.delete(args.threadId);
    });
}

function requestPreStartThreadStop(
  deps: RequestThreadStopForCurrentStateDeps,
  thread: RequestThreadStopForCurrentStateThread,
): void {
  const notificationBuffer = new NotificationBuffer();
  const result: RequestPreStartThreadStopResult = deps.db.transaction(
    (tx) => {
      const txDeps = {
        ...deps,
        db: tx,
        hub: notificationBuffer,
      };
      const currentThread = getThread(tx, thread.id);
      if (!currentThread) {
        return { cancelHostId: null, environmentId: null, finalized: true };
      }

      const hasProvisioningContext =
        currentThread.status === "provisioning" &&
        hasActiveThreadProvisioningContext(currentThread.id);
      if (
        !isPreStartThreadStatus(currentThread.status) &&
        !hasProvisioningContext
      ) {
        return {
          cancelHostId: null,
          environmentId: currentThread.environmentId,
          finalized: false,
        };
      }

      if (currentThread.stopRequestedAt === null) {
        markThreadStopRequestedWithEventInTransaction(txDeps, {
          reason: "manual-stop",
          threadId: currentThread.id,
        });
      }
      if (hasProvisioningContext) {
        appendProvisioningInterruptedEventInTransaction(txDeps, currentThread);
      }
      forgetActiveThreadProvisionContext(currentThread.id);

      const environmentId = currentThread.environmentId;
      const environment =
        environmentId === null ? null : getEnvironment(tx, environmentId);
      const cancellation =
        environment === null
          ? "ready_to_finalize"
          : cancelEnvironmentProvisioningForThreadStopInTransaction(txDeps, {
              environmentId: environment.id,
              threadId: currentThread.id,
            });
      if (cancellation === "awaiting_host_cancel" && environment !== null) {
        return {
          cancelHostId: environment.hostId,
          environmentId: environment.id,
          finalized: false,
        };
      }

      const finalized = finalizeStoppedThreadInTransaction(txDeps, {
        threadId: currentThread.id,
      });
      return { cancelHostId: null, environmentId, finalized };
    },
    { behavior: "immediate" },
  );
  notificationBuffer.flushInto(deps.hub);

  if (!result.finalized && result.environmentId && result.cancelHostId) {
    requestEnvironmentCleanup(deps, { environmentId: result.environmentId });
    startLiveHostCommand(deps, {
      command: {
        type: "environment.provision.cancel",
        environmentId: result.environmentId,
      },
      hostId: result.cancelHostId,
      timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
      onError: ({ error }) => {
        deps.logger.warn(
          {
            err: error,
            environmentId: result.environmentId,
            threadId: thread.id,
          },
          "Live environment provision cancel command failed",
        );
      },
    });
    return;
  }

  if (result.finalized && result.environmentId !== null) {
    requestEnvironmentCleanup(deps, { environmentId: result.environmentId });
    requestEnvironmentCleanupAdvance(deps, {
      environmentId: result.environmentId,
    });
  }
}

export function requestThreadStopForCurrentState(
  deps: RequestThreadStopForCurrentStateDeps,
  thread: RequestThreadStopForCurrentStateThread,
  environment: RequestThreadStopForCurrentStateEnvironment | null,
): void {
  if (thread.status === "active" || hasLiveThreadStartInFlight(thread.id)) {
    if (environment === null) {
      return;
    }
    requestThreadStop(deps, {
      environmentId: environment.id,
      hostId: environment.hostId,
      interruptionReason: "manual-stop",
      stopRequestedAt: thread.stopRequestedAt,
      threadId: thread.id,
    });
    return;
  }

  if (
    isPreStartThreadStatus(thread.status) ||
    hasActiveThreadProvisioningContext(thread.id)
  ) {
    requestPreStartThreadStop(deps, thread);
  }
}

/**
 * Requests a daemon stop only for active runtime work. Pre-start provisioning
 * cancellation goes through requestThreadStopForCurrentState.
 */
export function requestActiveRuntimeThreadStopIfNeeded(
  deps: CommandResultSideEffectsDeps,
  thread: Pick<Thread, "id" | "status" | "stopRequestedAt">,
  environment: {
    hostId: string;
    id: string;
  },
): void {
  if (thread.status !== "active" && !hasLiveThreadStartInFlight(thread.id)) {
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

function interruptActiveTurnForThreadInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  args: InterruptActiveTurnForThreadArgs,
): boolean {
  const activeTurnId = getActiveTurnId(deps, args.threadId);
  if (!activeTurnId) {
    return false;
  }

  const providerThreadId = getLastProviderThreadId(deps, args.threadId);

  const appendedThreadInterruptedEvent =
    applyActiveTurnInterruptionInTransaction(deps, {
      activeTurnId,
      environmentId: args.environmentId,
      providerThreadId,
      reason: args.reason,
      threadId: args.threadId,
    });
  const eventTypes: ThreadEventType[] = ["turn/completed"];
  if (appendedThreadInterruptedEvent) {
    eventTypes.push("system/thread/interrupted");
  }
  deps.hub.notifyThread(args.threadId, ["events-appended", "status-changed"], {
    eventTypes,
  });

  return appendedThreadInterruptedEvent;
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
        const failureMessage = threadCommandFailureMessageForInterruption(
          args.reason,
        );

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

        if (failureMessage !== null) {
          eventArgs.push({
            threadId: thread.threadId,
            environmentId: thread.environmentId,
            providerThreadId,
            type: "system/error",
            scope:
              activeTurnId !== null ? turnScope(activeTurnId) : threadScope(),
            data: buildSystemErrorEventData({
              code: "thread_command_failed",
              message: failureMessage,
              detail: threadCommandFailureDetailForInterruption(args.reason),
            }),
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
          failureEventAppended: failureMessage !== null,
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
    if (result.failureEventAppended) {
      eventTypes.unshift("system/error");
    }
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

export function interruptActiveThreadsForHost(
  deps: Pick<AppDeps, "db" | "hub" | "pendingInteractions">,
  args: InterruptActiveThreadsForHostArgs,
): InterruptActiveThreadsResult {
  const activeThreads = deps.db
    .select({
      environmentId: environments.id,
      threadId: threads.id,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        eq(threads.status, "active"),
        isNull(threads.deletedAt),
        isNull(threads.stopRequestedAt),
      ),
    )
    .all();

  return interruptActiveThreads(deps, {
    threads: activeThreads,
    reason: args.reason,
  });
}

export function finalizeStoppedThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
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
    dispatchSettledArchivedThreadProviderArchiveCommand(deps, {
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

  const interruptionReason =
    getLatestThreadInterruptedReason(deps.db, {
      threadId: currentThread.id,
    }) ?? "manual-stop";
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
  } else if (isPreStartThreadStatus(currentThread.status)) {
    tryTransitionInTransaction(
      deps.db,
      deps.hub,
      currentThread.id,
      nextStatusForInterruptedThread(interruptionReason),
    );
  }

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
    if (
      !appendedThreadInterruptedEvent &&
      !hasThreadInterruptedEvent(deps, finalizedThread.id)
    ) {
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
    await runEnvironmentCleanupAdvance(deps, { environmentId });
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
