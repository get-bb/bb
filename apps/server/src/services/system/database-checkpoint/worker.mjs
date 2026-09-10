import Database from "better-sqlite3";
import { parentPort, workerData } from "node:worker_threads";

if (!parentPort || typeof workerData?.databasePath !== "string") {
  throw new Error(
    "Database checkpoint worker requires a database path and port",
  );
}
const db = new Database(workerData.databasePath, {
  fileMustExist: true,
  timeout: 0,
});
db.pragma("synchronous = NORMAL");
db.pragma("wal_autocheckpoint = 0");

function checkpoint(requested) {
  const startedAt = performance.now();
  const [result] = db.pragma("wal_checkpoint(PASSIVE)");
  parentPort.postMessage({
    type: "checkpoint",
    requested,
    ...result,
    durationMs: performance.now() - startedAt,
  });
}

const timer = setInterval(() => checkpoint(false), 1000);
parentPort.on("message", (message) => {
  if (message === "checkpoint") {
    checkpoint(true);
  } else if (message === "stop") {
    clearInterval(timer);
    db.close();
    parentPort.close();
  } else {
    throw new Error("Unknown database checkpoint worker command");
  }
});
parentPort.postMessage({ type: "ready" });
