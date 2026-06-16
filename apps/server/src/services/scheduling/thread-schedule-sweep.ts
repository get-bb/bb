import {
  advanceThreadScheduleAfterFireInTransaction,
  advanceThreadScheduleAfterSkip,
  type DbConnection,
  type DbTransaction,
  deleteThreadSchedule,
  type DueThreadScheduleCursor,
  getActiveStoredTurnId,
  getEnvironment,
  getThread,
  listDueThreadSchedules,
  type ThreadScheduleRow,
  updateThreadSchedule,
} from "@bb/db";
import type {
  PromptInput,
  ResolvedThreadExecutionOptions,
  ThreadChangeKind,
  TurnRequestTarget,
} from "@bb/domain";
import type {
  HostDaemonCommand,
  TurnSubmitTarget,
} from "@bb/host-daemon-contract";
import { renderTemplate } from "@bb/templates";
import type { AppDeps } from "../../types.js";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import {
  appendClientTurnEventInTransaction,
  getActiveTurnId,
  getLastProviderThreadId,
} from "../threads/thread-events.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import {
  addRequestIdToTurnSubmitCommandPayload,
  buildExecutionOptions,
  prepareTurnSubmitCommandPayload,
  type PreparedTurnSubmitCommandPayload,
} from "../threads/thread-commands.js";
import { resolvePermissionEscalation } from "../threads/thread-runtime-config.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  startLiveHostCommand,
} from "../hosts/live-command.js";
import { applyLoggedThreadLifecycleEventInTransaction } from "../threads/lifecycle-outcome.js";
import {
  computeNextScheduledTime,
  ScheduleValidationError,
} from "./schedule-helpers.js";

const DUE_THREAD_SCHEDULE_BATCH_SIZE = 100;

type ScheduledThread = NonNullable<ReturnType<typeof getThread>>;
type ScheduledThreadEnvironment = NonNullable<
  ReturnType<typeof getEnvironment>
>;

export interface ThreadScheduleSweepCache {
  environmentById: Map<string, ReturnType<typeof getEnvironment>>;
  pendingTurnSubmitByThreadId: Map<string, boolean>;
  providerThreadIdByThreadId: Map<string, string | null>;
}

interface DeleteDueThreadSchedulePreparation {
  kind: "delete";
}

interface SkipDueThreadSchedulePreparation {
  kind: "skip";
  reason: string;
}

interface DisableDueThreadSchedulePreparation {
  kind: "disable";
  reason: string;
}

interface QueueDueThreadSchedulePreparation {
  environment: ScheduledThreadEnvironment;
  execution: ResolvedThreadExecutionOptions;
  input: PromptInput[];
  kind: "queue";
  preparedCommand: PreparedTurnSubmitCommandPayload;
  sessionId: string;
  targetIntent: ThreadScheduleTurnTargetIntent;
  thread: ScheduledThread;
}

type DueThreadSchedulePreparation =
  | DeleteDueThreadSchedulePreparation
  | DisableDueThreadSchedulePreparation
  | QueueDueThreadSchedulePreparation
  | SkipDueThreadSchedulePreparation;

interface StartThreadScheduleTurnTargetIntent {
  kind: "start";
}

interface AutoThreadScheduleTurnTargetIntent {
  expectedTurnId: string | null;
  kind: "auto";
}

type ThreadScheduleTurnTargetIntent =
  | AutoThreadScheduleTurnTargetIntent
  | StartThreadScheduleTurnTargetIntent;

interface BuildThreadScheduleTurnTargetIntentArgs {
  expectedTurnId: string | null;
  thread: ScheduledThread;
}

interface IsThreadSchedulePreparationCurrentArgs {
  preparation: QueueDueThreadSchedulePreparation;
}

interface DisableThreadScheduleFromSweepArgs {
  reason: string;
  schedule: ThreadScheduleRow;
  validationError: string | null;
}

interface QueuedScheduleResult {
  command: Extract<HostDaemonCommand, { type: "turn.submit" }>;
  threadBecameActive: boolean;
}

class DueThreadScheduleLostRaceError extends Error {
  constructor() {
    super("Due thread schedule lost race");
    this.name = "DueThreadScheduleLostRaceError";
  }
}

function buildThreadScheduleInput(schedule: ThreadScheduleRow): PromptInput[] {
  return [
    {
      type: "text",
      text: renderTemplate("systemMessageThreadScheduleDue", {
        prompt: schedule.prompt,
        scheduleId: schedule.id,
      }),
      mentions: [],
    },
  ];
}

function computeNextFireAt(schedule: ThreadScheduleRow, now: number): number {
  return computeNextScheduledTime({
    cron: schedule.cron,
    now,
    timezone: schedule.timezone,
  });
}

function isEnvironmentReadyForScheduleQueue(
  environment: ScheduledThreadEnvironment,
): boolean {
  return environment.status === "ready" && Boolean(environment.path);
}

function disableThreadScheduleFromSweep(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  args: DisableThreadScheduleFromSweepArgs,
): void {
  const disabled = updateThreadSchedule(deps.db, deps.hub, args.schedule.id, {
    enabled: false,
  });
  if (!disabled) {
    return;
  }

  deps.logger.warn(
    {
      cron: args.schedule.cron,
      name: args.schedule.name,
      projectId: args.schedule.projectId,
      scheduleId: args.schedule.id,
      threadId: args.schedule.threadId,
      timezone: args.schedule.timezone,
      validationError: args.validationError,
      reason: args.reason,
    },
    "Disabled thread schedule during due schedule sweep",
  );
}

function advanceSkippedThreadSchedule(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  args: {
    now: number;
    reason: string;
    schedule: ThreadScheduleRow;
  },
): void {
  let nextFireAt: number;
  try {
    nextFireAt = computeNextFireAt(args.schedule, args.now);
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      disableThreadScheduleFromSweep(deps, {
        reason: args.reason,
        schedule: args.schedule,
        validationError: error.message,
      });
      return;
    }
    throw error;
  }

  const advanced = advanceThreadScheduleAfterSkip(deps.db, deps.hub, {
    scheduleId: args.schedule.id,
    expectedNextFireAt: args.schedule.nextFireAt,
    nextFireAt,
    projectId: args.schedule.projectId,
    now: args.now,
  });

  if (advanced) {
    deps.logger.info(
      {
        scheduleId: args.schedule.id,
        reason: args.reason,
        threadId: args.schedule.threadId,
      },
      "Skipped due thread schedule",
    );
  }
}

function canQueueScheduleForThread(thread: ScheduledThread): boolean {
  // A thread that is `stopping` is winding down its turn; it is neither idle
  // nor active, so it is excluded here structurally. The lifecycle table backs
  // this up — `stopping` has no run.started cell — so a scheduled turn
  // cannot reactivate a stopping thread even if this early-skip is bypassed.
  return thread.status === "idle" || thread.status === "active";
}

function buildThreadScheduleTurnTargetIntent(
  args: BuildThreadScheduleTurnTargetIntentArgs,
): ThreadScheduleTurnTargetIntent {
  if (args.thread.status === "active") {
    return {
      kind: "auto",
      expectedTurnId: args.expectedTurnId,
    };
  }

  return { kind: "start" };
}

function renderThreadScheduleTurnSubmitTarget(
  intent: ThreadScheduleTurnTargetIntent,
): TurnSubmitTarget {
  switch (intent.kind) {
    case "start":
      return { mode: "start" };
    case "auto":
      return {
        mode: "auto",
        expectedTurnId: intent.expectedTurnId,
      };
  }
}

function renderThreadScheduleTurnRequestTarget(
  intent: ThreadScheduleTurnTargetIntent,
): TurnRequestTarget {
  switch (intent.kind) {
    case "start":
      return { kind: "new-turn" };
    case "auto":
      return {
        kind: "auto",
        expectedTurnId: intent.expectedTurnId,
      };
  }
}

function threadScheduleTurnTargetIntentsEqual(
  left: ThreadScheduleTurnTargetIntent,
  right: ThreadScheduleTurnTargetIntent,
): boolean {
  switch (left.kind) {
    case "start":
      return right.kind === "start";
    case "auto":
      return (
        right.kind === "auto" && right.expectedTurnId === left.expectedTurnId
      );
  }
}

function isThreadSchedulePreparationCurrent(
  tx: DbTransaction,
  args: IsThreadSchedulePreparationCurrentArgs,
): boolean {
  const latestEnvironment = getEnvironment(tx, args.preparation.environment.id);
  if (
    !latestEnvironment ||
    !isEnvironmentReadyForScheduleQueue(latestEnvironment) ||
    latestEnvironment.hostId !== args.preparation.environment.hostId ||
    latestEnvironment.path !== args.preparation.environment.path ||
    latestEnvironment.workspaceProvisionType !==
      args.preparation.environment.workspaceProvisionType
  ) {
    return false;
  }

  const latestThread = getThread(tx, args.preparation.thread.id);
  if (
    !latestThread ||
    latestThread.archivedAt !== null ||
    latestThread.deletedAt !== null ||
    latestThread.environmentId !== args.preparation.environment.id ||
    !canQueueScheduleForThread(latestThread)
  ) {
    return false;
  }

  const expectedTurnId =
    latestThread.status === "active"
      ? getActiveStoredTurnId(tx, latestThread.id)
      : null;
  const currentTargetIntent = buildThreadScheduleTurnTargetIntent({
    expectedTurnId,
    thread: latestThread,
  });

  return threadScheduleTurnTargetIntentsEqual(
    args.preparation.targetIntent,
    currentTargetIntent,
  );
}

function createThreadScheduleSweepCache(): ThreadScheduleSweepCache {
  return {
    environmentById: new Map(),
    pendingTurnSubmitByThreadId: new Map(),
    providerThreadIdByThreadId: new Map(),
  };
}

function resetThreadScheduleSweepBatchCache(
  cache: ThreadScheduleSweepCache,
): void {
  cache.pendingTurnSubmitByThreadId.clear();
}

function hasPendingTurnSubmitCommand(
  threadId: string,
  cache?: ThreadScheduleSweepCache,
): boolean {
  return cache?.pendingTurnSubmitByThreadId.get(threadId) ?? false;
}

function getCachedEnvironment(
  db: DbConnection,
  cache: ThreadScheduleSweepCache,
  environmentId: string,
): ReturnType<typeof getEnvironment> {
  if (cache.environmentById.has(environmentId)) {
    return cache.environmentById.get(environmentId) ?? null;
  }
  const environment = getEnvironment(db, environmentId);
  cache.environmentById.set(environmentId, environment);
  return environment;
}

function getCachedProviderThreadId(
  deps: Pick<AppDeps, "db">,
  cache: ThreadScheduleSweepCache,
  threadId: string,
): string | null {
  if (cache.providerThreadIdByThreadId.has(threadId)) {
    return cache.providerThreadIdByThreadId.get(threadId) ?? null;
  }
  const providerThreadId = getLastProviderThreadId(deps, threadId);
  cache.providerThreadIdByThreadId.set(threadId, providerThreadId);
  return providerThreadId;
}

function toDueThreadScheduleCursor(
  schedule: ThreadScheduleRow,
): DueThreadScheduleCursor {
  return {
    createdAt: schedule.createdAt,
    id: schedule.id,
    nextFireAt: schedule.nextFireAt,
  };
}

async function prepareDueThreadSchedule(
  deps: CommandResultSideEffectsDeps,
  cache: ThreadScheduleSweepCache,
  schedule: ThreadScheduleRow,
): Promise<DueThreadSchedulePreparation> {
  const thread = getThread(deps.db, schedule.threadId);
  if (!thread || thread.deletedAt !== null) {
    return { kind: "delete" };
  }

  if (thread.archivedAt !== null) {
    return {
      kind: "disable",
      reason: "thread-archived",
    };
  }

  if (!canQueueScheduleForThread(thread)) {
    return {
      kind: "skip",
      reason: "thread-not-runnable",
    };
  }

  if (!thread.environmentId) {
    return {
      kind: "skip",
      reason: "thread-missing-environment",
    };
  }

  const environment = getCachedEnvironment(
    deps.db,
    cache,
    thread.environmentId,
  );
  if (!environment || !isEnvironmentReadyForScheduleQueue(environment)) {
    return {
      kind: "skip",
      reason: "environment-not-ready",
    };
  }

  const providerThreadId = getCachedProviderThreadId(deps, cache, thread.id);
  if (!providerThreadId) {
    return {
      kind: "skip",
      reason: "missing-provider-thread",
    };
  }

  if (hasPendingTurnSubmitCommand(thread.id, cache)) {
    return {
      kind: "skip",
      reason: "pending-turn-submit",
    };
  }

  try {
    const session = await ensureHostSessionReadyForWork(deps, {
      hostId: environment.hostId,
    });
    const execution = await buildExecutionOptions(
      deps,
      {},
      { threadId: thread.id },
      "client/turn/requested",
    );
    const expectedTurnId =
      thread.status === "active" ? getActiveTurnId(deps, thread.id) : null;
    const targetIntent = buildThreadScheduleTurnTargetIntent({
      expectedTurnId,
      thread,
    });
    const input = buildThreadScheduleInput(schedule);
    const preparedCommand = await prepareTurnSubmitCommandPayload(deps, {
      environment: {
        id: environment.id,
        hostId: environment.hostId,
        path: environment.path,
        status: environment.status,
        workspaceProvisionType: environment.workspaceProvisionType,
      },
      execution,
      permissionEscalation: resolvePermissionEscalation({
        thread,
        initiator: "system",
      }),
      input,
      providerThreadId,
      target: renderThreadScheduleTurnSubmitTarget(targetIntent),
      thread,
    });

    return {
      environment,
      execution,
      input,
      kind: "queue",
      preparedCommand,
      sessionId: session.id,
      targetIntent,
      thread,
    };
  } catch (error) {
    deps.logger.warn(
      {
        scheduleId: schedule.id,
        threadId: thread.id,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Skipping due thread schedule after runtime preparation failed",
    );
    return {
      kind: "skip",
      reason: "runtime-preparation-failed",
    };
  }
}

function queueDueThreadScheduleInTransaction(
  tx: DbTransaction,
  args: {
    logger: AppDeps["logger"];
    nextFireAt: number;
    now: number;
    preparation: QueueDueThreadSchedulePreparation;
    schedule: ThreadScheduleRow;
  },
): QueuedScheduleResult {
  if (
    !isThreadSchedulePreparationCurrent(tx, {
      preparation: args.preparation,
    })
  ) {
    throw new DueThreadScheduleLostRaceError();
  }

  const threadBecameActive = args.preparation.targetIntent.kind === "start";
  if (threadBecameActive) {
    const outcome = applyLoggedThreadLifecycleEventInTransaction(
      { db: tx, logger: args.logger },
      {
        event: { type: "run.started" },
        threadId: args.preparation.thread.id,
      },
    );
    if (!outcome.applied) {
      throw new DueThreadScheduleLostRaceError();
    }
  }

  if (
    !advanceThreadScheduleAfterFireInTransaction(tx, {
      expectedNextFireAt: args.schedule.nextFireAt,
      nextFireAt: args.nextFireAt,
      scheduleId: args.schedule.id,
      now: args.now,
    })
  ) {
    throw new DueThreadScheduleLostRaceError();
  }

  const request = appendClientTurnEventInTransaction(tx, {
    threadId: args.preparation.thread.id,
    environmentId: args.preparation.environment.id,
    type: "client/turn/requested",
    input: args.preparation.input,
    execution: args.preparation.execution,
    initiator: "system",
    senderThreadId: null,
    requestMethod: "turn/start",
    source: "tell",
    target: renderThreadScheduleTurnRequestTarget(
      args.preparation.targetIntent,
    ),
  });

  const command = addRequestIdToTurnSubmitCommandPayload({
    requestId: request.requestId,
    preparedCommand: args.preparation.preparedCommand,
  });

  return { command, threadBecameActive };
}

async function runDueThreadSchedule(
  deps: CommandResultSideEffectsDeps,
  cache: ThreadScheduleSweepCache,
  schedule: ThreadScheduleRow,
  now: number,
): Promise<void> {
  const preparation = await prepareDueThreadSchedule(deps, cache, schedule);
  if (preparation.kind === "delete") {
    deleteThreadSchedule(deps.db, deps.hub, schedule.id);
    return;
  }

  if (preparation.kind === "disable") {
    disableThreadScheduleFromSweep(deps, {
      reason: preparation.reason,
      schedule,
      validationError: null,
    });
    return;
  }

  if (preparation.kind === "skip") {
    advanceSkippedThreadSchedule(deps, {
      now,
      schedule,
      reason: preparation.reason,
    });
    return;
  }

  let nextFireAt: number;
  try {
    nextFireAt = computeNextFireAt(schedule, now);
  } catch (error) {
    if (error instanceof ScheduleValidationError) {
      disableThreadScheduleFromSweep(deps, {
        reason: "invalid-stored-schedule",
        schedule,
        validationError: error.message,
      });
      return;
    }
    throw error;
  }

  let transactionResult: QueuedScheduleResult;
  try {
    transactionResult = deps.db.transaction(
      (tx) =>
        queueDueThreadScheduleInTransaction(tx, {
          logger: deps.logger,
          schedule,
          now,
          nextFireAt,
          preparation,
        }),
      { behavior: "immediate" },
    );
  } catch (error) {
    if (error instanceof DueThreadScheduleLostRaceError) {
      return;
    }
    throw error;
  }

  cache.pendingTurnSubmitByThreadId.set(preparation.thread.id, true);
  deps.hub.notifyProject(schedule.projectId, ["thread-schedules-changed"]);
  const threadChanges: ThreadChangeKind[] = ["events-appended"];
  if (transactionResult.threadBecameActive) {
    threadChanges.push("status-changed");
  }
  deps.hub.notifyThread(preparation.thread.id, threadChanges, {
    eventTypes: ["client/turn/requested"],
  });
  startLiveHostCommand(deps, {
    command: transactionResult.command,
    hostId: preparation.environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
    onError: ({ error }) => {
      deps.logger.warn(
        {
          err: error,
          scheduleId: schedule.id,
          threadId: preparation.thread.id,
        },
        "Live due thread schedule command failed",
      );
    },
  });
}

interface SweepDueThreadSchedulesArgs {
  now?: number;
}

export async function sweepDueThreadSchedules(
  deps: CommandResultSideEffectsDeps,
  args: SweepDueThreadSchedulesArgs = {},
): Promise<void> {
  const now = args.now ?? Date.now();
  const cache = createThreadScheduleSweepCache();
  let after: DueThreadScheduleCursor | undefined;

  while (true) {
    const dueSchedules = listDueThreadSchedules(deps.db, {
      now,
      after,
      limit: DUE_THREAD_SCHEDULE_BATCH_SIZE,
    });
    for (const schedule of dueSchedules) {
      try {
        await runDueThreadSchedule(deps, cache, schedule, now);
      } catch (error) {
        deps.logger.error(
          {
            scheduleId: schedule.id,
            threadId: schedule.threadId,
            err: error,
          },
          "Failed to process a due thread schedule",
        );
      }
    }
    if (dueSchedules.length < DUE_THREAD_SCHEDULE_BATCH_SIZE) {
      return;
    }
    const lastSchedule = dueSchedules[dueSchedules.length - 1];
    after = lastSchedule ? toDueThreadScheduleCursor(lastSchedule) : undefined;
    resetThreadScheduleSweepBatchCache(cache);
  }
}
