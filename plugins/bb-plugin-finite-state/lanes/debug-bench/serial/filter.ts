import { Worker } from "node:worker_threads";
import type { SerialLine } from "./ring-buffer.js";

export class SerialFilterError extends Error {
  readonly code = "INVALID_SERIAL_FILTER" as const;

  constructor(
    readonly pattern: string,
    readonly engineMessage: string,
  ) {
    super(`INVALID_SERIAL_FILTER: ${engineMessage}`);
    this.name = "SerialFilterError";
  }
}

export interface SerialFilterWorkOptions {
  executionTimeoutMs?: number;
  startupTimeoutMs?: number;
}

const DEFAULT_EXECUTION_TIMEOUT_MS = 50;
const DEFAULT_STARTUP_TIMEOUT_MS = 500;
const MAX_CONCURRENT_FILTER_WORKERS = 4;
let activeFilterWorkers = 0;

const FILTER_WORKER_SOURCE = String.raw`
  const { parentPort } = require("node:worker_threads");
  parentPort.once("message", ({ pattern, texts }) => {
    try {
      const expression = new RegExp(pattern, "u");
      const matchingIndexes = [];
      for (let index = 0; index < texts.length; index += 1) {
        expression.lastIndex = 0;
        if (expression.test(texts[index])) matchingIndexes.push(index);
      }
      parentPort.postMessage({ ok: true, matchingIndexes });
    } catch (error) {
      parentPort.postMessage({
        ok: false,
        message: error instanceof Error ? error.message : "Invalid regular expression",
      });
    }
  });
`;

function positiveTimeout(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && value !== undefined && value > 0 ? value : fallback;
}

function workerResult(value: unknown):
  | { ok: true; matchingIndexes: number[] }
  | { ok: false; message: string }
  | null {
  if (typeof value !== "object" || value === null) return null;
  const ok = Reflect.get(value, "ok");
  if (ok === false) {
    const message = Reflect.get(value, "message");
    return typeof message === "string" ? { ok, message } : null;
  }
  const indexes = Reflect.get(value, "matchingIndexes");
  if (
    ok !== true || !Array.isArray(indexes) ||
    !indexes.every((index) => Number.isSafeInteger(index) && index >= 0)
  ) return null;
  return { ok, matchingIndexes: indexes };
}

export function filterSerialLines(
  pattern: string | undefined,
  lines: readonly SerialLine[],
  options: SerialFilterWorkOptions = {},
): Promise<ReadonlySet<number>> {
  if (pattern === undefined || pattern.length === 0) {
    return Promise.resolve(new Set(lines.map((_, index) => index)));
  }
  if (pattern.length > 1000) {
    return Promise.reject(new SerialFilterError(pattern, "Pattern exceeds 1000 characters"));
  }
  if (activeFilterWorkers >= MAX_CONCURRENT_FILTER_WORKERS) {
    return Promise.reject(new SerialFilterError(pattern, "Serial filter work budget is busy"));
  }

  const executionTimeoutMs = positiveTimeout(
    options.executionTimeoutMs,
    DEFAULT_EXECUTION_TIMEOUT_MS,
  );
  const startupTimeoutMs = positiveTimeout(options.startupTimeoutMs, DEFAULT_STARTUP_TIMEOUT_MS);
  activeFilterWorkers += 1;

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(FILTER_WORKER_SOURCE, {
        eval: true,
        resourceLimits: {
          maxOldGenerationSizeMb: 16,
          maxYoungGenerationSizeMb: 4,
          stackSizeMb: 1,
        },
      });
    } catch (error) {
      activeFilterWorkers -= 1;
      reject(new SerialFilterError(
        pattern,
        error instanceof Error ? error.message : "Serial filter worker failed to start",
      ));
      return;
    }
    let settled = false;
    let executionTimer: ReturnType<typeof setTimeout> | null = null;
    const startupTimer = setTimeout(() => {
      finish(new SerialFilterError(pattern, `Serial filter worker startup exceeded ${startupTimeoutMs} ms`));
    }, startupTimeoutMs);

    const finish = (error: Error | null, indexes?: readonly number[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (executionTimer) clearTimeout(executionTimer);
      const settle = () => {
        activeFilterWorkers -= 1;
        if (error) reject(error);
        else resolve(new Set(indexes));
      };
      void worker.terminate().then(
        settle,
        settle,
      );
    };

    worker.once("online", () => {
      clearTimeout(startupTimer);
      executionTimer = setTimeout(() => {
        finish(new SerialFilterError(
          pattern,
          `Pattern exceeded the ${executionTimeoutMs} ms serial filter work budget`,
        ));
      }, executionTimeoutMs);
      worker.postMessage({ pattern, texts: lines.map((line) => line.text) });
    });
    worker.once("message", (message: unknown) => {
      const result = workerResult(message);
      if (!result) {
        finish(new SerialFilterError(pattern, "Serial filter worker returned an invalid result"));
      } else if (!result.ok) {
        finish(new SerialFilterError(pattern, result.message));
      } else {
        finish(null, result.matchingIndexes);
      }
    });
    worker.once("error", (error) => finish(new SerialFilterError(pattern, error.message)));
    worker.once("exit", (code) => {
      if (!settled) finish(new SerialFilterError(pattern, `Serial filter worker exited with code ${code}`));
    });
  });
}
