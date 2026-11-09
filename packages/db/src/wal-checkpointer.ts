import type Database from "better-sqlite3";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

const WAL_CHECKPOINT_INTERVAL_MS = 100;
const WAL_CHECKPOINT_FRAME_THRESHOLD = 4_096;
const WAL_CHECKPOINT_STARVED_FRAMES = 16_384;
const SLOW_WAL_CHECKPOINT_MS = 100;
const WAL_CHECKPOINT_WORKER_RESTART_DELAY_MS = 10_000;
const WAL_CHECKPOINT_WORKER_STOP_TIMEOUT_MS = 5_000;

const walCheckpointWorkerSource = String.raw`
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const Database = require(workerData.driverPath);
const targets = new Map();
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function close(id) {
  const target = targets.get(id);
  if (target === undefined) return;
  clearTimeout(target.timer);
  targets.delete(id);
  target.database.close();
}
function checkpoint(id, target) {
  const startedAt = performance.now();
  const row = target.database.pragma("wal_checkpoint(PASSIVE)")[0];
  const result = {
    walFrames: row.log,
    checkpointedFrames: row.checkpointed,
    durationMs: performance.now() - startedAt,
  };
  if (result.durationMs >= workerData.slowCheckpointMs) {
    parentPort.postMessage({ type: "slow", id, ...result });
  }
  return result;
}
function run(id, target) {
  let result;
  try {
    result = checkpoint(id, target);
  } catch (error) {
    try {
      close(id);
    } catch {}
    parentPort.postMessage({ type: "failed", id, message: errorMessage(error) });
    return;
  }
  clearTimeout(target.timer);
  const growing = result.walFrames > target.previousWalFrames;
  const progressed =
    result.checkpointedFrames !== target.previousCheckpointedFrames ||
    result.walFrames < target.previousWalFrames;
  const starved =
    growing && progressed && target.previousWalFrames >= workerData.starvedFrames;
  target.previousWalFrames = result.walFrames;
  target.previousCheckpointedFrames = result.checkpointedFrames;
  if (target.paused) return;
  if (starved) {
    target.paused = true;
    parentPort.postMessage({ type: "starved", id, walFrames: result.walFrames });
    return;
  }
  const catchUp =
    progressed &&
    result.walFrames >= workerData.frameThreshold &&
    (growing || result.checkpointedFrames < result.walFrames);
  target.timer = setTimeout(() => run(id, target), catchUp ? 0 : workerData.intervalMs);
}
parentPort.on("message", (message) => {
  switch (message.type) {
    case "attach": {
      let database;
      try {
        database = new Database(message.path, { fileMustExist: true });
        database.pragma("synchronous = NORMAL");
      } catch (error) {
        parentPort.postMessage({ type: "failed", id: message.id, message: errorMessage(error) });
        return;
      }
      const target = {
        database,
        timer: null,
        paused: false,
        previousWalFrames: 0,
        previousCheckpointedFrames: 0,
      };
      targets.set(message.id, target);
      parentPort.postMessage({ type: "attached", id: message.id });
      run(message.id, target);
      return;
    }
    case "checkpoint": {
      const target = targets.get(message.id);
      if (target !== undefined) run(message.id, target);
      parentPort.postMessage({ type: "checkpointed", requestId: message.requestId });
      return;
    }
    case "resume": {
      const target = targets.get(message.id);
      if (target === undefined) return;
      target.paused = false;
      run(message.id, target);
      return;
    }
    case "detach":
      close(message.id);
      parentPort.postMessage({ type: "detached", id: message.id });
      return;
    case "stop":
      for (const [id, target] of targets) {
        clearTimeout(target.timer);
        try {
          checkpoint(id, target);
        } catch {}
        close(id);
      }
      parentPort.close();
      return;
  }
});
parentPort.postMessage({ type: "ready" });
`;

export interface WalCheckpointLogger {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

export interface WalCheckpointer {
  attach(database: Database.Database): void;
  checkpoint(database: Database.Database): Promise<void>;
  detach(database: Database.Database): Promise<void>;
  stop(): Promise<void>;
}

type WalCheckpointWorkerMessage =
  | { type: "ready" }
  | { type: "attached"; id: number }
  | { type: "failed"; id: number; message: string }
  | { type: "checkpointed"; requestId: number }
  | { type: "detached"; id: number }
  | { type: "starved"; id: number; walFrames: number }
  | {
      type: "slow";
      id: number;
      walFrames: number;
      checkpointedFrames: number;
      durationMs: number;
    };

interface WalCheckpointTarget {
  id: number;
  database: Database.Database;
  automaticCheckpointPages: number;
}

function hasNumber<TKey extends string>(
  value: object,
  key: TKey,
): value is Record<TKey, number> {
  return key in value && typeof Reflect.get(value, key) === "number";
}

function parseWorkerMessage(value: unknown): WalCheckpointWorkerMessage | null {
  if (typeof value !== "object" || value === null || !("type" in value)) {
    return null;
  }
  switch (value.type) {
    case "ready":
      return { type: "ready" };
    case "attached":
    case "detached":
      return hasNumber(value, "id") ? { type: value.type, id: value.id } : null;
    case "failed":
      return hasNumber(value, "id") &&
        "message" in value &&
        typeof value.message === "string"
        ? { type: "failed", id: value.id, message: value.message }
        : null;
    case "checkpointed":
      return hasNumber(value, "requestId")
        ? { type: "checkpointed", requestId: value.requestId }
        : null;
    case "starved":
      return hasNumber(value, "id") && hasNumber(value, "walFrames")
        ? { type: "starved", id: value.id, walFrames: value.walFrames }
        : null;
    case "slow":
      return hasNumber(value, "id") &&
        hasNumber(value, "walFrames") &&
        hasNumber(value, "checkpointedFrames") &&
        hasNumber(value, "durationMs")
        ? {
            type: "slow",
            id: value.id,
            walFrames: value.walFrames,
            checkpointedFrames: value.checkpointedFrames,
            durationMs: value.durationMs,
          }
        : null;
    default:
      return null;
  }
}

function checkpointTail(database: Database.Database): number {
  const rows: unknown = database.pragma("wal_checkpoint(PASSIVE)");
  const row: unknown = Array.isArray(rows) ? rows[0] : undefined;
  return typeof row === "object" &&
    row !== null &&
    hasNumber(row, "checkpointed")
    ? row.checkpointed
    : 0;
}

const driverPath = createRequire(import.meta.url).resolve("better-sqlite3");

export function startWalCheckpointer(args: {
  logger: WalCheckpointLogger;
}): WalCheckpointer {
  const { logger } = args;
  const targets = new Map<Database.Database, WalCheckpointTarget>();
  const targetsById = new Map<number, WalCheckpointTarget>();
  const pendingCheckpoints = new Map<number, () => void>();
  const pendingDetaches = new Map<number, () => void>();
  let nextId = 0;
  let worker: Worker | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let stopping: Promise<void> | null = null;

  const setAutomaticCheckpoints = (
    target: WalCheckpointTarget,
    enabled: boolean,
  ) => {
    if (!target.database.open) return;
    target.database.pragma(
      `wal_autocheckpoint = ${enabled ? target.automaticCheckpointPages : 0}`,
    );
  };

  const postAttach = (current: Worker, target: WalCheckpointTarget) => {
    current.postMessage({
      type: "attach",
      id: target.id,
      path: resolve(target.database.name),
    });
  };

  const settlePending = () => {
    for (const settle of pendingCheckpoints.values()) settle();
    pendingCheckpoints.clear();
    for (const settle of pendingDetaches.values()) settle();
    pendingDetaches.clear();
  };

  const handleMessage = (
    current: Worker,
    message: WalCheckpointWorkerMessage,
  ) => {
    switch (message.type) {
      case "ready":
        return;
      case "attached": {
        const target = targetsById.get(message.id);
        if (target !== undefined && stopping === null) {
          setAutomaticCheckpoints(target, false);
        }
        return;
      }
      case "failed": {
        const target = targetsById.get(message.id);
        if (target === undefined) return;
        setAutomaticCheckpoints(target, true);
        logger.warn(
          { database: target.database.name, message: message.message },
          "WAL checkpoint worker dropped a database; its commits checkpoint the WAL",
        );
        return;
      }
      case "checkpointed":
        pendingCheckpoints.get(message.requestId)?.();
        pendingCheckpoints.delete(message.requestId);
        return;
      case "detached":
        pendingDetaches.get(message.id)?.();
        pendingDetaches.delete(message.id);
        return;
      case "starved": {
        const target = targetsById.get(message.id);
        if (
          target !== undefined &&
          target.database.open &&
          !target.database.inTransaction &&
          stopping === null
        ) {
          const startedAt = performance.now();
          const checkpointedFrames = checkpointTail(target.database);
          logger.info(
            {
              database: target.database.name,
              walFrames: message.walFrames,
              checkpointedFrames,
              durationMs: performance.now() - startedAt,
            },
            "Sustained writes outpaced the WAL checkpoint worker; checkpointed the WAL tail between tasks",
          );
        }
        current.postMessage({ type: "resume", id: message.id });
        return;
      }
      case "slow": {
        const { type: _type, id, ...fields } = message;
        logger.info(
          { database: targetsById.get(id)?.database.name, ...fields },
          "Slow WAL checkpoint",
        );
        return;
      }
    }
  };

  const spawn = () => {
    const current = new Worker(walCheckpointWorkerSource, {
      eval: true,
      workerData: {
        driverPath,
        frameThreshold: WAL_CHECKPOINT_FRAME_THRESHOLD,
        intervalMs: WAL_CHECKPOINT_INTERVAL_MS,
        slowCheckpointMs: SLOW_WAL_CHECKPOINT_MS,
        starvedFrames: WAL_CHECKPOINT_STARVED_FRAMES,
      },
    });
    current.unref();
    worker = current;
    let ready = false;
    let failure: unknown = null;
    current.on("message", (value: unknown) => {
      const message = parseWorkerMessage(value);
      if (message === null) {
        failure = new Error("Invalid WAL checkpoint worker message");
        void current.terminate();
        return;
      }
      if (message.type === "ready") ready = true;
      handleMessage(current, message);
    });
    current.on("error", (error) => {
      failure = error;
    });
    current.on("exit", (code) => {
      worker = null;
      for (const target of targets.values()) {
        setAutomaticCheckpoints(target, true);
      }
      settlePending();
      if (stopping !== null) return;
      logger.warn(
        {
          code,
          err: failure,
          restartInMs: ready ? WAL_CHECKPOINT_WORKER_RESTART_DELAY_MS : null,
        },
        "WAL checkpoint worker exited; commits checkpoint the WAL until it restarts",
      );
      if (!ready) return;
      restartTimer = setTimeout(() => {
        restartTimer = null;
        if (stopping !== null) return;
        const restarted = spawn();
        for (const target of targets.values()) postAttach(restarted, target);
      }, WAL_CHECKPOINT_WORKER_RESTART_DELAY_MS);
      restartTimer.unref();
    });
    return current;
  };

  return {
    attach(database) {
      if (stopping !== null || targets.has(database)) return;
      if (
        database.memory ||
        database.pragma("journal_mode", { simple: true }) !== "wal"
      ) {
        return;
      }
      const automaticCheckpointPages = database.pragma("wal_autocheckpoint", {
        simple: true,
      });
      const target: WalCheckpointTarget = {
        id: nextId++,
        database,
        automaticCheckpointPages:
          typeof automaticCheckpointPages === "number"
            ? automaticCheckpointPages
            : 1_000,
      };
      targets.set(database, target);
      targetsById.set(target.id, target);
      if (worker === null && restartTimer === null) spawn();
      if (worker !== null) postAttach(worker, target);
    },
    checkpoint(database) {
      const target = targets.get(database);
      const current = worker;
      if (target === undefined || current === null || stopping !== null) {
        return Promise.resolve();
      }
      const requestId = nextId++;
      return new Promise<void>((settle) => {
        pendingCheckpoints.set(requestId, settle);
        current.postMessage({ type: "checkpoint", id: target.id, requestId });
      });
    },
    detach(database) {
      const target = targets.get(database);
      if (target === undefined) return Promise.resolve();
      targets.delete(database);
      targetsById.delete(target.id);
      setAutomaticCheckpoints(target, true);
      const current = worker;
      if (current === null) return Promise.resolve();
      return new Promise<void>((settle) => {
        pendingDetaches.set(target.id, settle);
        current.postMessage({ type: "detach", id: target.id });
      });
    },
    stop() {
      stopping ??= (async () => {
        if (restartTimer !== null) clearTimeout(restartTimer);
        const current = worker;
        if (current === null) return;
        const exited = new Promise<void>((settle) =>
          current.once("exit", () => settle()),
        );
        current.postMessage({ type: "stop" });
        const timeout = setTimeout(
          () => void current.terminate(),
          WAL_CHECKPOINT_WORKER_STOP_TIMEOUT_MS,
        );
        await exited;
        clearTimeout(timeout);
      })();
      return stopping;
    },
  };
}
