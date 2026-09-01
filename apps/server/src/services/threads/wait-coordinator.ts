import { getThread, type DbConnection } from "@bb/db";
import {
  isThreadWaitTargetUnreachable,
  type Thread,
  type ThreadEventRow,
  type ThreadEventType,
  type ThreadStatus,
} from "@bb/domain";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import { findThreadEvent as findPublicThreadEvent } from "./thread-data.js";

export const THREAD_WAIT_COORDINATOR_MAX_CALLERS = 1_000;
export const THREAD_WAIT_COORDINATOR_MAX_ENTRIES = 200;

const WATCHER_TIMEOUT_MS = 60_000;
const SUMMARY_INTERVAL_MS = 60_000;
const DURATION_BUCKET_MAXIMUMS_MS = [
  10,
  100,
  1_000,
  10_000,
  30_000,
  60_000,
  300_000,
  1_200_000,
  Number.POSITIVE_INFINITY,
] as const;

export type ThreadWaitCoordinatorTarget =
  | { kind: "status"; status: ThreadStatus }
  | {
      afterSeq: number;
      eventType: ThreadEventType;
      kind: "event";
    };

export type ThreadWaitCoordinatorResult =
  | { kind: "closed" }
  | { event: ThreadEventRow; kind: "event" }
  | { kind: "status"; thread: Thread; unreachable: boolean }
  | { kind: "timeout" };

export interface ThreadWaitCoordinatorStats {
  activeCallers: number;
  activeEntries: number;
  checkCount: number;
  cleanupFailureCount: number;
  deduplicatedJoinCount: number;
  deduplicationRatio: number;
  durationMs: {
    count: number;
    max: number;
    min: number;
    p50: number;
    p95: number;
  };
  entryCreateCount: number;
  joinCount: number;
  limitRejectionCount: number;
  timeoutCount: number;
  unreachableCount: number;
}

interface ThreadWaitCoordinatorOptions {
  db: DbConnection;
  hub: Pick<NotificationHub, "registerThreadEventWaiter">;
  logger: ServerLogger;
  maxCallers?: number;
  maxEntries?: number;
  now?: () => number;
  summaryIntervalMs?: number;
  watcherTimeoutMs?: number;
}

interface ThreadWaitCaller {
  abortListener: (() => void) | null;
  id: number;
  reject: (error: Error) => void;
  resolve: (result: ThreadWaitCoordinatorResult) => void;
  signal: AbortSignal | undefined;
  startedAt: number;
  timer: ReturnType<typeof setTimeout>;
}

interface ThreadWaitEntry {
  callers: Map<number, ThreadWaitCaller>;
  checkRequested: boolean;
  checkScheduled: boolean;
  checking: boolean;
  createdAt: number;
  key: string;
  target: ThreadWaitCoordinatorTarget;
  threadId: string;
  watcher: { cancel: () => void; promise: Promise<boolean> } | undefined;
}

interface DurationState {
  bucketCounts: number[];
  count: number;
  max: number;
  min: number;
}

export class ThreadWaitCoordinatorLimitError extends Error {
  constructor() {
    super("The server has reached its thread waiter limit.");
    this.name = "ThreadWaitCoordinatorLimitError";
  }
}

export class ThreadWaitCoordinator {
  private readonly db: DbConnection;
  private readonly entries = new Map<string, ThreadWaitEntry>();
  private readonly hub: Pick<NotificationHub, "registerThreadEventWaiter">;
  private readonly logger: ServerLogger;
  private readonly maxCallers: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly summaryIntervalMs: number;
  private readonly watcherTimeoutMs: number;
  private activeCallers = 0;
  private checkCount = 0;
  private cleanupFailureCount = 0;
  private closed = false;
  private deduplicatedJoinCount = 0;
  private durationState: DurationState = {
    bucketCounts: DURATION_BUCKET_MAXIMUMS_MS.map(() => 0),
    count: 0,
    max: 0,
    min: 0,
  };
  private entryCreateCount = 0;
  private joinCount = 0;
  private limitRejectionCount = 0;
  private nextCallerId = 1;
  private summaryTimer: ReturnType<typeof setInterval> | undefined;
  private timeoutCount = 0;
  private unreachableCount = 0;

  constructor(options: ThreadWaitCoordinatorOptions) {
    this.db = options.db;
    this.hub = options.hub;
    this.logger = options.logger;
    this.maxCallers = options.maxCallers ?? THREAD_WAIT_COORDINATOR_MAX_CALLERS;
    this.maxEntries = options.maxEntries ?? THREAD_WAIT_COORDINATOR_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
    this.summaryIntervalMs = options.summaryIntervalMs ?? SUMMARY_INTERVAL_MS;
    this.watcherTimeoutMs = options.watcherTimeoutMs ?? WATCHER_TIMEOUT_MS;
  }

  getStats(): ThreadWaitCoordinatorStats {
    return {
      activeCallers: this.activeCallers,
      activeEntries: this.entries.size,
      checkCount: this.checkCount,
      cleanupFailureCount: this.cleanupFailureCount,
      deduplicatedJoinCount: this.deduplicatedJoinCount,
      deduplicationRatio:
        this.entryCreateCount === 0
          ? 0
          : this.joinCount / this.entryCreateCount,
      durationMs: this.getDurationStats(),
      entryCreateCount: this.entryCreateCount,
      joinCount: this.joinCount,
      limitRejectionCount: this.limitRejectionCount,
      timeoutCount: this.timeoutCount,
      unreachableCount: this.unreachableCount,
    };
  }

  wait(args: {
    signal?: AbortSignal;
    target: ThreadWaitCoordinatorTarget;
    threadId: string;
    timeoutMs: number;
  }): Promise<ThreadWaitCoordinatorResult> {
    if (this.closed) {
      return Promise.resolve({ kind: "closed" });
    }
    if (args.signal?.aborted) {
      return Promise.reject(this.createAbortError());
    }

    const key = this.buildKey(args.threadId, args.target);
    let entry = this.entries.get(key);
    if (this.activeCallers >= this.maxCallers) {
      this.limitRejectionCount += 1;
      return Promise.reject(new ThreadWaitCoordinatorLimitError());
    }
    if (entry === undefined && this.entries.size >= this.maxEntries) {
      this.limitRejectionCount += 1;
      return Promise.reject(new ThreadWaitCoordinatorLimitError());
    }

    this.joinCount += 1;
    if (entry === undefined) {
      entry = {
        callers: new Map(),
        checkRequested: false,
        checkScheduled: false,
        checking: false,
        createdAt: this.now(),
        key,
        target: args.target,
        threadId: args.threadId,
        watcher: undefined,
      };
      this.entries.set(key, entry);
      this.entryCreateCount += 1;
      this.ensureSummaryTimer();
      this.logger.info(
        {
          activeEntries: this.entries.size,
          key,
          threadId: args.threadId,
        },
        "Thread wait coordinator entry created",
      );
    } else {
      this.deduplicatedJoinCount += 1;
    }

    const selectedEntry = entry;
    return new Promise<ThreadWaitCoordinatorResult>((resolve, reject) => {
      const callerId = this.nextCallerId;
      this.nextCallerId += 1;
      const caller: ThreadWaitCaller = {
        abortListener: null,
        id: callerId,
        reject,
        resolve,
        signal: args.signal,
        startedAt: this.now(),
        timer: setTimeout(
          () => {
            this.finishCaller(
              selectedEntry,
              caller,
              { kind: "timeout" },
              "timeout",
            );
          },
          Math.max(0, args.timeoutMs),
        ),
      };
      if (args.signal !== undefined) {
        caller.abortListener = () => {
          this.failCaller(
            selectedEntry,
            caller,
            this.createAbortError(),
            "abort",
          );
        };
        args.signal.addEventListener("abort", caller.abortListener, {
          once: true,
        });
      }
      selectedEntry.callers.set(callerId, caller);
      this.activeCallers += 1;
      this.scheduleCheck(selectedEntry);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of [...this.entries.values()]) {
      for (const caller of [...entry.callers.values()]) {
        this.finishCaller(entry, caller, { kind: "closed" }, "closed");
      }
    }
    this.stopSummaryTimer();
  }

  private armWatcher(entry: ThreadWaitEntry): void {
    if (entry.watcher !== undefined || entry.callers.size === 0) return;
    const watcher = this.hub.registerThreadEventWaiter(
      entry.threadId,
      this.watcherTimeoutMs,
    );
    entry.watcher = watcher;
    void watcher.promise.then(() => {
      if (entry.watcher !== watcher) return;
      entry.watcher = undefined;
      if (!this.entries.has(entry.key) || entry.callers.size === 0) return;
      entry.checkRequested = true;
      this.scheduleCheck(entry);
    });
  }

  private buildKey(
    threadId: string,
    target: ThreadWaitCoordinatorTarget,
  ): string {
    if (target.kind === "status") {
      return `${threadId}|status|${target.status}`;
    }
    return `${threadId}|event|${target.eventType}|${target.afterSeq}`;
  }

  private checkTarget(
    entry: ThreadWaitEntry,
  ): ThreadWaitCoordinatorResult | null {
    this.checkCount += 1;
    if (entry.target.kind === "event") {
      const event = findPublicThreadEvent(this.db, {
        afterSeq: entry.target.afterSeq,
        threadId: entry.threadId,
        type: entry.target.eventType,
      });
      return event === null ? null : { event, kind: "event" };
    }

    const thread = getThread(this.db, entry.threadId);
    if (thread === null) {
      throw new Error(`Thread ${entry.threadId} disappeared during a wait.`);
    }
    const unreachable = isThreadWaitTargetUnreachable(
      thread.status,
      entry.target.status,
    );
    if (thread.status !== entry.target.status && !unreachable) {
      return null;
    }
    return { kind: "status", thread, unreachable };
  }

  private cleanupEntry(entry: ThreadWaitEntry, reason: string): void {
    if (this.entries.get(entry.key) !== entry) return;
    this.entries.delete(entry.key);
    if (entry.watcher !== undefined) {
      try {
        entry.watcher.cancel();
      } catch (error) {
        this.cleanupFailureCount += 1;
        this.logger.warn(
          { err: error, key: entry.key, threadId: entry.threadId },
          "Thread wait coordinator cleanup failed",
        );
      }
      entry.watcher = undefined;
    }
    this.logger.info(
      {
        activeEntries: this.entries.size,
        durationMs: this.now() - entry.createdAt,
        key: entry.key,
        reason,
        threadId: entry.threadId,
      },
      "Thread wait coordinator entry removed",
    );
    if (this.entries.size === 0) {
      this.stopSummaryTimer();
    }
  }

  private createAbortError(): Error {
    return new DOMException("The thread wait was aborted.", "AbortError");
  }

  private async checkEntry(entry: ThreadWaitEntry): Promise<void> {
    if (this.entries.get(entry.key) !== entry || entry.callers.size === 0) {
      return;
    }
    if (entry.checking) {
      entry.checkRequested = true;
      return;
    }
    entry.checking = true;
    entry.checkRequested = false;
    this.armWatcher(entry);
    try {
      const result = this.checkTarget(entry);
      if (result !== null) {
        if (result.kind === "status" && result.unreachable) {
          this.unreachableCount += entry.callers.size;
        }
        for (const caller of [...entry.callers.values()]) {
          this.finishCaller(entry, caller, result, result.kind);
        }
        return;
      }
    } catch (error) {
      const resolvedError =
        error instanceof Error ? error : new Error(String(error));
      for (const caller of [...entry.callers.values()]) {
        this.failCaller(entry, caller, resolvedError, "error");
      }
      return;
    } finally {
      entry.checking = false;
    }

    if (entry.checkRequested) {
      entry.checkRequested = false;
      this.scheduleCheck(entry);
    }
  }

  private ensureSummaryTimer(): void {
    if (this.summaryTimer !== undefined) return;
    this.summaryTimer = setInterval(() => {
      if (this.entries.size === 0) return;
      this.logger.info(this.getStats(), "Thread wait coordinator summary");
    }, this.summaryIntervalMs);
    this.summaryTimer.unref();
  }

  private failCaller(
    entry: ThreadWaitEntry,
    caller: ThreadWaitCaller,
    error: Error,
    reason: string,
  ): void {
    if (!entry.callers.delete(caller.id)) return;
    this.releaseCaller(caller);
    caller.reject(error);
    if (entry.callers.size === 0) {
      this.cleanupEntry(entry, reason);
    }
  }

  private finishCaller(
    entry: ThreadWaitEntry,
    caller: ThreadWaitCaller,
    result: ThreadWaitCoordinatorResult,
    reason: string,
  ): void {
    if (!entry.callers.delete(caller.id)) return;
    this.releaseCaller(caller);
    if (result.kind === "timeout") {
      this.timeoutCount += 1;
    }
    caller.resolve(result);
    if (entry.callers.size === 0) {
      this.cleanupEntry(entry, reason);
    }
  }

  private getDurationStats(): ThreadWaitCoordinatorStats["durationMs"] {
    if (this.durationState.count === 0) {
      return { count: 0, max: 0, min: 0, p50: 0, p95: 0 };
    }
    return {
      count: this.durationState.count,
      max: this.durationState.max,
      min: this.durationState.min,
      p50: this.getDurationPercentile(0.5),
      p95: this.getDurationPercentile(0.95),
    };
  }

  private getDurationPercentile(percentile: number): number {
    const targetCount = Math.ceil(this.durationState.count * percentile);
    let observedCount = 0;
    for (const [index, count] of this.durationState.bucketCounts.entries()) {
      observedCount += count;
      if (observedCount >= targetCount) {
        const maximum = DURATION_BUCKET_MAXIMUMS_MS[index];
        if (maximum === undefined || !Number.isFinite(maximum)) {
          return this.durationState.max;
        }
        return maximum;
      }
    }
    return this.durationState.max;
  }

  private recordDuration(durationMs: number): void {
    const duration = Math.max(0, durationMs);
    this.durationState.count += 1;
    this.durationState.max = Math.max(this.durationState.max, duration);
    this.durationState.min =
      this.durationState.count === 1
        ? duration
        : Math.min(this.durationState.min, duration);
    const bucketIndex = DURATION_BUCKET_MAXIMUMS_MS.findIndex(
      (maximum) => duration <= maximum,
    );
    const currentBucketCount = this.durationState.bucketCounts[bucketIndex];
    if (currentBucketCount === undefined) {
      throw new Error("Thread wait duration did not match a histogram bucket.");
    }
    this.durationState.bucketCounts[bucketIndex] = currentBucketCount + 1;
  }

  private releaseCaller(caller: ThreadWaitCaller): void {
    clearTimeout(caller.timer);
    if (caller.signal !== undefined && caller.abortListener !== null) {
      caller.signal.removeEventListener("abort", caller.abortListener);
    }
    this.activeCallers -= 1;
    this.recordDuration(this.now() - caller.startedAt);
  }

  private scheduleCheck(entry: ThreadWaitEntry): void {
    if (entry.checking) {
      entry.checkRequested = true;
      return;
    }
    if (entry.checkScheduled) return;
    entry.checkScheduled = true;
    queueMicrotask(() => {
      entry.checkScheduled = false;
      void this.checkEntry(entry);
    });
  }

  private stopSummaryTimer(): void {
    if (this.summaryTimer === undefined) return;
    clearInterval(this.summaryTimer);
    this.summaryTimer = undefined;
  }
}

export function createThreadWaitCoordinator(
  options: ThreadWaitCoordinatorOptions,
): ThreadWaitCoordinator {
  return new ThreadWaitCoordinator(options);
}
