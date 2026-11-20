import childProcess from "node:child_process";
import os from "node:os";
import { createHistogram } from "node:perf_hooks";
import {
  EVENT_LOOP_GAP_INTERVAL_MS,
  monotonicNowMs,
  observeEventLoopGaps,
} from "./event-loop-gaps.js";

interface EventLoopStall {
  intervalMs: number;
  maxDelayMs: number;
  meanDelayMs: number;
  p99DelayMs: number;
  resolutionMs: number;
  thresholdMs: number;
}

interface SystemSuspension {
  intervalMs: number;
  durationMs: number;
  wallGapMs: number;
  monotonicGapMs: number;
  processCpuMs: number;
}

interface SampleClocks {
  wallMs: number;
  monotonicMs: number;
  linuxUptimeMs: number;
  cpuUsage: NodeJS.CpuUsage;
}

interface StartEventLoopDelaySamplerArgs {
  thresholdMs?: number | (() => number);
  now?: () => number;
  onSample: (sample: {
    stall: EventLoopStall | null;
    suspension: SystemSuspension | null;
  }) => void;
}

interface EventLoopDelaySampler {
  stop: () => void;
}

const EVENT_LOOP_STALL_THRESHOLD_MS = 500;
const EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS = 5_000;
const LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS = 60_000;
const SUSPENSION_CLOCK_TOLERANCE_MS = 1_000;
const DARWIN_SYSCTL_TIMEOUT_MS = 250;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

function nanosecondsToMilliseconds(durationNs: number): number {
  return durationNs / NANOSECONDS_PER_MILLISECOND;
}

export function createEventLoopDelayHistogram() {
  const histogram = createHistogram();
  let count = 0;
  let totalMs = 0;
  let maxMs = 0;
  return {
    record: (startedAt: number, endedAt: number) => {
      const gapMs = endedAt - startedAt;
      count += 1;
      totalMs += gapMs;
      maxMs = Math.max(maxMs, gapMs);
      histogram.record(
        Math.max(1, Math.round(gapMs * NANOSECONDS_PER_MILLISECOND)),
      );
    },
    take: () => {
      const summary = {
        maxDelayMs: maxMs,
        meanDelayMs: count === 0 ? 0 : totalMs / count,
        p99DelayMs: nanosecondsToMilliseconds(histogram.percentile(99)),
        resolutionMs: EVENT_LOOP_GAP_INTERVAL_MS,
      };
      histogram.reset();
      count = 0;
      totalMs = 0;
      maxMs = 0;
      return summary;
    },
  };
}

export function roundDurationMs(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

export function isLikelySystemSuspensionDelay(args: {
  gapMs: number;
  intervalMs: number;
}): boolean {
  return args.gapMs - args.intervalMs >= LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS;
}

function readDarwinSleepWindow(): { sleepAt: number; wakeAt: number } | null {
  try {
    const output = childProcess.execFileSync(
      "/usr/sbin/sysctl",
      ["-n", "kern.sleeptime", "kern.waketime"],
      {
        encoding: "utf8",
        timeout: DARWIN_SYSCTL_TIMEOUT_MS,
        killSignal: "SIGKILL",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const [sleepAt, wakeAt] = Array.from(
      output.matchAll(/sec = (\d+), usec = (\d+)/g),
      ([, seconds, microseconds]) =>
        Number(seconds) * 1_000 + Number(microseconds) / 1_000,
    );
    return sleepAt !== undefined && wakeAt !== undefined && wakeAt > sleepAt
      ? { sleepAt, wakeAt }
      : null;
  } catch {
    return null;
  }
}

export function startEventLoopDelaySampler(
  args: StartEventLoopDelaySamplerArgs,
): EventLoopDelaySampler {
  const now = args.now ?? Date.now;
  const { platform } = process;
  const readClocks = (): SampleClocks => ({
    wallMs: now(),
    monotonicMs: monotonicNowMs(),
    linuxUptimeMs: platform === "linux" ? os.uptime() * 1_000 : 0,
    cpuUsage: process.cpuUsage(),
  });

  const histogram = createEventLoopDelayHistogram();
  const darwinGaps: { startedAt: number; endedAt: number }[] = [];
  const gaps = observeEventLoopGaps((startedAt, endedAt) => {
    if (
      platform === "darwin" &&
      endedAt - startedAt >= LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS
    ) {
      darwinGaps.push({ startedAt, endedAt });
    } else {
      histogram.record(startedAt, endedAt);
    }
  });
  let previous = readClocks();

  const interval = setInterval(() => {
    gaps.flush();
    const current = readClocks();
    const wallGapMs = current.wallMs - previous.wallMs;
    const monotonicGapMs = current.monotonicMs - previous.monotonicMs;
    const processCpuMs =
      (current.cpuUsage.user -
        previous.cpuUsage.user +
        current.cpuUsage.system -
        previous.cpuUsage.system) /
      1_000;
    const canAccountForCpu = (awakeMs: number) =>
      processCpuMs <=
      (awakeMs + SUSPENSION_CLOCK_TOLERANCE_MS) * os.availableParallelism();
    let durationMs = 0;

    if (platform === "linux" && monotonicGapMs >= 0) {
      durationMs =
        current.linuxUptimeMs - previous.linuxUptimeMs - monotonicGapMs;
    }
    if (darwinGaps.length > 0) {
      const sleep =
        Math.abs(wallGapMs - monotonicGapMs) <= SUSPENSION_CLOCK_TOLERANCE_MS
          ? readDarwinSleepWindow()
          : null;
      if (
        sleep &&
        sleep.sleepAt >= previous.wallMs &&
        sleep.wakeAt <= current.wallMs &&
        canAccountForCpu(monotonicGapMs - (sleep.wakeAt - sleep.sleepAt))
      ) {
        durationMs = sleep.wakeAt - sleep.sleepAt;
      }
      for (const { startedAt, endedAt } of darwinGaps) {
        const wallAtEnd = current.wallMs - (current.monotonicMs - endedAt);
        const wallAtStart = wallAtEnd - (endedAt - startedAt);
        const overlapMs =
          sleep && durationMs >= LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS
            ? Math.max(
                0,
                Math.min(wallAtEnd, sleep.wakeAt) -
                  Math.max(wallAtStart, sleep.sleepAt),
              )
            : 0;
        histogram.record(startedAt, endedAt - overlapMs);
      }
      darwinGaps.length = 0;
    }

    const suspension: SystemSuspension | null =
      durationMs >= LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS &&
      (platform !== "linux" || canAccountForCpu(monotonicGapMs))
        ? {
            intervalMs: EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS,
            durationMs: roundDurationMs(durationMs),
            wallGapMs: roundDurationMs(wallGapMs),
            monotonicGapMs: roundDurationMs(monotonicGapMs),
            processCpuMs: roundDurationMs(processCpuMs),
          }
        : null;
    previous = current;
    const delay = histogram.take();
    const thresholdMs =
      typeof args.thresholdMs === "function"
        ? args.thresholdMs()
        : (args.thresholdMs ?? EVENT_LOOP_STALL_THRESHOLD_MS);
    const stalled = delay.maxDelayMs >= thresholdMs;
    args.onSample({
      suspension,
      stall: stalled
        ? {
            intervalMs: EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS,
            maxDelayMs: roundDurationMs(delay.maxDelayMs),
            meanDelayMs: roundDurationMs(delay.meanDelayMs),
            p99DelayMs: roundDurationMs(delay.p99DelayMs),
            resolutionMs: delay.resolutionMs,
            thresholdMs,
          }
        : null,
    });
  }, EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS);
  interval.unref();

  return {
    stop: () => {
      clearInterval(interval);
      gaps.stop();
    },
  };
}
