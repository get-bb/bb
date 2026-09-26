import { Worker } from "node:worker_threads";
import {
  hydrateThreadSearchResults,
  searchThreadsWithPendingInteractionState,
  type DbConnection,
  type ThreadSearchMatchRow,
} from "@bb/db";
import { threadSearchWorkerResponseSchema } from "./thread-search-protocol.js";

interface SearchArgs {
  query: string;
  limitPerGroup: number;
}

class ThreadSearchWorker {
  private worker: Worker | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(private readonly databasePath: string) {}

  search(
    args: SearchArgs,
    signal: AbortSignal,
  ): Promise<ThreadSearchMatchRow[]> {
    const result = this.tail.then(() => {
      signal.throwIfAborted();
      if (this.closed) throw new Error("Thread search is closed");
      const worker = this.worker ?? this.start();
      return new Promise<ThreadSearchMatchRow[]>((resolve, reject) => {
        const cleanup = () => {
          worker.off("message", onMessage);
          worker.off("error", onError);
          worker.off("exit", onExit);
        };
        const onMessage = (message: unknown) => {
          cleanup();
          try {
            signal.throwIfAborted();
            const response = threadSearchWorkerResponseSchema.parse(message);
            if (!response.ok) throw new Error(response.error);
            resolve(response.rows);
          } catch (error) {
            reject(error);
          }
        };
        const onError = (error: Error) => {
          cleanup();
          this.worker = null;
          reject(error);
        };
        const onExit = (code: number) =>
          onError(new Error(`Thread search worker exited (${code})`));
        worker.once("message", onMessage);
        worker.once("error", onError);
        worker.once("exit", onExit);
        worker.postMessage(args);
      });
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  private start(): Worker {
    const source = import.meta.url.endsWith(".ts");
    const entry = new URL(
      source ? "../../thread-search-worker.ts" : "./thread-search-worker.js",
      import.meta.url,
    );
    const worker = source
      ? new Worker(
          `import("tsx/esm/api").then(({ register }) => { register(); return import(${JSON.stringify(entry.href)}); });`,
          { eval: true, workerData: this.databasePath },
        )
      : new Worker(entry, { workerData: this.databasePath });
    worker.unref();
    worker.on("error", () => {
      if (this.worker === worker) this.worker = null;
    });
    worker.on("exit", () => {
      if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.worker?.terminate();
    this.worker = null;
  }
}

const workers = new WeakMap<DbConnection, ThreadSearchWorker>();

export async function searchThreads(
  db: DbConnection,
  args: SearchArgs,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (db.$client.memory)
    return searchThreadsWithPendingInteractionState(db, args);
  let worker = workers.get(db);
  if (worker === undefined) {
    worker = new ThreadSearchWorker(db.$client.name);
    workers.set(db, worker);
  }
  const rows = await worker.search(args, signal);
  return hydrateThreadSearchResults(db, { query: args.query, rows });
}

export async function closeThreadSearch(db: DbConnection): Promise<void> {
  await workers.get(db)?.close();
  workers.delete(db);
}
