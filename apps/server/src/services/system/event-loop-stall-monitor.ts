import { monitorEventLoopDelay } from "node:perf_hooks";
import { roundDurationMs } from "../lib/duration.js";
import type { ServerLogger } from "../../types.js";
import { takeEventLoopWorkWindowSnapshot } from "./event-loop-work.js";

export interface EventLoopStallMonitorOptions {
  logger: Pick<ServerLogger, "info">;
}

export interface EventLoopStallMonitor {
  stop: () => void;
}

const DEFAULT_EVENT_LOOP_STALL_LOG_THRESHOLD_MS = 500;
const DEFAULT_EVENT_LOOP_STALL_MONITOR_INTERVAL_MS = 5_000;
const DEFAULT_EVENT_LOOP_STALL_MONITOR_RESOLUTION_MS = 20;
const NANOSECONDS_PER_MILLISECOND = 1_000_000;

function nanosecondsToMilliseconds(durationNs: number): number {
  return durationNs / NANOSECONDS_PER_MILLISECOND;
}

export function startEventLoopStallMonitor(
  options: EventLoopStallMonitorOptions,
): EventLoopStallMonitor {
  const histogram = monitorEventLoopDelay({
    resolution: DEFAULT_EVENT_LOOP_STALL_MONITOR_RESOLUTION_MS,
  });
  histogram.enable();

  const interval = setInterval(() => {
    const maxDelayMs = nanosecondsToMilliseconds(histogram.max);
    const work = takeEventLoopWorkWindowSnapshot();
    if (maxDelayMs >= DEFAULT_EVENT_LOOP_STALL_LOG_THRESHOLD_MS) {
      // `info`, not `debug`: the packaged app runs at `info`, so a `debug` line
      // here is unreachable in production — which is exactly where a stalled
      // loop matters. A stall this long blocks the daemon-facing
      // `/internal/session/events` POST that the agent awaits before every
      // dynamic tool call and interactive request, so it delays real agent
      // work, not just UI refreshes. Threshold-gated, so a healthy server
      // stays silent.
      // currentWork is still in flight. lastWork is the latest finish.
      // slowestWork is the longest unit in this histogram window, so a later
      // heartbeat cannot hide the block that produced histogram.max.
      options.logger.info(
        {
          intervalMs: DEFAULT_EVENT_LOOP_STALL_MONITOR_INTERVAL_MS,
          maxDelayMs: roundDurationMs(maxDelayMs),
          meanDelayMs: roundDurationMs(
            nanosecondsToMilliseconds(histogram.mean),
          ),
          p99DelayMs: roundDurationMs(
            nanosecondsToMilliseconds(histogram.percentile(99)),
          ),
          resolutionMs: DEFAULT_EVENT_LOOP_STALL_MONITOR_RESOLUTION_MS,
          thresholdMs: DEFAULT_EVENT_LOOP_STALL_LOG_THRESHOLD_MS,
          ...work,
        },
        "Event loop stalled",
      );
    }
    histogram.reset();
  }, DEFAULT_EVENT_LOOP_STALL_MONITOR_INTERVAL_MS);
  interval.unref();

  return {
    stop: () => {
      clearInterval(interval);
      histogram.disable();
    },
  };
}
