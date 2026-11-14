import {
  advanceEnvironmentProvisioning,
  providerEnvironmentHasPendingWork,
  refreshProviderRetirement,
} from "../environments/environment-engine.js";
import { revokeThreadDesktopBrowserControl } from "../desktop-browsers.js";
import { and, eq, inArray, isNotNull, isNull, notExists, sql } from "drizzle-orm";
import {
  environments,
  getActiveStoredTurnId,
  getEnvironment,
  getHost,
  getLatestSessionForHost,
  getLatestThreadSequence,
  getThread,
  hasStoredProviderTurnCompletedSince,
  hasStoredThreadInterruptedSince,
  hasStoredTurnCompleted,
  hasThreadStartTurnRequest,
  isThreadAwaitingTurnStartPastDeadline,
  listThreadIdsAwaitingTurnRequestAnswers,
  listThreadIdsWithLatestHostDaemonRestartInterruption,
  listThreadIdsWithOwedStopForHost,
  listThreadIdsWithTurnRequestsForHost,
  listTurnStartDeadlineCandidates,
  markThreadStorageDeleted,
  requestThreadPurge,
  threadPurges,
  threads,
  type TurnStartDeadlineCandidate,
} from "@bb/db";
import {
  STALE_TURN_ERROR_CODE,
  STEER_UNCONFIRMED_ERROR_CODE,
  TURN_START_UNCONFIRMED_ERROR_CODE,
} from "@bb/host-daemon-contract";
import type {
  ProvisioningTranscriptEntry,
  Thread,
  ThreadStatus,
} from "@bb/domain";
import type {
  LoggedPendingInteractionWorkSessionDeps,
  LoggedWorkSessionDeps,
} from "../../types.js";
import { cancelEnvironmentProvisioningForThreadStopInTransaction } from "../environments/environment-provisioning-cancellation.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultPostCommitAction,
  type CommandResultReportForType,
  type CommandResultSettlementDeps,
  type CommandResultSideEffectsDeps,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandExecutionRecord,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";
import {
  appendThreadProvisioningEventInTransaction,
  requireDispatchableProviderThreadId,
} from "./thread-events.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildThreadStartCommand,
  buildThreadStopCommand,
  buildThreadStorageDeleteCommand,
  prepareTurnSubmitCommandPayload,
  type ThreadStartCommandArgs,
} from "./thread-commands.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { ApiError } from "../../errors.js";
import { isHostUnavailableApiError } from "../hosts/online-rpc.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import { requestQueuedMessageDispatch } from "./queued-message-dispatch.js";
import { defineItemSweep, type ItemSweep } from "../system/item-sweep.js";
import { throwThreadNotWritable } from "../lib/lifecycle-api-errors.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  clearThreadProvisionSchedule,
  getThreadProvisionContext,
  readDispatchedThreadStartFork,
} from "./thread-startup-store.js";
import { cancelAbandonedProviderCreations } from "./thread-environment-providers.js";
import { scheduleThreadProvisioningAdvance } from "./thread-provisioning.js";
import { isPreStartThreadStatus } from "./thread-status.js";
import { abortPluginToolCallsForThreads } from "../plugins/plugin-tool-calls.js";
import { preservePathPluginsInside } from "../plugins/path-plugin-preservation.js";
import { joinHostPathSegments } from "../lib/host-path.js";
import type {
  DaemonLossReason,
  StopAnswer,
  TurnRequestAnswer,
} from "./lifecycle/machine.js";
import {
  runThreadLifecycleInTransaction,
  runThreadLifecycleTransaction,
  type ThreadLifecycleOutcome,
  type ThreadLifecycleTransactionDeps,
} from "./lifecycle/run.js";
import {
  finishThreadLifecycle,
  finishThreadLifecycleInBackground,
  runThreadLifecycle,
} from "./lifecycle/finish.js";

type ThreadStartCommand = Awaited<ReturnType<typeof buildThreadStartCommand>>;
type ThreadStopCommand = ReturnType<typeof buildThreadStopCommand>;
type ThreadStorageDeleteCommand =
  HostDaemonCommandForType<"thread.storage.delete">;
type ThreadPlanCancelCommand = HostDaemonCommandForType<"thread.plan.cancel">;
type TurnSubmitCommand = HostDaemonCommandForType<"turn.submit">;
type ThreadStopCommandResult = Extract<
  CommandResultReportForType<"thread.stop">,
  { ok: true }
>["result"];

interface PreparedThreadStartCommand {
  command: ThreadStartCommand;
  mode: "thread.start";
}

interface PreparedReadyTurnSubmitCommand {
  command: TurnSubmitCommand;
  mode: "turn.submit";
}

type PreparedReadyThreadTurnCommand =
  | PreparedThreadStartCommand
  | PreparedReadyTurnSubmitCommand;

interface SettleCommandResultArgs<TCommand, TType extends "thread.start" | "turn.submit" | "thread.stop" | "thread.storage.delete" | "thread.plan.cancel"> {
  command: TCommand;
  deps: CommandResultSettlementDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: CommandResultReportForType<TType>;
}

interface ThreadStopFailure {
  error: unknown;
  intent: ThreadStopCommand["intent"];
}

interface AwaitedThreadStopOutcome {
  failure: ThreadStopFailure | null;
  result: ThreadStopCommandResult | null;
}

interface StopTarget {
  environmentId: string | null;
  id: string;
  status: ThreadStatus;
}

interface StopEnvironment {
  hostId: string;
  id: string;
}

const AWAITED_THREAD_STOP_TIMEOUT_MS = 60_000;
const MAX_EXPLICIT_THREAD_STOP_ROUNDS = 4;
const MAX_THREAD_STORAGE_DELETES_PER_HOST = 4;
const SEND_STOP_SKIPPED: ReadonlySet<"send-stop"> = new Set(["send-stop"]);

export const TURN_START_DEADLINE_MS = 5 * 60_000;
export const TURN_START_DEADLINE_RECONNECT_GRACE_MS = 60_000;

const threadStorageDeletesInFlight = new Set<string>();
const threadStorageDeleteSlotsByHostId = new Map<
  string,
  { running: number; waiting: (() => void)[] }
>();

async function withThreadStorageDeleteSlot(
  hostId: string,
  task: () => Promise<void>,
): Promise<void> {
  let slots = threadStorageDeleteSlotsByHostId.get(hostId);
  if (slots === undefined) {
    slots = { running: 0, waiting: [] };
    threadStorageDeleteSlotsByHostId.set(hostId, slots);
  }
  if (slots.running >= MAX_THREAD_STORAGE_DELETES_PER_HOST) {
    await new Promise<void>((resolve) => slots.waiting.push(resolve));
  } else {
    slots.running += 1;
  }
  try {
    await task();
  } finally {
    const next = slots.waiting.shift();
    if (next === undefined) {
      slots.running -= 1;
      if (slots.running === 0) threadStorageDeleteSlotsByHostId.delete(hostId);
    } else {
      next();
    }
  }
}

function lifecyclePostCommit(
  outcome: ThreadLifecycleOutcome,
): CommandResultPostCommitAction {
  return { run: (deps) => finishThreadLifecycle(deps, outcome) };
}

function lifecycleSideEffects(
  outcome: ThreadLifecycleOutcome,
): CommandResultSideEffectsResult {
  return { postCommitActions: [lifecyclePostCommit(outcome)] };
}

const UNCONFIRMED_REQUEST_ERROR_CODES: ReadonlySet<string> = new Set([
  STEER_UNCONFIRMED_ERROR_CODE,
  TURN_START_UNCONFIRMED_ERROR_CODE,
]);

function expectedTurnIdForCommand(
  command: ThreadStartCommand | TurnSubmitCommand,
): string | null {
  return command.type === "turn.submit" && command.target.mode !== "start"
    ? command.target.expectedTurnId
    : null;
}

function turnRequestAnswer(
  deps: CommandResultSettlementDeps,
  args: {
    command: ThreadStartCommand | TurnSubmitCommand;
    report: CommandResultReportForType<"thread.start" | "turn.submit">;
  },
): TurnRequestAnswer {
  const { command, report } = args;
  if (report.ok) {
    return { kind: "accepted", threadStart: null };
  }
  if (UNCONFIRMED_REQUEST_ERROR_CODES.has(report.errorCode)) {
    return { kind: "unconfirmed" };
  }
  if (report.deliveryUnknown) {
    return { kind: "lost" };
  }
  if (
    report.errorCode === STALE_TURN_ERROR_CODE &&
    command.type === "turn.submit" &&
    command.target.mode !== "start"
  ) {
    return { kind: "stale" };
  }
  const expectedTurnId = expectedTurnIdForCommand(command);
  return {
    kind: "refused",
    code: report.errorCode,
    commandType: report.type,
    expectedTurnCompleted:
      expectedTurnId !== null &&
      hasStoredTurnCompleted(deps.db, {
        threadId: command.threadId,
        turnId: expectedTurnId,
      }),
    message: report.errorMessage,
    scopeTurnId: expectedTurnId,
  };
}

export function settleThreadStartCommandResult(
  args: SettleCommandResultArgs<ThreadStartCommand, "thread.start">,
): CommandResultSideEffectsResult {
  const { command, deps, report } = args;
  const answer: TurnRequestAnswer = report.ok
    ? {
        kind: "accepted",
        threadStart: {
          emptyFork: command.fork !== null && command.input.length === 0,
          executionId: args.execution.id,
          providerThreadId: report.result.providerThreadId,
          stale:
            hasStoredThreadInterruptedSince(deps.db, {
              createdAt: args.execution.createdAt,
              threadId: command.threadId,
            }) ||
            hasStoredProviderTurnCompletedSince(deps.db, {
              createdAt: args.execution.createdAt,
              providerThreadId: report.result.providerThreadId,
              threadId: command.threadId,
            }),
        },
      }
    : turnRequestAnswer(deps, { command, report });
  const outcome = runThreadLifecycleInTransaction(deps, command.threadId, {
    type: "request.answered",
    requestId: command.requestId,
    answer,
  });
  if (outcome.thread?.deletedAt != null) {
    finalizeDeletedThreadInTransaction(deps, outcome.thread);
  }
  return lifecycleSideEffects(outcome);
}

export function settleTurnSubmitCommandResult(
  args: SettleCommandResultArgs<TurnSubmitCommand, "turn.submit">,
): CommandResultSideEffectsResult {
  const { command } = args;
  const outcome = runThreadLifecycleInTransaction(args.deps, command.threadId, {
    type: "request.answered",
    requestId: command.requestId,
    answer: turnRequestAnswer(args.deps, {
      command,
      report: args.report,
    }),
  });
  const postCommitActions = [lifecyclePostCommit(outcome)];
  if (outcome.effects.some((effect) => effect.kind === "redeliver-steer")) {
    postCommitActions.push({
      run: (deps) => {
        startLiveHostCommand(deps, {
          command: {
            ...command,
            target: { mode: "auto", expectedTurnId: null },
          },
          hostId: args.execution.hostId,
          timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
          onError: ({ error }) => {
            deps.logger.warn(
              { err: error, threadId: command.threadId },
              "Live turn submit command failed",
            );
          },
        });
      },
    });
  }
  return { postCommitActions };
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
  args: Omit<ThreadStartCommandArgs, "fork">,
): Promise<PreparedReadyThreadTurnCommand> {
  await ensureHostSessionReadyForWork(deps, {
    hostId: args.environment.hostId,
  });
  const providerThreadId = requireDispatchableProviderThreadId(
    deps,
    args.thread.id,
  );
  if (providerThreadId) {
    const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
      environment: args.environment,
      execution: args.execution,
      input: args.input,
      ...(args.inputGroups !== undefined
        ? { inputGroups: args.inputGroups }
        : {}),
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
    };
  }

  return {
    command: await buildThreadStartCommand(deps, {
      ...args,
      fork: readDispatchedThreadStartFork(deps.db, args.thread.id),
    }),
    mode: "thread.start",
  };
}

function stopAnswerFromReport(
  report: CommandResultReportForType<"thread.stop">,
): StopAnswer {
  if (report.ok) {
    return {
      kind: "stopped",
      providerCheckpointId: report.result.providerCheckpointId,
    };
  }
  switch (report.errorCode) {
    case "unknown_environment":
      return { kind: "gone" };
    case "host_unavailable":
    case "command_timeout":
      return { kind: "unreachable" };
    default:
      return { kind: "failed" };
  }
}

export function settleThreadStopCommandResult(
  args: SettleCommandResultArgs<ThreadStopCommand, "thread.stop">,
): CommandResultSideEffectsResult {
  const { command, report } = args;
  if (command.intent === "release") {
    if (!report.ok) return emptyCommandResultSideEffects();
    return lifecycleSideEffects(
      runThreadLifecycleInTransaction(args.deps, command.threadId, {
        type: "release.answered",
        retained: report.result.activeTurnRetained === true,
      }),
    );
  }
  return lifecycleSideEffects(
    runThreadLifecycleInTransaction(args.deps, command.threadId, {
      type: "stop.answered",
      answer: stopAnswerFromReport(report),
      now: report.completedAt,
    }),
  );
}

export function settleThreadStorageDeleteCommandResult(
  args: SettleCommandResultArgs<
    ThreadStorageDeleteCommand,
    "thread.storage.delete"
  >,
): CommandResultSideEffectsResult {
  if (!args.report.ok) {
    return emptyCommandResultSideEffects();
  }
  markThreadStorageDeleted(args.deps.db, {
    threadId: args.command.threadId,
  });
  return lifecycleSideEffects(
    finalizeStoppedThreadInTransaction(args.deps, {
      providerCheckpointId: args.report.result.providerCheckpointId,
      threadId: args.command.threadId,
    }),
  );
}

export function settleThreadPlanCancelCommandResult(
  args: SettleCommandResultArgs<ThreadPlanCancelCommand, "thread.plan.cancel">,
): CommandResultSideEffectsResult {
  if (!args.report.ok || !args.report.result.cancelled) {
    return emptyCommandResultSideEffects();
  }
  const activeTurnId = getActiveStoredTurnId(
    args.deps.db,
    args.command.threadId,
  );
  if (activeTurnId !== null && activeTurnId !== args.command.expectedTurnId) {
    return emptyCommandResultSideEffects();
  }
  return lifecycleSideEffects(
    finalizeStoppedThreadInTransaction(args.deps, {
      providerCheckpointId: null,
      threadId: args.command.threadId,
    }),
  );
}

export function requestThreadStorageDeletion(
  deps: CommandResultSideEffectsDeps,
  thread: Pick<Thread, "environmentId" | "id">,
  environment: StopEnvironment | null,
): void {
  deps.pendingInteractions.interruptPendingInteractionsForThreadIds({
    threadIds: [thread.id],
    reason: "thread-deleted",
  });
  abortPluginToolCallsForThreads([thread.id], "thread-deleted");
  const host =
    environment === null ? null : getHost(deps.db, environment.hostId);
  if (
    thread.environmentId === null ||
    (host !== null && host.destroyedAt !== null)
  ) {
    markThreadStorageDeleted(deps.db, { threadId: thread.id });
    finalizeStoppedThread(deps, { threadId: thread.id });
    return;
  }
  if (environment === null) {
    deps.logger.warn(
      { environmentId: thread.environmentId, threadId: thread.id },
      "Thread storage deletion environment is unavailable",
    );
    return;
  }
  if (threadStorageDeletesInFlight.has(thread.id)) {
    return;
  }
  threadStorageDeletesInFlight.add(thread.id);
  void withThreadStorageDeleteSlot(environment.hostId, () =>
    deleteThreadStorageKeepingPlugins(deps, {
      environment,
      threadId: thread.id,
    }),
  ).finally(() => {
    threadStorageDeletesInFlight.delete(thread.id);
  });
}

async function deleteThreadStorageKeepingPlugins(
  deps: CommandResultSideEffectsDeps,
  args: { environment: StopEnvironment; threadId: string },
): Promise<void> {
  const session = getLatestSessionForHost(deps.db, {
    hostId: args.environment.hostId,
  });
  try {
    if (session !== null) {
      await preservePathPluginsInside(
        deps.db,
        joinHostPathSegments(session.dataDir, "thread-storage", args.threadId),
      );
    }
  } catch (error) {
    deps.logger.warn(
      { err: error, threadId: args.threadId },
      "Thread storage deletion skipped: plugins installed from it could not be kept",
    );
    return;
  }
  await runLiveHostCommand(deps, {
    command: buildThreadStorageDeleteCommand({
      environmentId: args.environment.id,
      threadId: args.threadId,
    }),
    hostId: args.environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  }).catch((error) => {
    deps.logger.warn(
      { err: error, threadId: args.threadId },
      "Thread storage deletion command failed",
    );
  });
}

function dispatchThreadStartInTransaction(
  deps: CommandResultSideEffectsDeps,
  args: {
    command: ThreadStartCommand;
    hostId: string;
    sourceThreadStatus: ThreadStatus;
    syncTitle: boolean;
    threadId: string;
  },
): {
  completedProvisionSequence: number | null;
  outcome: ThreadLifecycleOutcome | null;
} {
  const notifications = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx) => {
      const currentThread = getThread(tx, args.threadId);
      const activeProvisionContext =
        args.sourceThreadStatus === "starting"
          ? getThreadProvisionContext(tx, args.threadId)
          : null;
      if (
        currentThread === null ||
        (activeProvisionContext !== null &&
          !isPreStartThreadStatus(currentThread.status))
      ) {
        return { completedProvisionSequence: null, outcome: null };
      }
      const outcome = runThreadLifecycleInTransaction(
        { ...deps, db: tx, hub: notifications },
        args.threadId,
        {
          type: "request.sent",
          request: {
            hostId: args.hostId,
            kind: "thread-start",
            requestId: args.command.requestId,
            syncTitle: args.syncTitle,
          },
          now: Date.now(),
        },
      );
      if (outcome.refusal !== null) {
        return { completedProvisionSequence: null, outcome: null };
      }
      if (activeProvisionContext === null) {
        return { completedProvisionSequence: null, outcome };
      }
      tx.update(threads)
        .set({
          startupContext: sql`json_set(${threads.startupContext}, '$.kind', 'dispatched')`,
        })
        .where(
          and(
            eq(threads.id, args.threadId),
            sql`json_extract(${threads.startupContext}, '$.state.provisioningId') = ${activeProvisionContext.state.provisioningId}`,
          ),
        )
        .run();
      const completedProvisionSequence =
        activeProvisionContext.state.provisionEventSequence === null
          ? null
          : appendThreadProvisioningEventInTransaction(tx, {
              threadId: args.threadId,
              environmentId: args.command.environmentId,
              provisioningId: activeProvisionContext.state.provisioningId,
              status: "completed",
              entries: [],
            });
      return { completedProvisionSequence, outcome };
    },
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  if (result.completedProvisionSequence !== null) {
    deps.hub.notifyThread(args.threadId, ["events-appended"], {
      timelineSequence: result.completedProvisionSequence,
      eventTypes: ["system/thread-provisioning"],
    });
  }
  return result;
}

export async function requestThreadStart(
  deps: CommandResultSideEffectsDeps,
  args: ThreadStartCommandArgs,
): Promise<void> {
  if (hasThreadStartTurnRequest(deps.db, args.thread.id)) {
    return;
  }
  const command = await buildThreadStartCommand(deps, args);
  await ensureHostSessionReadyForWork(deps, {
    hostId: args.environment.hostId,
  });
  const { outcome } = dispatchThreadStartInTransaction(deps, {
    command,
    hostId: args.environment.hostId,
    sourceThreadStatus: args.thread.status,
    syncTitle: args.syncGeneratedTitle,
    threadId: args.thread.id,
  });
  if (outcome === null) {
    return;
  }
  await finishThreadLifecycle(deps, outcome);
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
      if (getThreadProvisionContext(deps.db, args.thread.id) !== null) {
        scheduleThreadProvisioningAdvance(deps, args.thread.id);
      }
    });
}

export function turnStartDeadlineSweep(
  deps: CommandResultSideEffectsDeps,
  now: number,
): ItemSweep {
  const deadline = now - TURN_START_DEADLINE_MS;
  return defineItemSweep({
    name: "turn-start-deadline",
    concurrency: 1,
    list: (): TurnStartDeadlineCandidate[] =>
      listTurnStartDeadlineCandidates(deps.db, { deadline }),
    key: (candidate) => candidate.threadId,
    process: async (candidate) => {
      const daemonConnectedAt = deps.hub.getDaemonConnectedAtForHost(
        candidate.hostId,
      );
      if (
        daemonConnectedAt === null ||
        now - daemonConnectedAt < TURN_START_DEADLINE_RECONNECT_GRACE_MS
      ) {
        return;
      }
      const notifications = new NotificationBuffer();
      const outcome = deps.db.transaction(
        (tx) =>
          isThreadAwaitingTurnStartPastDeadline(tx, {
            deadline,
            threadId: candidate.threadId,
          })
            ? runThreadLifecycleInTransaction(
                { ...deps, db: tx, hub: notifications },
                candidate.threadId,
                {
                  type: "turn-start.overdue",
                  deadlineMinutes: TURN_START_DEADLINE_MS / 60_000,
                  now,
                },
              )
            : null,
        { behavior: "immediate" },
      );
      notifications.flushInto(deps.hub);
      if (outcome === null || !outcome.statusChanged) return;
      deps.logger.warn(
        { threadId: candidate.threadId },
        "Stopping a run whose turn never started",
      );
      await finishThreadLifecycle(deps, outcome);
    },
  });
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

interface PreStartStopResult {
  abandonedProvider: boolean;
  cancelHostId: string | null;
  environmentId: string | null;
  finalized: boolean;
  outcomes: ThreadLifecycleOutcome[];
}

function requestThreadStopInTransaction(
  deps: CommandResultSettlementDeps,
  threadId: string,
): PreStartStopResult {
  const requested = runThreadLifecycleInTransaction(deps, threadId, {
    type: "stop.requested",
    reason: "manual-stop",
    now: Date.now(),
  });
  const thread = requested.thread;
  if (requested.stopRoute !== "pre-start" || thread === null) {
    return {
      abandonedProvider: false,
      cancelHostId: null,
      environmentId: thread?.environmentId ?? null,
      finalized: requested.stopRoute !== "live",
      outcomes: [requested],
    };
  }
  const leftStarting = requested.previousStatus === "starting";
  const context = leftStarting
    ? getThreadProvisionContext(deps.db, thread.id)
    : null;
  const abandonedProvider =
    context?.request.environmentIntent.type === "provider" &&
    context.state.environmentId === null;
  if (context !== null && context.state.provisionEventSequence !== null) {
    appendThreadProvisioningEventInTransaction(deps.db, {
      threadId: thread.id,
      environmentId: context.state.environmentId ?? thread.environmentId,
      provisioningId: context.state.provisioningId,
      status: "cancelled",
      entries: [buildProvisioningStoppedEntry()],
    });
    deps.hub.notifyThread(thread.id, ["events-appended"], {
      timelineSequence: getLatestThreadSequence(deps.db, {
        threadId: thread.id,
      }),
      eventTypes: ["system/thread-provisioning"],
    });
  }
  clearThreadProvisionSchedule(thread.id);
  const environment =
    thread.environmentId === null
      ? null
      : getEnvironment(deps.db, thread.environmentId);
  const cancellation =
    environment === null
      ? "ready_to_finalize"
      : cancelEnvironmentProvisioningForThreadStopInTransaction(deps, {
          environmentId: environment.id,
          threadId: thread.id,
        });
  if (cancellation === "awaiting_host_cancel" && environment !== null) {
    return {
      abandonedProvider,
      cancelHostId: environment.hostId,
      environmentId: environment.id,
      finalized: false,
      outcomes: [requested],
    };
  }
  return {
    abandonedProvider,
    cancelHostId: null,
    environmentId: thread.environmentId,
    finalized: true,
    outcomes: [requested, finalizeStoppedThreadInTransaction(deps, { threadId: thread.id, providerCheckpointId: null })],
  };
}

async function requestThreadStop(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
  options: { skipSendStop: boolean },
): Promise<ThreadLifecycleOutcome> {
  const notifications = new NotificationBuffer();
  const result = deps.db.transaction(
    (tx) =>
      requestThreadStopInTransaction(
        { ...deps, db: tx, hub: notifications },
        threadId,
      ),
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  if (result.outcomes[0]?.stopRoute === "pre-start") {
    requestQueuedMessageDispatch(deps, {
      kind: "provisioning-ended",
      threadId,
    });
  }
  for (const outcome of result.outcomes) {
    await finishThreadLifecycle(
      deps,
      outcome,
      options.skipSendStop ? { skip: SEND_STOP_SKIPPED } : {},
    );
  }
  if (result.abandonedProvider) {
    cancelAbandonedProviderCreations(deps, threadId);
  }
  if (!result.finalized && result.environmentId && result.cancelHostId) {
    void advanceEnvironmentProvisioning(deps, {
      environmentId: result.environmentId,
    }).catch((error) =>
      deps.logger.warn(
        { environmentId: result.environmentId, error },
        "Environment cancellation failed",
      ),
    );
  }
  return result.outcomes[0]!;
}

export function requestThreadStopForCurrentState(
  deps: LoggedPendingInteractionWorkSessionDeps,
  thread: Pick<StopTarget, "id">,
): void {
  void requestThreadStop(deps, thread.id, { skipSendStop: false }).catch(
    (error) =>
      deps.logger.warn(
        { err: error, threadId: thread.id },
        "Thread stop request failed",
      ),
  );
}

const threadStopRequestDeduper = new Map<
  string,
  Promise<ThreadStopFailure | null>
>();

export async function stopThreadForCurrentState(
  deps: LoggedPendingInteractionWorkSessionDeps,
  thread: StopTarget,
  environment: StopEnvironment | null,
  options?: { requireStopped: true },
): Promise<void> {
  await revokeThreadDesktopBrowserControl(deps, thread.id);
  let pending = threadStopRequestDeduper.get(thread.id);
  if (pending === undefined) {
    pending = stopThreadUntilSettled(deps, thread.id, environment).finally(
      () => threadStopRequestDeduper.delete(thread.id),
    );
    threadStopRequestDeduper.set(thread.id, pending);
  }
  const failure = await pending;
  if (failure === null) {
    return;
  }
  if (options?.requireStopped) {
    throw failure.error;
  }
  if (
    failure.intent === "release" &&
    !isHostUnavailableApiError(failure.error)
  ) {
    throw failure.error;
  }
}

function isUnansweredStopError(error: unknown): boolean {
  return (
    isHostUnavailableApiError(error) ||
    (error instanceof ApiError && error.body.code === "command_timeout")
  );
}

function isLiveStatus(threadId: string, deps: LoggedPendingInteractionWorkSessionDeps): boolean {
  const thread = getThread(deps.db, threadId);
  return (
    thread !== null &&
    (thread.status === "active" ||
      hasThreadStartTurnRequest(deps.db, threadId) ||
      (thread.status === "stopping" &&
        getActiveStoredTurnId(deps.db, threadId) !== null))
  );
}

async function stopThreadUntilSettled(
  deps: LoggedPendingInteractionWorkSessionDeps,
  threadId: string,
  environment: StopEnvironment | null,
): Promise<ThreadStopFailure | null> {
  if (environment === null) {
    await requestThreadStop(deps, threadId, { skipSendStop: false });
    return null;
  }
  for (let round = 0; round < MAX_EXPLICIT_THREAD_STOP_ROUNDS; round += 1) {
    if (getThread(deps.db, threadId) === null) {
      return null;
    }
    const requested = await requestThreadStop(deps, threadId, {
      skipSendStop: true,
    });
    if (requested.stopRoute === "pre-start") {
      return null;
    }
    if (requested.stopRoute === "live") {
      const interrupted = await runAwaitedThreadStopCommand(deps, {
        command: buildThreadStopCommand({
          environmentId: environment.id,
          hostId: environment.hostId,
          intent: "interrupt",
          threadId,
        }),
        hostId: environment.hostId,
      });
      if (interrupted.failure !== null) {
        const after = getThread(deps.db, threadId);
        if (after?.status === "idle" || after?.status === "error") {
          if (isUnansweredStopError(interrupted.failure.error)) {
            return null;
          }
          continue;
        }
      }
      return interrupted.failure;
    }
    const released = await runAwaitedThreadStopCommand(deps, {
      command: buildThreadStopCommand({
        environmentId: environment.id,
        hostId: environment.hostId,
        intent: "release",
        threadId,
      }),
      hostId: environment.hostId,
    });
    if (released.failure !== null) {
      return released.failure;
    }
    if (released.result?.activeTurnRetained === true) {
      deps.logger.warn(
        { threadId },
        "Host daemon kept an active turn on release; interrupting it for the explicit stop",
      );
      if (!isLiveStatus(threadId, deps)) {
        const interrupted = await runAwaitedThreadStopCommand(deps, {
          command: buildThreadStopCommand({
            environmentId: environment.id,
            hostId: environment.hostId,
            intent: "interrupt",
            threadId,
          }),
          hostId: environment.hostId,
        });
        return interrupted.failure;
      }
      continue;
    }
    if (!isLiveStatus(threadId, deps)) {
      return null;
    }
  }
  return {
    error: new ApiError(
      409,
      "invalid_request",
      `Thread ${threadId} kept starting turns while it was being stopped`,
    ),
    intent: "interrupt",
  };
}

async function runAwaitedThreadStopCommand(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: { command: ThreadStopCommand; hostId: string },
): Promise<AwaitedThreadStopOutcome> {
  try {
    const result = await runLiveHostCommand(deps, {
      command: args.command,
      hostId: args.hostId,
      timeoutMs: AWAITED_THREAD_STOP_TIMEOUT_MS,
    });
    return { failure: null, result };
  } catch (error) {
    deps.logger.warn(
      {
        err: error,
        intent: args.command.intent,
        threadId: args.command.threadId,
      },
      "Awaited thread stop command failed",
    );
    return {
      failure: { error, intent: args.command.intent },
      result: null,
    };
  }
}

interface InterruptActiveThreadsForHostArgs {
  cause?: "host-connection-lost";
  hostId: string;
  includeStopping: boolean;
  reason: "host-daemon-restarted" | "host-removed";
  resumingThreadIds: ReadonlySet<string>;
}

interface InterruptedActiveThreadResult {
  interruptedTurnId: string | null;
  threadId: string;
}

export function interruptActiveThreadsForHost(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: InterruptActiveThreadsForHostArgs,
): { threads: InterruptedActiveThreadResult[] } {
  const activeThreadIds = deps.db
    .select({ threadId: threads.id })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        inArray(
          threads.status,
          args.includeStopping ? ["active", "stopping"] : ["active"],
        ),
        isNull(threads.deletedAt),
      ),
    )
    .all()
    .map((row) => row.threadId);
  const threadIds = new Set([
    ...activeThreadIds,
    ...listThreadIdsWithTurnRequestsForHost(deps.db, { hostId: args.hostId }),
  ]);
  const reason: DaemonLossReason =
    args.cause === "host-connection-lost" ? "host-connection-lost" : args.reason;
  const results: InterruptedActiveThreadResult[] = [];
  for (const threadId of threadIds) {
    const interruptedTurnId = getActiveStoredTurnId(deps.db, threadId);
    const outcome = runThreadLifecycleTransaction(deps, threadId, {
      type: "daemon.lost",
      reason,
      resuming: args.resumingThreadIds.has(threadId),
    });
    finishThreadLifecycleInBackground(deps, outcome);
    if (outcome.statusChanged) {
      results.push({ interruptedTurnId, threadId });
    }
  }
  return { threads: results };
}

interface FinalizeStoppedThreadArgs {
  providerCheckpointId?: string | null;
  threadId: string;
}

function finalizeDeletedThreadInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  thread: NonNullable<ReturnType<typeof getThread>>,
): void {
  clearThreadProvisionSchedule(thread.id);
  if (thread.environmentId !== null && thread.storageDeletedAt === null) {
    return;
  }
  if (providerEnvironmentHasPendingWork(deps.db, thread.id)) return;
  requestThreadPurge(deps.db, { now: Date.now(), threadId: thread.id });
  if (thread.environmentId !== null) {
    refreshProviderRetirement(deps, thread.environmentId);
  }
}

export function finalizeStoppedThreadInTransaction(
  deps: ThreadLifecycleTransactionDeps,
  args: FinalizeStoppedThreadArgs,
): ThreadLifecycleOutcome {
  const outcome = runThreadLifecycleInTransaction(deps, args.threadId, {
    type: "stop.finalized",
    providerCheckpointId: args.providerCheckpointId ?? null,
    now: Date.now(),
  });
  const thread = getThread(deps.db, args.threadId);
  if (thread !== null && thread.deletedAt !== null) {
    finalizeDeletedThreadInTransaction(deps, thread);
  }
  return outcome;
}

export function finalizeStoppedThreadPostCommit(
  outcome: ThreadLifecycleOutcome,
): CommandResultPostCommitAction {
  return lifecyclePostCommit(outcome);
}

export function finalizeStoppedThread(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: FinalizeStoppedThreadArgs,
): void {
  const notifications = new NotificationBuffer();
  const outcome = deps.db.transaction(
    (tx) =>
      finalizeStoppedThreadInTransaction(
        { ...deps, db: tx, hub: notifications },
        args,
      ),
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  finishThreadLifecycleInBackground(deps, outcome);
}

interface ReconcileDaemonReportedThreadsArgs {
  activeThreadIds: readonly string[];
  hostId: string;
  sameDaemonInstance: boolean;
  undeliveredEventThreadIds: readonly string[];
}

export async function reconcileDaemonReportedThreads(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: ReconcileDaemonReportedThreadsArgs,
): Promise<void> {
  const deletedThreads = deps.db
    .select({
      environmentId: environments.id,
      id: threads.id,
      storageDeletedAt: threads.storageDeletedAt,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        isNotNull(threads.deletedAt),
        notExists(
          deps.db
            .select({ threadId: threadPurges.threadId })
            .from(threadPurges)
            .where(eq(threadPurges.threadId, threads.id)),
        ),
      ),
    )
    .all();
  for (const thread of deletedThreads) {
    if (thread.storageDeletedAt !== null) {
      finalizeStoppedThread(deps, { threadId: thread.id });
      continue;
    }
    requestThreadStorageDeletion(deps, thread, {
      hostId: args.hostId,
      id: thread.environmentId,
    });
  }

  const running = new Set(args.activeThreadIds);
  const eventsPending = new Set(args.undeliveredEventThreadIds);
  const candidates = deps.db
    .select({ id: threads.id, status: threads.status })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        eq(environments.hostId, args.hostId),
        isNull(threads.deletedAt),
        inArray(threads.status, ["active", "starting", "stopping", "idle", "error"]),
      ),
    )
    .all()
    .filter(
      (thread) =>
        running.has(thread.id) ||
        thread.status === "active" ||
        thread.status === "starting" ||
        thread.status === "stopping",
    );
  const threadIds = new Set([
    ...candidates.map((thread) => thread.id),
    ...listThreadIdsWithTurnRequestsForHost(deps.db, { hostId: args.hostId }),
    ...listThreadIdsWithOwedStopForHost(deps.db, { hostId: args.hostId }),
  ]);
  const revivalBlocked = new Set(
    listThreadIdsWithLatestHostDaemonRestartInterruption(deps.db, {
      threadIds: [...threadIds].filter((id) => running.has(id)),
    }),
  );
  const now = Date.now();
  for (const threadId of threadIds) {
    await runThreadLifecycle(deps, threadId, {
      type: "daemon.reported",
      eventsPending: eventsPending.has(threadId),
      now,
      revivalBlocked: revivalBlocked.has(threadId),
      running: running.has(threadId),
      sameInstance: args.sameDaemonInstance,
    });
  }
}

export function resendStopsAwaitingDaemon(
  deps: LoggedPendingInteractionWorkSessionDeps,
  hostId: string,
): void {
  const now = Date.now();
  for (const threadId of listThreadIdsWithOwedStopForHost(deps.db, {
    hostId,
  })) {
    finishThreadLifecycleInBackground(
      deps,
      runThreadLifecycleTransaction(deps, threadId, {
        type: "daemon.socket-opened",
        now,
      }),
    );
  }
}

export async function recoverThreadLifecyclesAfterRestart(
  deps: LoggedPendingInteractionWorkSessionDeps,
): Promise<number> {
  const threadIds = listThreadIdsAwaitingTurnRequestAnswers(deps.db);
  for (const threadId of threadIds) {
    await runThreadLifecycle(deps, threadId, { type: "server.restarted" });
  }
  return threadIds.length;
}

