import type {
  SystemAppUpdateAvailable,
  SystemAppUpdateRevision,
  SystemAppUpdateStatus,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";
import type { ServerChangedMessage } from "../../ws/hub.js";
import type {
  AppUpdateService,
  AppUpdateServiceStatus,
  RunningThreadsPolicy,
} from "./app-update.js";

const IDLE_SETTLE_MS = 5_000;

export const AUTO_UPDATE_IDLE_MS = 15 * 60_000;

export interface AutoUpdateCheckMs {
  first: number;
  interval: number;
}

export const AUTO_UPDATE_CHECK_MS: AutoUpdateCheckMs = {
  first: 30_000,
  interval: 60 * 60_000,
};

export interface SkippedAppUpdateStore {
  get(): string | null;
  set(key: string): void;
}

export interface AutoAppUpdateStore {
  get(): boolean;
  set(enabled: boolean): void;
}

export interface ScheduledAppUpdateService {
  acknowledgeResult(args: { id: string }): Promise<SystemAppUpdateStatus>;
  apply(args: {
    confirmInterruptingThreads: boolean;
  }): Promise<SystemAppUpdateStatus>;
  cancelScheduled(): Promise<SystemAppUpdateStatus>;
  dispose(): void;
  getStatus(args: { forceRefresh: boolean }): Promise<SystemAppUpdateStatus>;
  schedule(): Promise<SystemAppUpdateStatus>;
  setAutoUpdate(enabled: boolean): Promise<SystemAppUpdateStatus>;
}

type ScheduleOrigin = "automatic" | "requested";

interface Schedule {
  origin: ScheduleOrigin;
  requestedAt: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function availableUpdateKey(available: SystemAppUpdateAvailable): string {
  return available.commit ?? available.version;
}

function revisionKey(revision: SystemAppUpdateRevision): string {
  return revision.commit ?? revision.version;
}

function automaticUpdateSkipReason(
  status: SystemAppUpdateStatus,
  skippedKey: string | null,
): string | null {
  if (status.available === null) return "up to date";
  if (status.blocked !== null) return status.blocked.message;
  if (status.scheduled !== null || status.activity.phase !== "idle") {
    return "an update is already under way";
  }
  const key = availableUpdateKey(status.available);
  if (key === skippedKey) return "the update was cancelled";
  if (
    status.lastResult !== null &&
    status.lastResult.outcome === "failed" &&
    revisionKey(status.lastResult.to) === key
  ) {
    return "the last attempt at this update failed";
  }
  return null;
}

export function createScheduledAppUpdateService(args: {
  autoCheckMs: AutoUpdateCheckMs | null;
  autoIdleMs?: number;
  autoUpdate: AutoAppUpdateStore;
  countRunningThreads: () => number;
  inner: AppUpdateService;
  isEnabled: () => boolean;
  logger: ServerLogger;
  notifyChanged: () => void;
  now?: () => Date;
  onChangedMessage: (
    listener: (message: ServerChangedMessage) => void,
  ) => () => void;
  settleMs?: number;
  skippedUpdate: SkippedAppUpdateStore;
}): ScheduledAppUpdateService {
  const now = args.now ?? (() => new Date());
  const settleMs = args.settleMs ?? IDLE_SETTLE_MS;
  const autoIdleMs = args.autoIdleMs ?? AUTO_UPDATE_IDLE_MS;
  let waiting: Schedule | null = null;
  let starting: Schedule | null = null;
  let startInFlight = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let notifiedRunningThreadCount: number | null = null;
  let enabled = args.isEnabled();
  let threadChangePending = false;
  let queue: Promise<unknown> = Promise.resolve();
  let idleSince: number | null = Date.now();

  const requiredIdleMs = (schedule: Schedule): number =>
    schedule.origin === "automatic" ? autoIdleMs : settleMs;

  const remainingIdleMs = (schedule: Schedule): number =>
    idleSince === null
      ? requiredIdleMs(schedule)
      : Math.max(0, idleSince + requiredIdleMs(schedule) - Date.now());

  const observeRunningThreads = (runningThreadCount: number): void => {
    if (runningThreadCount > 0) idleSince = null;
    else idleSince ??= Date.now();
  };

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run;
  };

  const withSchedule = (
    status: AppUpdateServiceStatus,
  ): SystemAppUpdateStatus => {
    const pending =
      waiting ??
      (startInFlight || status.activity.phase !== "idle" ? starting : null);
    return {
      ...status,
      autoUpdate: args.autoUpdate.get(),
      availableSkipped:
        status.available !== null &&
        availableUpdateKey(status.available) === args.skippedUpdate.get(),
      scheduled:
        pending === null
          ? null
          : {
              requestedAt: pending.requestedAt,
              requiredIdleMs: requiredIdleMs(pending),
            },
    };
  };

  const clearSettleTimer = (): void => {
    if (settleTimer === null) return;
    clearTimeout(settleTimer);
    settleTimer = null;
  };

  const forget = (): boolean => {
    const had = waiting !== null || starting !== null;
    waiting = null;
    starting = null;
    clearSettleTimer();
    return had;
  };

  const attemptPolicy = (schedule: Schedule): RunningThreadsPolicy => ({
    kind: "wait",
    shouldDefer: (runningThreadCount) => {
      if (starting !== schedule) return true;
      if (runningThreadCount === 0) return false;
      if (!startInFlight) {
        args.logger.info(
          { runningThreadCount },
          "Deferred the scheduled bb update until threads finish again",
        );
      }
      starting = null;
      waiting = schedule;
      args.notifyChanged();
      checkIdle(args.countRunningThreads());
      return true;
    },
  });

  const start = async (schedule: Schedule): Promise<AppUpdateServiceStatus> => {
    waiting = null;
    starting = schedule;
    startInFlight = true;
    clearSettleTimer();
    try {
      return await args.inner.apply({
        runningThreads: attemptPolicy(schedule),
      });
    } catch (error) {
      if (starting === schedule) starting = null;
      throw error;
    } finally {
      startInFlight = false;
    }
  };

  const startWhenSettled = (): void => {
    settleTimer = null;
    void serialize(async () => {
      const schedule = waiting;
      if (schedule === null) return;
      const runningThreadCount = args.countRunningThreads();
      observeRunningThreads(runningThreadCount);
      if (runningThreadCount > 0) return;
      if (!enabled) {
        dropWhenDisabled();
        return;
      }
      if (remainingIdleMs(schedule) > 0) {
        checkIdle(0);
        return;
      }
      try {
        await start(schedule);
        if (starting === schedule) {
          args.logger.info(
            { requestedAt: schedule.requestedAt },
            "Starting the bb update scheduled for when threads finish",
          );
        }
      } catch (error) {
        args.logger.warn(
          { error: errorMessage(error) },
          "Could not start the scheduled bb update",
        );
      }
      args.notifyChanged();
    });
  };

  function checkIdle(runningThreadCount: number): void {
    observeRunningThreads(runningThreadCount);
    if (waiting === null || runningThreadCount > 0) {
      clearSettleTimer();
      return;
    }
    settleTimer ??= setTimeout(startWhenSettled, remainingIdleMs(waiting));
  }

  function dropWhenDisabled(): void {
    if (!forget()) return;
    args.logger.info(
      "Dropped the scheduled bb update because the updateWhenIdle experiment is off",
    );
    args.notifyChanged();
  }

  const handleThreadChanges = (): void => {
    threadChangePending = false;
    if (!enabled) return;
    const runningThreadCount = args.countRunningThreads();
    if (runningThreadCount !== notifiedRunningThreadCount) {
      notifiedRunningThreadCount = runningThreadCount;
      args.notifyChanged();
    }
    checkIdle(runningThreadCount);
  };

  const scheduleNow = async (
    origin: ScheduleOrigin,
  ): Promise<SystemAppUpdateStatus> => {
    const current = withSchedule(
      await args.inner.getStatus({ forceRefresh: false }),
    );
    if (origin === "requested" && waiting?.origin === "automatic") {
      waiting = { ...waiting, origin };
      clearSettleTimer();
      checkIdle(args.countRunningThreads());
      args.notifyChanged();
      return withSchedule(await args.inner.getStatus({ forceRefresh: false }));
    }
    if (current.scheduled !== null) return current;
    if (current.activity.phase !== "idle") {
      throw new ApiError(
        409,
        "app_update_in_progress",
        "An update is already in progress.",
      );
    }
    const schedule: Schedule = { origin, requestedAt: now().toISOString() };
    if (origin === "automatic") {
      const runningThreadCount = args.countRunningThreads();
      observeRunningThreads(runningThreadCount);
      if (remainingIdleMs(schedule) > 0) {
        waiting = schedule;
        checkIdle(runningThreadCount);
        args.logger.info(
          { requiredIdleMs: autoIdleMs },
          "Scheduled the automatic bb update for when bb has been idle long enough",
        );
        args.notifyChanged();
        return withSchedule(current);
      }
    }
    const status = await start(schedule);
    if (waiting === schedule) {
      args.logger.info(
        { runningThreadCount: status.runningThreadCount },
        "Scheduled the bb update for when threads finish",
      );
    }
    args.notifyChanged();
    return withSchedule(status);
  };

  const checkForUpdate = (): Promise<void> =>
    serialize(async () => {
      if (
        !enabled ||
        !args.autoUpdate.get() ||
        waiting !== null ||
        starting !== null
      ) {
        return;
      }
      const status = withSchedule(
        await args.inner.getStatus({ forceRefresh: true }),
      );
      const skipReason = automaticUpdateSkipReason(
        status,
        args.skippedUpdate.get(),
      );
      if (skipReason !== null) {
        args.logger.debug(
          { reason: skipReason },
          "Not starting an automatic bb update",
        );
        return;
      }
      args.logger.info(
        { targetVersion: status.available?.version ?? null },
        "Found a bb update; updating once bb has been idle long enough",
      );
      await scheduleNow("automatic");
    });

  const runAutomaticCheck = (): void => {
    void checkForUpdate().catch((error: unknown) => {
      args.logger.warn(
        { error: errorMessage(error) },
        "Could not start an automatic bb update",
      );
    });
  };
  const autoCheckTimers =
    args.autoCheckMs === null
      ? null
      : {
          first: setTimeout(runAutomaticCheck, args.autoCheckMs.first),
          interval: setInterval(runAutomaticCheck, args.autoCheckMs.interval),
        };
  autoCheckTimers?.first.unref();
  autoCheckTimers?.interval.unref();

  const unsubscribe = args.onChangedMessage((message) => {
    if (message.entity === "system") {
      if (message.changes.includes("config-changed")) {
        const wasEnabled = enabled;
        enabled = args.isEnabled();
        if (!enabled) dropWhenDisabled();
        else if (!wasEnabled) idleSince = Date.now();
      }
      return;
    }
    if (
      !enabled ||
      threadChangePending ||
      message.entity !== "thread" ||
      !message.changes.some(
        (change) =>
          change === "status-changed" ||
          change === "thread-deleted" ||
          change === "archived-changed",
      )
    ) {
      return;
    }
    threadChangePending = true;
    queueMicrotask(handleThreadChanges);
  });

  return {
    async acknowledgeResult(input) {
      return withSchedule(await args.inner.acknowledgeResult(input));
    },
    apply({ confirmInterruptingThreads }) {
      return serialize(async () => {
        const status = await args.inner.apply({
          runningThreads: confirmInterruptingThreads
            ? { kind: "interrupt" }
            : { kind: "refuse" },
        });
        if (forget()) args.notifyChanged();
        return withSchedule(status);
      });
    },
    async cancelScheduled() {
      const cancelled = forget();
      const status = withSchedule(
        await args.inner.getStatus({ forceRefresh: false }),
      );
      if (cancelled) {
        if (status.available !== null) {
          args.skippedUpdate.set(availableUpdateKey(status.available));
        }
        args.logger.info(
          { skippedVersion: status.available?.version ?? null },
          "Cancelled the scheduled bb update",
        );
        args.notifyChanged();
      }
      return status;
    },
    dispose() {
      if (autoCheckTimers !== null) {
        clearTimeout(autoCheckTimers.first);
        clearInterval(autoCheckTimers.interval);
      }
      unsubscribe();
      forget();
      args.inner.dispose();
    },
    async getStatus(input) {
      return withSchedule(await args.inner.getStatus(input));
    },
    schedule() {
      return serialize(() => scheduleNow("requested"));
    },
    async setAutoUpdate(autoUpdate) {
      args.autoUpdate.set(autoUpdate);
      args.logger.info(
        { autoUpdate },
        autoUpdate
          ? "Turned on automatic bb updates"
          : "Turned off automatic bb updates",
      );
      if (!autoUpdate && waiting !== null) {
        waiting = null;
        clearSettleTimer();
        args.logger.info(
          "Dropped the waiting bb update because automatic updates are off",
        );
      }
      args.notifyChanged();
      if (autoUpdate) runAutomaticCheck();
      return withSchedule(await args.inner.getStatus({ forceRefresh: false }));
    },
  };
}
