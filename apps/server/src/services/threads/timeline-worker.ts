import { parentPort, workerData } from "node:worker_threads";
import { createConnection } from "@bb/db";
import { ApiError } from "../../errors.js";
import { buildThreadTimelineWithProfile } from "./timeline.js";
import type {
  TimelineWorkerRequest,
  TimelineWorkerReply,
} from "./timeline-worker-client.js";

if (!parentPort) throw new Error("Timeline worker requires a parent");
const db = createConnection(workerData.databasePath, { readonly: true });
db.$client.pragma("cache_size = -65536");
db.$client.pragma("mmap_size = 0");
parentPort.on("message", (request: TimelineWorkerRequest) => {
  let reply: TimelineWorkerReply;
  try {
    reply = {
      id: request.id,
      result: buildThreadTimelineWithProfile(
        db,
        request.thread,
        request.options,
      ),
    };
  } catch (error) {
    reply = {
      id: request.id,
      error: {
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof ApiError
          ? { status: error.status, body: error.body }
          : {}),
      },
    };
  }
  parentPort!.postMessage(reply);
});
