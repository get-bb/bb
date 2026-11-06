import { createHistogram } from "node:perf_hooks";
import {
  EVENT_LOOP_GAP_INTERVAL_MS,
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

interface StartEventLoopDelaySamplerArgs {
  thresholdMs?: number | (() => number);
  now?: () => number;
  onSample: (sample: { stall: EventLoopStall | null }) => void;
}

interface EventLoopDelaySampler {
  stop: () => void;
}

const EVENT_LOOP_STALL_THRESHOLD_MS = 500;
const EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS = 5_000;
const LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS = 60_000;
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

export function startEventLoopDelaySampler(
  args: StartEventLoopDelaySamplerArgs,
): EventLoopDelaySampler {
  const now = args.now ?? (() => Date.now());
  const histogram = createEventLoopDelayHistogram();
  const gaps = observeEventLoopGaps(histogram.record);
  let lastSampleAt = now();

  const interval = setInterval(() => {
    const sampledAt = now();
    const gapMs = sampledAt - lastSampleAt;
    lastSampleAt = sampledAt;
    gaps.flush();
    const delay = histogram.take();
    const thresholdMs =
      typeof args.thresholdMs === "function"
        ? args.thresholdMs()
        : (args.thresholdMs ?? EVENT_LOOP_STALL_THRESHOLD_MS);
    const stalled =
      !isLikelySystemSuspensionDelay({
        gapMs,
        intervalMs: EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS,
      }) && delay.maxDelayMs >= thresholdMs;
    args.onSample({
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
