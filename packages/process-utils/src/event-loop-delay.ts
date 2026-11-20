import os from "node:os";
import { createHistogram } from "node:perf_hooks";
import {
  EVENT_LOOP_GAP_INTERVAL_MS,
  monotonicNowMs,
  observeEventLoopGaps,
  roundDurationMs,
} from "./event-loop-gaps.js";
import { execHostFile } from "./host-process.js";

export { roundDurationMs } from "./event-loop-gaps.js";

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

type ReportSample = (sample: {
  stall: EventLoopStall | null;
  suspension: SystemSuspension | null;
}) => void;

type StartEventLoopDelaySamplerArgs = {
  thresholdMs?: number | (() => number);
  now?: () => number;
} & (
  | { onSample: ReportSample; prepareSample?: never }
  | { onSample?: never; prepareSample: () => ReportSample }
);

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

export function isLikelySystemSuspensionDelay(args: {
  gapMs: number;
  intervalMs: number;
}): boolean {
  return args.gapMs - args.intervalMs >= LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS;
}

async function readDarwinSleepWindow(): Promise<{
  sleepAt: number;
  wakeAt: number;
} | null> {
  try {
    const { stdout } = await execHostFile(
      "/usr/sbin/sysctl",
      ["-n", "kern.sleeptime", "kern.waketime"],
      {
        encoding: "utf8",
        timeout: DARWIN_SYSCTL_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 4_096,
      },
    );
    const [sleepAt, wakeAt] = Array.from(
      stdout.matchAll(/sec = (\d+), usec = (\d+)/g),
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

  let histogram = createEventLoopDelayHistogram();
  let stopped = false;
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
    const windowStart = previous;
    previous = current;
    const report = args.prepareSample ? args.prepareSample() : args.onSample;
    const thresholdMs =
      typeof args.thresholdMs === "function"
        ? args.thresholdMs()
        : (args.thresholdMs ?? EVENT_LOOP_STALL_THRESHOLD_MS);
    const windowHistogram = histogram;
    const finishSample = (durationMs: number) => {
      if (stopped) return;
      const delay = windowHistogram.take();
      report({
        suspension:
          durationMs >= LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS
            ? {
                intervalMs: EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS,
                durationMs: roundDurationMs(durationMs),
                wallGapMs: roundDurationMs(wallGapMs),
                monotonicGapMs: roundDurationMs(monotonicGapMs),
                processCpuMs: roundDurationMs(processCpuMs),
              }
            : null,
        stall:
          delay.maxDelayMs >= thresholdMs
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
    };

    if (darwinGaps.length > 0) {
      const pendingGaps = darwinGaps.splice(0);
      histogram = createEventLoopDelayHistogram();
      const sleepWindow =
        Math.abs(wallGapMs - monotonicGapMs) <= SUSPENSION_CLOCK_TOLERANCE_MS
          ? readDarwinSleepWindow()
          : Promise.resolve(null);
      void sleepWindow.then((sleep) => {
        const durationMs =
          sleep &&
          sleep.sleepAt >= windowStart.wallMs &&
          sleep.wakeAt <= current.wallMs &&
          canAccountForCpu(monotonicGapMs - (sleep.wakeAt - sleep.sleepAt))
            ? sleep.wakeAt - sleep.sleepAt
            : 0;
        for (const { startedAt, endedAt } of pendingGaps) {
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
          windowHistogram.record(startedAt, endedAt - overlapMs);
        }
        finishSample(durationMs);
      });
      return;
    }

    const linuxSuspensionMs =
      current.linuxUptimeMs - windowStart.linuxUptimeMs - monotonicGapMs;
    finishSample(
      platform === "linux" &&
        monotonicGapMs >= 0 &&
        linuxSuspensionMs >= LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS &&
        canAccountForCpu(monotonicGapMs)
        ? linuxSuspensionMs
        : 0,
    );
  }, EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS);
  interval.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(interval);
      gaps.stop();
    },
  };
}
