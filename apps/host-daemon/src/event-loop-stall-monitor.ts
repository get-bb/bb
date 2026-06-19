import { monitorEventLoopDelay } from "node:perf_hooks";
import type { HostDaemonLogger } from "./logger.js";

interface EventLoopStallMonitorOptions {
  logger: Pick<HostDaemonLogger, "warn">;
}

interface EventLoopStallMonitor {
  stop: () => void;
}

const DEFAULT_EVENT_LOOP_STALL_LOG_THRESHOLD_MS = 500;
const DEFAULT_EVENT_LOOP_STALL_MONITOR_INTERVAL_MS = 5_000;
const DEFAULT_EVENT_LOOP_STALL_MONITOR_RESOLUTION_MS = 20;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

function nanosecondsToMilliseconds(durationNs: number): number {
  return durationNs / NANOSECONDS_PER_MILLISECOND;
}

function roundDurationMs(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

export function startEventLoopStallMonitor(
  options: EventLoopStallMonitorOptions,
): EventLoopStallMonitor {
  const thresholdMs = DEFAULT_EVENT_LOOP_STALL_LOG_THRESHOLD_MS;
  const intervalMs = DEFAULT_EVENT_LOOP_STALL_MONITOR_INTERVAL_MS;
  const resolutionMs = DEFAULT_EVENT_LOOP_STALL_MONITOR_RESOLUTION_MS;
  const histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  histogram.enable();

  const timer = setInterval(() => {
    const maxDelayMs = nanosecondsToMilliseconds(histogram.max);
    if (maxDelayMs >= thresholdMs) {
      options.logger.warn(
        {
          intervalMs,
          maxDelayMs: roundDurationMs(maxDelayMs),
          meanDelayMs: roundDurationMs(
            nanosecondsToMilliseconds(histogram.mean),
          ),
          p99DelayMs: roundDurationMs(
            nanosecondsToMilliseconds(histogram.percentile(99)),
          ),
          resolutionMs,
          thresholdMs,
        },
        "Host daemon event loop stalled",
      );
    }
    histogram.reset();
  }, intervalMs);
  timer.unref();

  return {
    stop: () => {
      clearInterval(timer);
      histogram.disable();
    },
  };
}
