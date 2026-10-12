import { SQLITE_IDLE, SQLITE_STOPPING } from "./sqlite-execution-state.js";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { threadSearchResponseSchema } from "@bb/server-contract";
import type {
  SearchThreadsWithPendingInteractionStateArgs,
  TruncateCompletedEventItemOutputsArgs,
} from "@bb/db";
import type { AppDeps, ServerLogger } from "../../types.js";
import { ApiError } from "../../errors.js";
import { resolveProviderPlanCommand } from "../providers/provider-plan-command.js";
import { getEventLoopHealth } from "../system/event-loop-stall-monitor.js";
import {
  readWorkerMessageSchema,
  outlineReadResultSchema,
  maintenanceResultSchema,
  type ReadRequest,
  type DatabaseTask,
  type ReadWorkerMessage,
} from "./read-worker-contract.js";

export interface ReadServiceOptions {
  databasePath: string;
  mode?: "read" | "maintenance";
  logger: Pick<ServerLogger, "info">;
  executionTimeoutMs?: number;
  queueTimeoutMs?: number;
  maxQueue?: number;
  startupTimeoutMs?: number;
  /** Alternate entries execute real SQLite fixtures in lifecycle tests. */
  workerEntry?: URL;
  extensionPath?: string;
}

export interface DatabaseReadDelivery {
  json: string;
  requestId: number;
  workerGeneration: number;
  enqueuedAt: number;
  metrics: Extract<ReadWorkerMessage, { kind: "result" }>["metrics"];
}

interface PendingRead {
  id: number;
  task: DatabaseTask;
  enqueuedAt: number;
  dispatchedAt: number | null;
  resolve: (delivery: DatabaseReadDelivery) => void;
  reject: (error: ApiError) => void;
  timer: ReturnType<typeof setTimeout>;
  removeAbortListener: () => void;
}
interface Reader {
  worker: Worker;
  executionState: Int32Array;
  retirementTimer: ReturnType<typeof setTimeout> | null;
  generation: number;
  ready: boolean;
  retiring: boolean;
  startupTimer: ReturnType<typeof setTimeout>;
  exit: Promise<number>;
}
type ReadOutcome =
  | "ok"
  | "timeout"
  | "queue_timeout"
  | "canceled"
  | "busy"
  | "not_found"
  | "failed"
  | "queue_full"
  | "closed";

/** A single dedicated reader with a bounded FIFO. No connection crosses threads. */
export class DatabaseReadService {
  private reader: Reader | null = null;
  private active: PendingRead | null = null;
  private queue: PendingRead[] = [];
  private sequence = 0;
  private generation = 0;
  private closed = false;
  private closing: Promise<void> | null = null;
  private readonly executionTimeoutMs: number;
  private readonly queueTimeoutMs: number;
  private readonly maxQueue: number;
  private readonly startupTimeoutMs: number;

  constructor(private readonly options: ReadServiceOptions) {
    this.executionTimeoutMs = options.executionTimeoutMs ?? 3000;
    this.queueTimeoutMs = options.queueTimeoutMs ?? 10_000;
    this.maxQueue = options.maxQueue ?? 8;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
    if (
      !Number.isInteger(this.executionTimeoutMs) ||
      !Number.isInteger(this.queueTimeoutMs) ||
      !Number.isInteger(this.startupTimeoutMs) ||
      this.executionTimeoutMs <= 0 ||
      this.executionTimeoutMs > 30_000 ||
      this.queueTimeoutMs <= 0 ||
      this.maxQueue < 0 ||
      !Number.isInteger(this.maxQueue) ||
      this.startupTimeoutMs <= 0
    ) {
      throw new Error("Invalid database reader limits.");
    }
  }

  async search(
    deps: Pick<AppDeps, "hub" | "providerRegistry">,
    args: SearchThreadsWithPendingInteractionStateArgs,
    signal: AbortSignal,
  ) {
    const delivery = await this.run(
      {
        kind: "search",
        ...args,
        daemonSessions: deps.hub.snapshotDaemonSessionIdsByHost(),
        planCommands: deps.providerRegistry
          .list()
          .map((provider) => [
            provider.info.id,
            resolveProviderPlanCommand(deps.providerRegistry, provider.info.id),
          ]),
      },
      signal,
    );
    const started = performance.now();
    const response = this.decode(delivery, threadSearchResponseSchema);
    return {
      response,
      requestId: delivery.requestId,
      mainResultProcessingMs: performance.now() - started,
    };
  }

  async outline(
    threadId: string,
    providerDisplayName: string | null,
    signal: AbortSignal,
  ) {
    const delivery = await this.run(
      { kind: "outline", threadId, providerDisplayName },
      signal,
    );
    const started = performance.now();
    const result = this.decode(delivery, outlineReadResultSchema);
    return {
      ...result,
      requestId: delivery.requestId,
      mainResultProcessingMs: performance.now() - started,
    };
  }

  async truncateOutputs(args: TruncateCompletedEventItemOutputsArgs) {
    return this.decode(
      await this.run(
        { kind: "truncate_outputs", ...args },
        new AbortController().signal,
      ),
      maintenanceResultSchema,
    );
  }

  private decode<T>(
    delivery: DatabaseReadDelivery,
    schema: { parse(value: unknown): T },
  ): T {
    try {
      return schema.parse(JSON.parse(delivery.json));
    } catch {
      this.options.logger.info(
        {
          requestId: delivery.requestId,
          workerGeneration: delivery.workerGeneration,
          outcome: "failed",
          stage: "result_validation",
        },
        "Database reader request",
      );
      throw this.error("failed");
    }
  }

  /** Typed worker transport. Only the two read operations are accepted. */
  run(task: DatabaseTask, signal: AbortSignal): Promise<DatabaseReadDelivery> {
    if (this.closed) return Promise.reject(this.error("closed"));
    if (signal.aborted) return Promise.reject(this.error("canceled"));
    // Reserve one slot for the request that will execute after startup/retirement.
    const waiting = this.queue.length + (this.active === null ? 0 : 1);
    if (waiting >= this.maxQueue + 1) {
      this.options.logger.info(
        {
          operation: task.kind,
          outcome: "queue_full",
          queueDepth: this.queue.length,
        },
        "Database reader request",
      );
      return Promise.reject(this.error("queue_full"));
    }
    return new Promise((resolve, reject) => {
      const pending: PendingRead = {
        id: ++this.sequence,
        task,
        enqueuedAt: performance.now(),
        dispatchedAt: null,
        resolve,
        reject,
        timer: setTimeout(
          () => this.cancel(pending, "queue_timeout"),
          this.queueTimeoutMs,
        ),
        removeAbortListener: () => signal.removeEventListener("abort", abort),
      };
      const abort = () => this.cancel(pending, "canceled");
      signal.addEventListener("abort", abort, { once: true });
      this.queue.push(pending);
      this.pump();
    });
  }

  private error(outcome: Exclude<ReadOutcome, "ok">): ApiError {
    const statuses = {
      timeout: 504,
      queue_timeout: 503,
      canceled: 408,
      busy: 503,
      not_found: 404,
      failed: 503,
      queue_full: 503,
      closed: 503,
    } as const;
    return new ApiError(
      statuses[outcome],
      `database_read_${outcome}`,
      outcome === "not_found"
        ? "Thread not found"
        : "The server could not complete this request. Try again.",
      { retryable: outcome !== "canceled" && outcome !== "not_found" },
    );
  }

  private observe(
    pending: PendingRead,
    outcome: ReadOutcome,
    message?: Extract<ReadWorkerMessage, { kind: "result" }>,
  ): void {
    const now = performance.now();
    this.options.logger.info(
      {
        operation: pending.task.kind,
        requestId: pending.id,
        workerGeneration: this.reader?.generation ?? this.generation,
        outcome,
        queueDepth: this.queue.length,
        queueWaitMs: (pending.dispatchedAt ?? now) - pending.enqueuedAt,
        totalMs: now - pending.enqueuedAt,
        executionElapsedMs:
          pending.dispatchedAt === null ? null : now - pending.dispatchedAt,
        sqlMs: message?.metrics.sqlMs ?? null,
        processingMs: message?.metrics.processingMs ?? null,
        serializationMs: message?.metrics.serializationMs ?? null,
        ...(message
          ? {
              ...message.metrics,
              deliveryMs: Math.max(
                0,
                now -
                  (pending.dispatchedAt ?? now) -
                  message.metrics.workerTotalMs,
              ),
            }
          : {}),
        ...getEventLoopHealth(),
      },
      "Database reader request",
    );
  }

  private settle(
    pending: PendingRead,
    outcome: ReadOutcome,
    message?: Extract<ReadWorkerMessage, { kind: "result" }>,
  ): void {
    clearTimeout(pending.timer);
    pending.removeAbortListener();
    this.observe(pending, outcome, message);
    if (message)
      pending.resolve({
        json: message.json,
        requestId: pending.id,
        workerGeneration: this.reader?.generation ?? this.generation,
        enqueuedAt: pending.enqueuedAt,
        metrics: message.metrics,
      });
    else pending.reject(this.error(outcome === "ok" ? "failed" : outcome));
  }

  private cancel(
    pending: PendingRead,
    outcome: "canceled" | "timeout" | "queue_timeout",
  ): void {
    if (this.active === pending) {
      this.active = null;
      this.settle(pending, outcome);
      this.retire();
      return;
    }
    const index = this.queue.indexOf(pending);
    if (index === -1) return;
    this.queue.splice(index, 1);
    this.settle(pending, outcome);
  }

  private failAll(outcome: "failed" | "closed"): void {
    const pending = [
      ...(this.active === null ? [] : [this.active]),
      ...this.queue,
    ];
    this.active = null;
    this.queue = [];
    for (const request of pending) this.settle(request, outcome);
  }

  private retire(): void {
    const reader = this.reader;
    if (reader === null || reader.retiring) return;
    reader.retiring = true;
    clearTimeout(reader.startupTimer);
    const started = performance.now();
    const terminateWhenIdle = () => {
      if (this.reader !== reader) return;
      if (
        Atomics.compareExchange(
          reader.executionState,
          0,
          SQLITE_IDLE,
          SQLITE_STOPPING,
        ) === SQLITE_IDLE
      ) {
        void reader.worker.terminate().then(() => {
          this.options.logger.info(
            {
              workerGeneration: reader.generation,
              terminationMs: performance.now() - started,
            },
            "Database reader connection released",
          );
        });
      } else {
        // The independent native watchdog interrupts a running SQLite call.
        // Do not terminate V8 until the addon completes its error handling.
        reader.retirementTimer = setTimeout(terminateWhenIdle, 5);
      }
    };
    terminateWhenIdle();
  }

  private pump(): void {
    if (this.closed || this.active !== null || this.queue.length === 0) return;
    if (this.reader === null) {
      this.startReader();
      return;
    }
    if (!this.reader.ready || this.reader.retiring) return;
    const pending = this.queue.shift();
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.dispatchedAt = performance.now();
    pending.timer = setTimeout(
      () => this.cancel(pending, "timeout"),
      this.executionTimeoutMs,
    );
    this.active = pending;
    this.reader.worker.ref();
    this.reader.worker.postMessage({
      id: pending.id,
      budgetMs: this.executionTimeoutMs,
      task: pending.task,
    } satisfies ReadRequest);
  }

  private startReader(): void {
    try {
      const bundledEntry = new URL(
        "./database-read-worker.js",
        import.meta.url,
      );
      const entry =
        this.options.workerEntry ??
        (existsSync(bundledEntry)
          ? bundledEntry
          : new URL("./database-read-worker.mjs", import.meta.url));
      const bundledExtension = new URL(
        "./database-native/sqlite-query-deadline.so",
        import.meta.url,
      );
      const extensionPath =
        this.options.extensionPath ??
        fileURLToPath(
          existsSync(bundledExtension)
            ? bundledExtension
            : new URL(
                "../../../../../packages/db/dist/sqlite-query-deadline.so",
                import.meta.url,
              ),
        );
      const executionBuffer = new SharedArrayBuffer(
        Int32Array.BYTES_PER_ELEMENT,
      );
      const worker = new Worker(entry, {
        execArgv: ["--conditions=source"],
        workerData: {
          databasePath: this.options.databasePath,
          extensionPath,
          mode: this.options.mode ?? "read",
          executionState: executionBuffer,
        },
      });
      const reader: Reader = {
        worker,
        executionState: new Int32Array(executionBuffer),
        retirementTimer: null,
        generation: ++this.generation,
        ready: false,
        retiring: false,
        startupTimer: setTimeout(() => {
          this.failAll("failed");
          this.retire();
        }, this.startupTimeoutMs),
        exit: new Promise((resolve) => worker.once("exit", resolve)),
      };
      this.reader = reader;
      worker.on("message", (value: unknown) => {
        if (this.reader !== reader || reader.retiring) return;
        const parsed = readWorkerMessageSchema.safeParse(value);
        if (!parsed.success) {
          this.failAll("failed");
          this.retire();
          return;
        }
        const message = parsed.data;
        if (message.kind === "ready") {
          clearTimeout(reader.startupTimer);
          reader.ready = true;
          worker.unref();
          this.pump();
          return;
        }
        const pending = this.active;
        if (pending === null || message.id !== pending.id) return;
        this.active = null;
        this.settle(
          pending,
          message.kind === "result" ? "ok" : message.code,
          message.kind === "result" ? message : undefined,
        );
        if (message.kind === "failure") this.retire();
        else {
          worker.unref();
          this.pump();
        }
      });
      worker.on("error", () => {
        if (this.reader === reader && !reader.retiring) {
          this.failAll("failed");
          this.retire();
        }
      });
      worker.on("messageerror", () => {
        if (this.reader === reader) {
          this.failAll("failed");
          this.retire();
        }
      });
      worker.once("exit", () => {
        clearTimeout(reader.startupTimer);
        if (reader.retirementTimer !== null)
          clearTimeout(reader.retirementTimer);
        if (this.reader !== reader) return;
        if (!reader.retiring) this.failAll("failed");
        this.reader = null;
        this.pump();
      });
    } catch {
      this.reader = null;
      this.failAll("failed");
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.failAll("closed");
    const reader = this.reader;
    this.retire();
    this.closing =
      reader === null ? Promise.resolve() : reader.exit.then(() => {});
    return this.closing;
  }
}
