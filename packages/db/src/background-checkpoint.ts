import type Database from "better-sqlite3";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Worker } from "node:worker_threads";

const PENDING = 0;
const RUNNING = 1;
const CLOSED = 2;
const CLOSE_TIMEOUT_MS = 30_000;

const workerSource = `
const { parentPort, workerData } = require("node:worker_threads");
const lifecycle = new Int32Array(workerData.lifecycle);
if (Atomics.compareExchange(lifecycle, 0, ${PENDING}, ${RUNNING}) === ${PENDING}) {
  let db;
  let timer;
  const close = () => {
    clearInterval(timer);
    if (db?.open) db.close();
    Atomics.store(lifecycle, 0, ${CLOSED});
    Atomics.notify(lifecycle, 0);
    parentPort.close();
  };
  try {
    const Database = require(workerData.modulePath);
    db = new Database(workerData.databasePath, { fileMustExist: true, timeout: 0 });
    db.pragma("synchronous = NORMAL");
    db.pragma("wal_autocheckpoint = 0");
    timer = setInterval(() => {
      try {
        db.pragma("wal_checkpoint(PASSIVE)");
      } catch (error) {
        close();
        throw error;
      }
    }, 1000);
    parentPort.once("message", close);
    parentPort.postMessage("ready");
  } catch (error) {
    close();
    throw error;
  }
} else {
  parentPort.close();
}
`;

export function startBackgroundCheckpoint(
  sqlite: Database.Database,
  onError: (error: Error) => void,
): () => void {
  if (sqlite.memory || sqlite.name === "") return () => {};

  const autoCheckpoint: unknown = sqlite.pragma("wal_autocheckpoint", {
    simple: true,
  });
  if (typeof autoCheckpoint !== "number") {
    throw new Error("Invalid SQLite auto-checkpoint threshold");
  }
  let stopped = false;
  let failed = false;
  const fail = (error: Error) => {
    if (stopped || failed) return;
    failed = true;
    if (sqlite.open) {
      sqlite.pragma(`wal_autocheckpoint = ${autoCheckpoint}`);
    }
    onError(error);
  };

  const lifecycle = new Int32Array(new SharedArrayBuffer(4));
  let worker: Worker;
  try {
    worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        lifecycle: lifecycle.buffer,
        modulePath: createRequire(import.meta.url).resolve("better-sqlite3"),
        databasePath: resolve(sqlite.name),
      },
    });
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)));
    return () => {};
  }
  worker.once("message", (message: unknown) => {
    if (message === "ready" && !stopped && !failed && sqlite.open) {
      sqlite.pragma("wal_autocheckpoint = 0");
    }
  });
  worker.once("error", fail);
  worker.once("exit", (code) => {
    Atomics.store(lifecycle, 0, CLOSED);
    Atomics.notify(lifecycle, 0);
    fail(new Error(`SQLite checkpoint worker exited (${code})`));
  });
  worker.unref();

  return () => {
    stopped = true;
    if (Atomics.compareExchange(lifecycle, 0, PENDING, CLOSED) === RUNNING) {
      worker.postMessage("close");
      Atomics.wait(lifecycle, 0, RUNNING, CLOSE_TIMEOUT_MS);
      if (Atomics.load(lifecycle, 0) !== CLOSED) {
        throw new Error(
          "Timed out waiting for SQLite checkpoint worker to close",
        );
      }
    }
  };
}
