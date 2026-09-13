import { monitorEventLoopDelay } from "node:perf_hooks";

interface EventLoopStall {
  intervalMs: number;
  maxDelayMs: number;
  meanDelayMs: number;
  p99DelayMs: number;
  resolutionMs: number;
  thresholdMs: number;
}

interface StartEventLoopDelaySamplerArgs {
  now?: () => number;
  onSample: (sample: { stall: EventLoopStall | null }) => void;
}

interface EventLoopDelaySampler {
  stop: () => void;
}

const EVENT_LOOP_STALL_THRESHOLD_MS = 500;
const EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS = 5_000;
const EVENT_LOOP_DELAY_RESOLUTION_MS = 20;
const LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS = 60_000;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

function nanosecondsToMilliseconds(durationNs: number): number {
  return durationNs / NANOSECONDS_PER_MILLISECOND;
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
  const histogram = monitorEventLoopDelay({
    resolution: EVENT_LOOP_DELAY_RESOLUTION_MS,
  });
  histogram.enable();
  let lastSampleAt = now();

  const interval = setInterval(() => {
    const sampledAt = now();
    const gapMs = sampledAt - lastSampleAt;
    lastSampleAt = sampledAt;
    const maxDelayMs = nanosecondsToMilliseconds(histogram.max);
    const stalled =
      !isLikelySystemSuspensionDelay({
        gapMs,
        intervalMs: EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS,
      }) && maxDelayMs >= EVENT_LOOP_STALL_THRESHOLD_MS;
    args.onSample({
      stall: stalled
        ? {
            intervalMs: EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS,
            maxDelayMs: roundDurationMs(maxDelayMs),
            meanDelayMs: roundDurationMs(
              nanosecondsToMilliseconds(histogram.mean),
            ),
            p99DelayMs: roundDurationMs(
              nanosecondsToMilliseconds(histogram.percentile(99)),
            ),
            resolutionMs: EVENT_LOOP_DELAY_RESOLUTION_MS,
            thresholdMs: EVENT_LOOP_STALL_THRESHOLD_MS,
          }
        : null,
    });
    histogram.reset();
  }, EVENT_LOOP_DELAY_SAMPLE_INTERVAL_MS);
  interval.unref();

  return {
    stop: () => {
      clearInterval(interval);
      histogram.disable();
    },
  };
}
