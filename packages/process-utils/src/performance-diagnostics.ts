import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Session } from "node:inspector/promises";
import {
  console as inspectorConsole,
  type InspectorNotification,
  type Profiler,
} from "node:inspector";
import { join } from "node:path";
import {
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
} from "node:perf_hooks";

const PROFILE_INTERVAL_MS = 30_000;
const PROFILE_RETENTION_MS = 12 * 60 * 60 * 1_000;
const MAX_RETAINED_PROFILE_BYTES = 1_000_000_000;
const MAX_PROFILE_BYTES = 12 * 1024 * 1024;

export async function startPerformanceDiagnostics(options: {
  dataDir: string;
  runSynchronousWork?: <T>(label: string, work: () => T) => T;
  logger: {
    info(fields: object, message: string): void;
    warn(fields: object, message: string): void;
  };
}): Promise<{ stop: () => Promise<void> }> {
  const runSynchronousWork =
    options.runSynchronousWork ??
    (<T>(_label: string, work: () => T): T => work());
  const directory = join(options.dataDir, "logs", "performance");
  const session = new Session();
  let profiling = false;
  let profileTitle = `bb-performance-${randomUUID()}`;
  const finishProfile = (title: string): Profiler.Profile => {
    let profile: Profiler.Profile | undefined;
    const finished = (
      message: InspectorNotification<Profiler.ConsoleProfileFinishedEventDataType>,
    ) => {
      if (message.params.title === title) profile = message.params.profile;
    };
    session.on("Profiler.consoleProfileFinished", finished);
    try {
      inspectorConsole.profileEnd(title);
    } finally {
      session.off("Profiler.consoleProfileFinished", finished);
    }
    if (!profile) throw new Error("CPU profile completion was not received");
    return profile;
  };
  let stopped = false;
  let profileStartedAt = new Date().toISOString();
  let rotation: Promise<void> = Promise.resolve();
  const pendingPath = join(directory, "profile.pending");
  const pruneProfiles = async (reservedBytes: number): Promise<void> => {
    const cutoff = Date.now() - PROFILE_RETENTION_MS;
    const files = await readdir(directory, { withFileTypes: true });
    const profiles = await Promise.all(
      files
        .filter(
          (file) =>
            file.isFile() &&
            /^profile-\d+(?:-[0-9a-f-]{36})?\.cpuprofile$/.test(file.name),
        )
        .map(async (file) => {
          const path = join(directory, file.name);
          const details = await stat(path);
          return { path, bytes: details.size, savedAt: details.mtimeMs };
        }),
    );
    profiles.sort(
      (left, right) =>
        left.savedAt - right.savedAt || left.path.localeCompare(right.path),
    );
    let bytes = profiles.reduce(
      (total, profile) => total + profile.bytes,
      reservedBytes,
    );
    for (const profile of profiles) {
      if (profile.savedAt <= cutoff || bytes > MAX_RETAINED_PROFILE_BYTES) {
        await rm(profile.path, { force: true });
        bytes -= profile.bytes;
      }
    }
  };
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

  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await rm(pendingPath, { force: true });
    await pruneProfiles(0);
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 1_000 });
    runSynchronousWork("cpu-profile:start", () =>
      inspectorConsole.profile(profileTitle),
    );
    profiling = true;
    options.logger.info(
      {
        directory,
        profileIntervalMs: PROFILE_INTERVAL_MS,
        profileRetentionMs: PROFILE_RETENTION_MS,
        maxRetainedProfileBytes: MAX_RETAINED_PROFILE_BYTES,
        maxProfileBytes: MAX_PROFILE_BYTES,
        pid: process.pid,
      },
      "Server performance diagnostics enabled",
    );
  } catch (error) {
    session.disconnect();
    options.logger.warn(
      { err: error },
      "CPU profiling unavailable; performance summaries remain enabled",
    );
  }

  const capture = async (restart: boolean): Promise<void> => {
    if (!profiling) return;
    try {
      const title = profileTitle;
      const startedAt = profileStartedAt;
      if (restart && !stopped) {
        profileTitle = `bb-performance-${randomUUID()}`;
        runSynchronousWork("cpu-profile:start", () =>
          inspectorConsole.profile(profileTitle),
        );
        profileStartedAt = new Date().toISOString();
      } else {
        profiling = false;
      }
      const profile = runSynchronousWork("cpu-profile:finish", () =>
        finishProfile(title),
      );
      const endedAt = new Date().toISOString();
      const contents = runSynchronousWork("cpu-profile:serialize", () =>
        JSON.stringify(profile),
      );
      const bytes = Buffer.byteLength(contents);
      await pruneProfiles(bytes > MAX_PROFILE_BYTES ? 0 : bytes);
      if (bytes > MAX_PROFILE_BYTES) {
        options.logger.warn(
          { bytes, startedAt, endedAt },
          "CPU profile exceeded size limit; discarded",
        );
        return;
      }
      const path = join(
        directory,
        `profile-${Date.now()}-${randomUUID()}.cpuprofile`,
      );
      await writeFile(pendingPath, contents, { mode: 0o600 });
      await rename(pendingPath, path);
      options.logger.info(
        {
          path,
          bytes,
          startedAt,
          endedAt,
          pid: process.pid,
          sampleTimeBasis: "elapsed",
          nativeFramesMayIncludeWaiting: true,
        },
        "Server CPU profile saved",
      );
    } catch (error) {
      profiling = false;
      session.disconnect();
      await rm(pendingPath, { force: true }).catch(() => {});
      options.logger.warn(
        { err: error },
        "CPU profiling stopped after capture failure; performance summaries remain enabled",
      );
    }
  };
  const profileTimer = setInterval(() => {
    rotation = rotation.then(() => capture(true));
  }, PROFILE_INTERVAL_MS);
  profileTimer.unref();
  let stopPromise: Promise<void> | undefined;
  return {
    stop: () => {
      stopPromise ??= (async () => {
        stopped = true;
        clearInterval(profileTimer);
        clearInterval(summaryTimer);
        histogram.disable();
        observer.disconnect();
        await rotation;
        await capture(false);
        session.disconnect();
      })();
      return stopPromise;
    },
  };
}
