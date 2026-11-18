import { parentPort, workerData } from "node:worker_threads";
import { createReadOnlyConnection } from "@bb/db";
import { ApiError } from "./errors.js";
import type {
  ThreadReadWorkerData,
  ThreadReadWorkerReply,
  ThreadReadWorkerRunMessage,
} from "./services/threads/read-pool/thread-read-protocol.js";
import { runThreadRead } from "./services/threads/read-pool/thread-read.js";

if (parentPort === null) {
  throw new Error("thread-read-worker must run inside a worker thread");
}
const port = parentPort;
const { databasePath, pageCacheKib } = workerData as ThreadReadWorkerData;
const db = createReadOnlyConnection(databasePath, pageCacheKib);

function reply(message: ThreadReadWorkerReply): void {
  port.postMessage(message);
}

port.on("message", (message: ThreadReadWorkerRunMessage) => {
  try {
    reply({
      type: "result",
      id: message.id,
      result: runThreadRead(db, message.request),
    });
  } catch (error) {
    reply({
      type: "failed",
      id: message.id,
      apiError:
        error instanceof ApiError
          ? {
              status: error.status,
              code: error.body.code,
              message: error.body.message,
              details: error.body.details,
              retryable: error.body.retryable,
            }
          : null,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});
reply({ type: "ready" });
