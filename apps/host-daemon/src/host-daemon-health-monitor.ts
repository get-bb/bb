import fs from "node:fs";
import type { HostDaemonLogger } from "./logger.js";

/**
 * Periodically debug-logs host-daemon resource and watch metrics so a leak or wedge
 * is visible in the logs after the fact instead of needing a live post-mortem.
 *
 * The headline signal is the inotify instance count. `@parcel/watcher` shares a
 * single inotify backend across every watched path, so a healthy daemon needs
 * roughly one instance no matter how many paths it watches. A count that climbs
 * with uptime means dead, leaked watcher backends (each one a thread parked
 * forever in the native teardown after a `poll()` interruption), which both
 * leaks resources and means filesystem-driven updates have silently stopped.
 */

interface HostDaemonHealthMonitorTimer {
  clear(): void;
  unref(): void;
}

type HostDaemonHealthMonitorIntervalFn = (
  callback: () => void,
  intervalMs: number,
) => HostDaemonHealthMonitorTimer;

export interface HostDaemonWatchCounts {
  workspaceWatches: number;
  threadStorageTargets: number;
}

export interface HostDaemonResourceUsage {
  rssBytes: number;
  /** Open file descriptors, or null when unavailable (e.g. no /proc). */
  openFds: number | null;
  /** Live inotify instances, or null when unavailable. */
  inotifyInstances: number | null;
  /** OS thread count, or null when unavailable. */
  threads: number | null;
}

interface HostDaemonHealthMonitorOptions {
  logger: Pick<HostDaemonLogger, "debug" | "warn">;
  getWatchCounts: () => HostDaemonWatchCounts;
  readResourceUsage?: () => HostDaemonResourceUsage;
  setIntervalFn?: HostDaemonHealthMonitorIntervalFn;
  intervalMs?: number;
  inotifyInstanceWarnThreshold?: number;
}

interface HostDaemonHealthMonitor {
  stop(): void;
}

const DEFAULT_HEALTH_MONITOR_INTERVAL_MS = 60_000;
// Headroom above the ~1 shared backend a healthy daemon needs, so brief
// overlaps during watch-set churn do not warn but a real leak does.
const DEFAULT_INOTIFY_INSTANCE_WARN_THRESHOLD = 8;

function countInotifyInstances(fds: string[]): number {
  let count = 0;
  for (const fd of fds) {
    try {
      if (fs.readlinkSync(`/proc/self/fd/${fd}`).includes("inotify")) {
        count += 1;
      }
    } catch {
      // The fd may close between listing and reading; ignore it.
    }
  }
  return count;
}

export function defaultReadResourceUsage(): HostDaemonResourceUsage {
  const rssBytes = process.memoryUsage().rss;
  let openFds: number | null = null;
  let inotifyInstances: number | null = null;
  let threads: number | null = null;
  try {
    const fds = fs.readdirSync("/proc/self/fd");
    openFds = fds.length;
    inotifyInstances = countInotifyInstances(fds);
  } catch {
    // /proc is unavailable (non-Linux); leave fd metrics null.
  }
  try {
    threads = fs.readdirSync("/proc/self/task").length;
  } catch {
    // /proc is unavailable; leave thread count null.
  }
  return { rssBytes, openFds, inotifyInstances, threads };
}

export function startHostDaemonHealthMonitor(
  options: HostDaemonHealthMonitorOptions,
): HostDaemonHealthMonitor {
  const intervalMs = options.intervalMs ?? DEFAULT_HEALTH_MONITOR_INTERVAL_MS;
  const inotifyInstanceWarnThreshold =
    options.inotifyInstanceWarnThreshold ??
    DEFAULT_INOTIFY_INSTANCE_WARN_THRESHOLD;
  const readResourceUsage =
    options.readResourceUsage ?? defaultReadResourceUsage;
  const setIntervalFn: HostDaemonHealthMonitorIntervalFn =
    options.setIntervalFn ??
    ((callback, ms) => {
      const timer = setInterval(callback, ms);
      return {
        clear: () => clearInterval(timer),
        unref: () => timer.unref(),
      };
    });

  const timer = setIntervalFn(() => {
    const usage = readResourceUsage();
    const watchCounts = options.getWatchCounts();
    const fields = {
      rssBytes: usage.rssBytes,
      openFds: usage.openFds,
      inotifyInstances: usage.inotifyInstances,
      threads: usage.threads,
      workspaceWatches: watchCounts.workspaceWatches,
      threadStorageTargets: watchCounts.threadStorageTargets,
    };
    options.logger.debug(fields, "Host daemon health");
    if (
      usage.inotifyInstances !== null &&
      usage.inotifyInstances > inotifyInstanceWarnThreshold
    ) {
      options.logger.warn(
        {
          inotifyInstances: usage.inotifyInstances,
          threads: usage.threads,
          warnThreshold: inotifyInstanceWarnThreshold,
        },
        "Host daemon inotify instance count is high; filesystem watchers are likely leaking (dead backends after poll interruptions)",
      );
    }
  }, intervalMs);
  timer.unref();

  return {
    stop() {
      timer.clear();
    },
  };
}
