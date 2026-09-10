import { Worker } from "node:worker_threads";
import { z } from "zod";
import type { DbConnection } from "@bb/db";
import type { Logger } from "@bb/logger";

const checkpointResultSchema = z.object({
  type: z.literal("checkpoint"),
  requested: z.boolean(),
  busy: z.number().int(),
  log: z.number().int(),
  checkpointed: z.number().int(),
  durationMs: z.number().nonnegative(),
});
const workerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready") }),
  checkpointResultSchema,
]);
type CheckpointResult = z.infer<typeof checkpointResultSchema>;

interface DatabaseCheckpointWorker {
  checkpoint(): Promise<CheckpointResult>;
  stop(): Promise<void>;
}

export async function startDatabaseCheckpointWorker(args: {
  db: DbConnection;
  databasePath: string;
  logger: Pick<Logger, "info" | "warn">;
}): Promise<DatabaseCheckpointWorker | null> {
  if (args.db.$client.memory) return null;
  const sqlite = args.db.$client;
  const originalAutoCheckpoint = Number(
    sqlite.pragma("wal_autocheckpoint", { simple: true }),
  );
  let stopping = false;
  let stopped: Promise<void> | null = null;
  let failed = false;
  let pending: {
    promise: Promise<CheckpointResult>;
    resolve: (result: CheckpointResult) => void;
    reject: (error: Error) => void;
  } | null = null;
  let worker: Worker;
  try {
    worker = new Worker(
      new URL("./database-checkpoint/worker.mjs", import.meta.url),
      {
        workerData: { databasePath: args.databasePath },
      },
    );
  } catch (error) {
    args.logger.warn(
      { err: error },
      "Could not start database checkpoint worker; keeping automatic checkpoints",
    );
    return null;
  }
  let readyResolve: () => void;
  let readyReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const restore = () => {
    if (sqlite.open)
      sqlite.pragma(`wal_autocheckpoint = ${originalAutoCheckpoint}`);
  };
  const fail = (error: Error) => {
    if (failed || stopping) return;
    failed = true;
    restore();
    readyReject(error);
    pending?.reject(error);
    pending = null;
    args.logger.warn(
      { err: error },
      "Database checkpoint worker failed; restored automatic checkpoints",
    );
    void worker.terminate();
  };
  worker.on("error", fail);
  worker.on("exit", (code) => {
    if (!stopping)
      fail(new Error(`Database checkpoint worker exited with code ${code}`));
  });
  worker.on("message", (message: unknown) => {
    const parsed = workerMessageSchema.safeParse(message);
    if (!parsed.success) {
      fail(new Error("Invalid database checkpoint worker response"));
      return;
    }
    if (parsed.data.type === "ready") {
      readyResolve();
      return;
    }
    if (parsed.data.durationMs >= 100) {
      args.logger.info(parsed.data, "Slow background DB checkpoint");
    }
    if (parsed.data.requested) {
      pending?.resolve(parsed.data);
      pending = null;
    }
  });
  worker.unref();
  const startupTimeout = setTimeout(
    () => fail(new Error("Database checkpoint worker startup timed out")),
    5000,
  );
  try {
    await ready;
    sqlite.pragma("wal_autocheckpoint = 0");
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
    return null;
  } finally {
    clearTimeout(startupTimeout);
  }
  return {
    checkpoint() {
      if (failed || stopping)
        return Promise.reject(
          new Error("Database checkpoint worker is unavailable"),
        );
      if (pending) return pending.promise;
      let resolveResult: (result: CheckpointResult) => void;
      let rejectResult: (error: Error) => void;
      const promise = new Promise<CheckpointResult>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      pending = { promise, resolve: resolveResult!, reject: rejectResult! };
      worker.postMessage("checkpoint");
      return promise;
    },
    stop() {
      if (stopped) return stopped;
      stopping = true;
      restore();
      pending?.reject(new Error("Database checkpoint worker stopped"));
      pending = null;
      stopped = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          void worker.terminate().then(() => resolve());
        }, 5000);
        worker.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        worker.postMessage("stop");
        if (failed) {
          clearTimeout(timeout);
          resolve();
        }
      });
      return stopped;
    },
  };
}
