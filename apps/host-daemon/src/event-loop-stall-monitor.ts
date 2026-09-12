import { startEventLoopDelaySampler } from "@bb/process-utils";
import type { HostDaemonLogger } from "./logger.js";

interface EventLoopStallMonitorOptions {
  logger: Pick<HostDaemonLogger, "warn">;
  now?: () => number;
}

interface EventLoopStallMonitor {
  stop: () => void;
}

export function startEventLoopStallMonitor(
  options: EventLoopStallMonitorOptions,
): EventLoopStallMonitor {
  return startEventLoopDelaySampler({
    now: options.now,
    onSample: ({ stall }) => {
      if (stall !== null)
        options.logger.warn(stall, "Host daemon event loop stalled");
    },
  });
}
