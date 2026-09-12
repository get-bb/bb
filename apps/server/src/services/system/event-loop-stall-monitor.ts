import { startEventLoopDelaySampler } from "@bb/process-utils";
import type { ServerLogger } from "../../types.js";
import { takeEventLoopWorkWindowSnapshot } from "./event-loop-work.js";

export interface EventLoopStallMonitorOptions {
  logger: Pick<ServerLogger, "info">;
  now?: () => number;
}

export interface EventLoopStallMonitor {
  stop: () => void;
}

export function startEventLoopStallMonitor(
  options: EventLoopStallMonitorOptions,
): EventLoopStallMonitor {
  return startEventLoopDelaySampler({
    now: options.now,
    onSample: ({ stall }) => {
      const work = takeEventLoopWorkWindowSnapshot();
      if (stall !== null)
        options.logger.info({ ...stall, ...work }, "Event loop stalled");
    },
  });
}
