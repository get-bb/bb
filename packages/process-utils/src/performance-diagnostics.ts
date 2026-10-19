import { startStallWindowCollector } from "./stall-windows.js";
import { Worker } from "node:worker_threads";
import {
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
} from "node:perf_hooks";
import { profileWorkerSource } from "./generated/profile-worker.js";

export async function startPerformanceDiagnostics(options: {
  dataDir: string;
  logger: {
    info(fields: object, message: string): void;
    warn(fields: object, message: string): void;
  };
}): Promise<{ stop: () => Promise<void> }> {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  let gcDurationMs = 0;
  let gcCount = 0;
  let gcMaxDurationMs = 0;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gcDurationMs += entry.duration;
      gcCount += 1;
      gcMaxDurationMs = Math.max(gcMaxDurationMs, entry.duration);
    }
  });
  observer.observe({ entryTypes: ["gc"] });
  histogram.enable();
  let previousCpu = process.cpuUsage();
  let previousThreadCpu = process.threadCpuUsage();
  let previousTime = performance.now();
  let previousUtilization = performance.eventLoopUtilization();
  const summaryTimer = setInterval(() => {
    const now = performance.now();
    const cpu = process.cpuUsage();
    const threadCpu = process.threadCpuUsage();
    const utilization = performance.eventLoopUtilization();
    options.logger.info(
      {
        pid: process.pid,
        intervalMs: now - previousTime,
        processCpuMs:
          (cpu.user + cpu.system - previousCpu.user - previousCpu.system) /
          1_000,
        mainThreadCpuMs:
          (threadCpu.user +
            threadCpu.system -
            previousThreadCpu.user -
            previousThreadCpu.system) /
          1_000,
        eventLoopUtilization: performance.eventLoopUtilization(
          utilization,
          previousUtilization,
        ).utilization,
        maxDelayMs: histogram.max / 1e6,
        p99DelayMs: histogram.percentile(99) / 1e6,
        gcDurationMs,
        gcCount,
        gcMaxDurationMs,
        memory: process.memoryUsage(),
      },
      "Server performance sample",
    );
    previousCpu = cpu;
    previousThreadCpu = threadCpu;
    previousTime = now;
    previousUtilization = utilization;
    gcDurationMs = 0;
    gcCount = 0;
    gcMaxDurationMs = 0;
    histogram.reset();
  }, 5_000);
  summaryTimer.unref();

  const worker = new Worker(profileWorkerSource, {
    eval: true,
    workerData: options.dataDir,
  });
  const stallWindows = startStallWindowCollector();
  let failed = false;
  let terminating = false;
  let pending:
    | { resolve: () => void; reject: (error: Error) => void }
    | undefined;
  const fail = (error: Error) => {
    if (failed) return;
    failed = true;
    stallWindows.stop();
    pending?.reject(error);
    pending = undefined;
    options.logger.warn(
      { err: error },
      "CPU profiling stopped; performance summaries remain enabled",
    );
  };
  worker.on("error", fail);
  worker.on("exit", (code) => {
    if (!terminating) fail(new Error(`CPU profiling worker exited (${code})`));
  });
  worker.on("message", (value: unknown) => {
    if (
      typeof value !== "object" ||
      value === null ||
      !("complete" in value) ||
      typeof value.complete !== "boolean" ||
      !("message" in value) ||
      typeof value.message !== "string" ||
      !("fields" in value) ||
      typeof value.fields !== "object" ||
      value.fields === null ||
      !("level" in value) ||
      (value.level !== "info" && value.level !== "warn")
    ) {
      fail(new Error("Invalid CPU profiling worker response"));
      return;
    }
    options.logger[value.level](value.fields, value.message);
    if (value.complete) {
      pending?.resolve();
      pending = undefined;
    }
  });
  const request = (command: "start" | "capture" | "stop") => {
    if (failed) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      pending = { resolve, reject };
      worker.postMessage(
        command === "start"
          ? command
          : { command, stalls: stallWindows.take() },
      );
    }).catch(() => {});
  };
  await request("start");
  worker.unref();
  let rotation = Promise.resolve();
  let capturing = false;
  const profileTimer = setInterval(() => {
    if (capturing || failed) return;
    capturing = true;
    rotation = request("capture").finally(() => {
      capturing = false;
    });
  }, 30_000);
  profileTimer.unref();
  let stopPromise: Promise<void> | undefined;
  return {
    stop: () => {
      stopPromise ??= (async () => {
        clearInterval(profileTimer);
        clearInterval(summaryTimer);
        histogram.disable();
        observer.disconnect();
        worker.ref();
        await rotation;
        stallWindows.stop();
        await request("stop");
        terminating = true;
        await worker.terminate();
      })();
      return stopPromise;
    },
  };
}
