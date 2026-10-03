import { Worker } from "node:worker_threads";
import type { Thread } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import { ApiError } from "../../errors.js";
import {
  buildThreadTimelineWithProfile,
  type BuildThreadTimelineOptions,
} from "./timeline.js";

type TimelineBuildResult = ReturnType<typeof buildThreadTimelineWithProfile>;
export interface TimelineWorkerRequest {
  id: number;
  thread: Thread;
  options: BuildThreadTimelineOptions;
}
export type TimelineWorkerReply =
  | { id: number; result: TimelineBuildResult }
  | {
      id: number;
      error: {
        message: string;
        status?: ApiError["status"];
        body?: ApiError["body"];
      };
    };

export function createTimelineWorkerClient(
  databasePath: string,
  workerUrl = new URL(
    import.meta.url.endsWith(".ts")
      ? "./timeline-worker.ts"
      : "./timeline-worker.js",
    import.meta.url,
  ),
) {
  const pending = new Map<
    number,
    {
      resolve: (result: TimelineBuildResult) => void;
      reject: (error: Error) => void;
    }
  >();
  let nextId = 0;
  let worker: Worker | undefined;
  let disposed = false;
  function start() {
    const current = new Worker(workerUrl, {
      workerData: { databasePath },
      resourceLimits: { maxOldGenerationSizeMb: 512 },
    });
    worker = current;
    current.unref();
    const fail = (error: Error) => {
      if (worker !== current) return;
      worker = undefined;
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    };
    current.on("message", (reply: TimelineWorkerReply) => {
      const request = pending.get(reply.id);
      if (!request) return;
      pending.delete(reply.id);
      if ("result" in reply) request.resolve(reply.result);
      else
        request.reject(
          reply.error.status !== undefined && reply.error.body !== undefined
            ? new ApiError(
                reply.error.status,
                reply.error.body.code,
                reply.error.message,
                reply.error.body,
              )
            : new Error(reply.error.message),
        );
    });
    current.on("error", fail);
    current.on("exit", (code) =>
      fail(new Error(`Timeline worker exited (${code})`)),
    );
    return current;
  }
  return {
    build(
      thread: Thread,
      options: BuildThreadTimelineOptions,
    ): Promise<TimelineBuildResult> {
      if (disposed)
        return Promise.reject(new Error("Timeline worker disposed"));
      if (pending.size >= 32)
        return Promise.reject(
          new ApiError(
            503,
            "busy",
            "Thread history is busy; retry shortly",
            true,
          ),
        );
      const current = worker ?? start();
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          current.postMessage({
            id,
            thread,
            options,
          } satisfies TimelineWorkerRequest);
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    async dispose() {
      disposed = true;
      for (const request of pending.values())
        request.reject(new Error("Timeline worker disposed"));
      pending.clear();
      const current = worker;
      worker = undefined;
      if (current) await current.terminate();
    },
  };
}

const clients = new WeakMap<
  DbConnection,
  ReturnType<typeof createTimelineWorkerClient>
>();
export function buildThreadTimelineOffThread(
  db: DbConnection,
  thread: Thread,
  options: BuildThreadTimelineOptions,
): Promise<TimelineBuildResult> {
  if (db.$client.name === ":memory:" || db.$client.name === "")
    return Promise.resolve(buildThreadTimelineWithProfile(db, thread, options));
  let client = clients.get(db);
  if (!client) {
    client = createTimelineWorkerClient(db.$client.name);
    clients.set(db, client);
  }
  return client.build(thread, options);
}
