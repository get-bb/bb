import { startEventLoopDelaySampler } from "@bb/process-utils";
import type { ServerLogger } from "../../types.js";
import { takeEventLoopWorkWindowSnapshot } from "./event-loop-work.js";

export interface EventLoopStallMonitorOptions {
  logger: Pick<ServerLogger, "info">;
  now?: () => number;
  thresholdMs?: number | (() => number);
}

export interface EventLoopStallMonitor {
  stop: () => void;
}

export function startEventLoopStallMonitor(
  options: EventLoopStallMonitorOptions,
): EventLoopStallMonitor {
  return startEventLoopDelaySampler({
    now: options.now,
    thresholdMs: options.thresholdMs,
    prepareSample: () => {
      const work = takeEventLoopWorkWindowSnapshot();
      return ({ stall, suspension }) => {
        if (suspension !== null)
          options.logger.info(suspension, "System suspension observed");
        if (stall !== null) {
          const hasCandidate =
            work.longestSynchronousWorkWallMs !== null &&
            work.longestSynchronousWorkWallMs + stall.resolutionMs >=
              stall.maxDelayMs;
          options.logger.info(
            {
              ...stall,
              ...work,
              stallAttribution: hasCandidate ? "candidate" : "unattributed",
              stallCauseCandidate: hasCandidate
                ? work.longestSynchronousWork
                : null,
            },
            "Event loop stalled",
          );
        }
      };
    },
  });
}
