import type { SystemAppUpdateStatus } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";
import type { ServerChangedMessage } from "../../ws/hub.js";
import type {
  AppUpdateService,
  AppUpdateServiceStatus,
  RunningThreadsPolicy,
} from "./app-update.js";

const IDLE_SETTLE_MS = 5_000;

export interface ScheduledAppUpdateService {
  acknowledgeResult(args: { id: string }): Promise<SystemAppUpdateStatus>;
  apply(args: {
    confirmInterruptingThreads: boolean;
  }): Promise<SystemAppUpdateStatus>;
  cancelScheduled(): Promise<SystemAppUpdateStatus>;
  dispose(): void;
  getStatus(args: { forceRefresh: boolean }): Promise<SystemAppUpdateStatus>;
  schedule(): Promise<SystemAppUpdateStatus>;
}

interface Schedule {
  requestedAt: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createScheduledAppUpdateService(args: {
  countRunningThreads: () => number;
  inner: AppUpdateService;
  logger: ServerLogger;
  notifyChanged: () => void;
  now?: () => Date;
  onChangedMessage: (
    listener: (message: ServerChangedMessage) => void,
  ) => () => void;
  settleMs?: number;
}): ScheduledAppUpdateService {
  const now = args.now ?? (() => new Date());
  const settleMs = args.settleMs ?? IDLE_SETTLE_MS;
  let waiting: Schedule | null = null;
  let starting: Schedule | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => undefined);
    return run;
  };

  const withSchedule = (
    status: AppUpdateServiceStatus,
  ): SystemAppUpdateStatus => {
    const pending =
      waiting ?? (status.activity.phase === "idle" ? null : starting);
    return {
      ...status,
      scheduled: pending === null ? null : { requestedAt: pending.requestedAt },
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
      starting = null;
      waiting = schedule;
      args.notifyChanged();
      checkIdle();
      return true;
    },
  });

  const start = async (schedule: Schedule): Promise<AppUpdateServiceStatus> => {
    waiting = null;
    starting = schedule;
    clearSettleTimer();
    try {
      return await args.inner.apply({
        runningThreads: attemptPolicy(schedule),
      });
    } catch (error) {
      if (starting === schedule) starting = null;
      throw error;
    }
  };

  const startWhenSettled = (): void => {
    settleTimer = null;
    void serialize(async () => {
      const schedule = waiting;
      if (schedule === null || args.countRunningThreads() > 0) return;
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

  function checkIdle(): void {
    if (waiting === null || args.countRunningThreads() > 0) {
      clearSettleTimer();
      return;
    }
    settleTimer ??= setTimeout(startWhenSettled, settleMs);
  }

  const unsubscribe = args.onChangedMessage((message) => {
    if (waiting === null || message.entity !== "thread") return;
    if (
      message.changes.some(
        (change) =>
          change === "status-changed" ||
          change === "thread-deleted" ||
          change === "archived-changed",
      )
    ) {
      checkIdle();
    }
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
      if (forget()) {
        args.logger.info("Cancelled the scheduled bb update");
        args.notifyChanged();
      }
      return withSchedule(await args.inner.getStatus({ forceRefresh: false }));
    },
    dispose() {
      unsubscribe();
      forget();
      args.inner.dispose();
    },
    async getStatus(input) {
      return withSchedule(await args.inner.getStatus(input));
    },
    schedule() {
      return serialize(async () => {
        const current = withSchedule(
          await args.inner.getStatus({ forceRefresh: false }),
        );
        if (current.scheduled !== null) return current;
        if (current.activity.phase !== "idle") {
          throw new ApiError(
            409,
            "app_update_in_progress",
            "An update is already in progress.",
          );
        }
        const schedule: Schedule = { requestedAt: now().toISOString() };
        const status = await start(schedule);
        if (waiting === schedule) {
          args.logger.info(
            { runningThreadCount: status.runningThreadCount },
            "Scheduled the bb update for when threads finish",
          );
        }
        args.notifyChanged();
        return withSchedule(status);
      });
    },
  };
}
