import { inspect } from "node:util";
import { Worker } from "node:worker_threads";
import type { DbConnection } from "@bb/db";
import { ApiError } from "../../../errors.js";
import type {
  ThreadReadWorkerData,
  ThreadReadWorkerReply,
  ThreadReadWorkerRunMessage,
} from "./thread-read-protocol.js";
import {
  runThreadRead,
  type ThreadReadRequest,
  type ThreadReadResult,
  type ThreadReadResultFor,
} from "./thread-read.js";

const WORKER_RESTART_DELAY_MS = 10_000;
export const THREAD_READ_WORKER_PAGE_CACHE_KIB = 8_192;

export interface ThreadReadPoolLogger {
  warn(fields: Record<string, unknown>, message: string): void;
}

export interface ThreadReadPool {
  run<TRequest extends ThreadReadRequest>(
    request: TRequest,
  ): Promise<ThreadReadResultFor<TRequest>>;
  close(): Promise<void>;
}

interface PendingRead {
  request: ThreadReadRequest;
  resolve: (result: ThreadReadResult) => void;
  reject: (error: unknown) => void;
}

interface PoolSlot {
  index: number;
  worker: Worker | null;
  pending: Map<number, PendingRead>;
  restartTimer: ReturnType<typeof setTimeout> | null;
}

export interface CreateThreadReadPoolOptions {
  databasePath: string;
  fallbackDb: DbConnection;
  logger: ThreadReadPoolLogger;
  pageCacheKib: number;
  size: number;
  workerUrl: URL;
}

function threadSlotIndex(threadId: string, size: number): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < threadId.length; index += 1) {
    hash = Math.imul(hash ^ threadId.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0) % size;
}

function workerFailure(
  reply: Extract<ThreadReadWorkerReply, { type: "failed" }>,
): Error {
  if (reply.apiError !== null) {
    return new ApiError(
      reply.apiError.status as ConstructorParameters<typeof ApiError>[0],
      reply.apiError.code,
      reply.apiError.message,
      { details: reply.apiError.details, retryable: reply.apiError.retryable },
    );
  }
  const error = new Error(reply.message);
  if (reply.stack !== undefined) error.stack = reply.stack;
  return error;
}

export function createInProcessThreadReadPool(
  db: DbConnection,
): ThreadReadPool {
  return {
    run<TRequest extends ThreadReadRequest>(
      request: TRequest,
    ): Promise<ThreadReadResultFor<TRequest>> {
      return new Promise<ThreadReadResult>((resolve) => {
        resolve(runThreadRead(db, request));
      }) as Promise<ThreadReadResultFor<TRequest>>;
    },
    async close(): Promise<void> {},
  };
}

export function threadReadPoolSize(availableCores: number): number {
  return Math.max(1, Math.min(4, Math.floor(availableCores / 2)));
}

export function createThreadReadPool(
  options: CreateThreadReadPoolOptions,
): ThreadReadPool {
  if (options.size < 1) {
    return createInProcessThreadReadPool(options.fallbackDb);
  }
  let nextId = 1;
  let closed = false;
  const slots: PoolSlot[] = Array.from(
    { length: options.size },
    (_, index) => ({
      index,
      worker: null,
      pending: new Map(),
      restartTimer: null,
    }),
  );

  function runOnMain(pending: PendingRead): void {
    try {
      pending.resolve(runThreadRead(options.fallbackDb, pending.request));
    } catch (error) {
      pending.reject(error);
    }
  }

  function retire(slot: PoolSlot, worker: Worker, reason: string): void {
    if (slot.worker !== worker) return;
    slot.worker = null;
    const orphaned = [...slot.pending.values()];
    slot.pending.clear();
    if (!closed) {
      options.logger.warn(
        { slot: slot.index, reason, rerunOnMain: orphaned.length },
        "Thread read worker stopped; running its reads on the main thread",
      );
      slot.restartTimer = setTimeout(() => {
        slot.restartTimer = null;
        start(slot);
      }, WORKER_RESTART_DELAY_MS);
      slot.restartTimer.unref();
    }
    for (const pending of orphaned) {
      if (closed) pending.reject(new Error("Thread read pool closed"));
      else runOnMain(pending);
    }
  }

  function start(slot: PoolSlot): void {
    if (closed) return;
    const workerData: ThreadReadWorkerData = {
      databasePath: options.databasePath,
      pageCacheKib: options.pageCacheKib,
    };
    const worker = new Worker(options.workerUrl, { workerData });
    slot.worker = worker;
    worker.on("message", (reply: ThreadReadWorkerReply) => {
      if (reply.type === "ready") return;
      const pending = slot.pending.get(reply.id);
      if (pending === undefined) return;
      slot.pending.delete(reply.id);
      if (reply.type === "result") pending.resolve(reply.result);
      else pending.reject(workerFailure(reply));
    });
    worker.on("error", (error: unknown) =>
      retire(
        slot,
        worker,
        error instanceof Error
          ? (error.stack ?? error.message)
          : inspect(error),
      ),
    );
    worker.on("exit", (code) => retire(slot, worker, `exit ${code}`));
  }

  for (const slot of slots) start(slot);

  return {
    run<TRequest extends ThreadReadRequest>(
      request: TRequest,
    ): Promise<ThreadReadResultFor<TRequest>> {
      return new Promise<ThreadReadResult>((resolve, reject) => {
        const pending: PendingRead = { request, resolve, reject };
        const slot = slots[threadSlotIndex(request.threadId, slots.length)]!;
        if (closed || slot.worker === null) {
          runOnMain(pending);
          return;
        }
        const id = nextId;
        nextId += 1;
        slot.pending.set(id, pending);
        const message: ThreadReadWorkerRunMessage = {
          type: "run",
          id,
          request,
        };
        slot.worker.postMessage(message);
      }) as Promise<ThreadReadResultFor<TRequest>>;
    },
    async close(): Promise<void> {
      closed = true;
      await Promise.all(
        slots.map(async (slot) => {
          if (slot.restartTimer !== null) clearTimeout(slot.restartTimer);
          const worker = slot.worker;
          if (worker !== null) await worker.terminate();
        }),
      );
    },
  };
}
