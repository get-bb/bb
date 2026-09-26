import { parentPort, workerData } from "node:worker_threads";
import { createConnection, searchThreadMatchRows } from "@bb/db";
import { z } from "zod";
import { threadSearchRequestSchema } from "./services/threads/thread-search-protocol.js";

const port = parentPort;
if (port === null) throw new Error("Thread search requires a worker port");
const db = createConnection(z.string().min(1).parse(workerData), {
  readonly: true,
});
port.on("message", (message: unknown) => {
  try {
    const args = threadSearchRequestSchema.parse(message);
    port.postMessage({ ok: true, rows: searchThreadMatchRows(db, args) });
  } catch (error) {
    port.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
port.on("close", () => db.$client.close());
