import { describe, expect, it, vi } from "vitest";
import {
  startHostDaemonHealthMonitor,
  type HostDaemonResourceUsage,
} from "./host-daemon-health-monitor.js";

interface CapturedTimer {
  callback: () => void;
  cleared: boolean;
  unrefed: boolean;
}

function createMonitorHarness(
  usage: HostDaemonResourceUsage,
  options: { inotifyInstanceWarnThreshold?: number } = {},
) {
  const debug = vi.fn();
  const warn = vi.fn();
  const timer: CapturedTimer = {
    callback: () => undefined,
    cleared: false,
    unrefed: false,
  };
  const monitor = startHostDaemonHealthMonitor({
    logger: { debug, warn },
    getWatchCounts: () => ({ workspaceWatches: 3, threadStorageTargets: 5 }),
    readResourceUsage: () => usage,
    inotifyInstanceWarnThreshold: options.inotifyInstanceWarnThreshold,
    setIntervalFn: (callback) => {
      timer.callback = callback;
      return {
        clear: () => {
          timer.cleared = true;
        },
        unref: () => {
          timer.unrefed = true;
        },
      };
    },
  });
  return { debug, warn, timer, monitor };
}

describe("startHostDaemonHealthMonitor", () => {
  it("debug-logs resource and watch metrics on each tick", () => {
    const { debug, timer } = createMonitorHarness({
      rssBytes: 123,
      openFds: 42,
      inotifyInstances: 1,
      threads: 11,
    });

    timer.callback();

    expect(debug).toHaveBeenCalledWith(
      {
        rssBytes: 123,
        openFds: 42,
        inotifyInstances: 1,
        threads: 11,
        workspaceWatches: 3,
        threadStorageTargets: 5,
      },
      "Host daemon health",
    );
  });

  it("warns when the inotify instance count indicates leaked watchers", () => {
    const { warn, timer } = createMonitorHarness(
      { rssBytes: 1, openFds: 200, inotifyInstances: 17, threads: 40 },
      { inotifyInstanceWarnThreshold: 8 },
    );

    timer.callback();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatchObject({
      inotifyInstances: 17,
      warnThreshold: 8,
    });
  });

  it("does not warn when the inotify count is healthy or unavailable", () => {
    const healthy = createMonitorHarness(
      { rssBytes: 1, openFds: 30, inotifyInstances: 2, threads: 11 },
      { inotifyInstanceWarnThreshold: 8 },
    );
    healthy.timer.callback();
    expect(healthy.warn).not.toHaveBeenCalled();

    const unavailable = createMonitorHarness({
      rssBytes: 1,
      openFds: null,
      inotifyInstances: null,
      threads: null,
    });
    unavailable.timer.callback();
    expect(unavailable.warn).not.toHaveBeenCalled();
    expect(unavailable.debug).toHaveBeenCalledTimes(1);
  });

  it("stops the interval timer on stop()", () => {
    const { monitor, timer } = createMonitorHarness({
      rssBytes: 1,
      openFds: 1,
      inotifyInstances: 1,
      threads: 1,
    });
    expect(timer.unrefed).toBe(true);
    monitor.stop();
    expect(timer.cleared).toBe(true);
  });
});
