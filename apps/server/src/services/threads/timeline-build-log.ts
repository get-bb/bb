import type { ServerLogger } from "../../types.js";
import type { ThreadTimelineBuildProfile } from "./timeline.js";

/**
 * A timeline build is synchronous SQLite reads plus a pure JS projection, so
 * its duration is time the server's single event loop is blocked outright.
 * That does not only delay the requesting client: the daemon awaits
 * `/internal/session/events` before every dynamic tool call and before
 * registering every interactive request, so a build this slow directly stalls
 * agent work on *every* thread on the host, not just this one.
 *
 * The threshold sits well under the 1s slow-request threshold because the
 * damage here is cumulative rather than per-request — during a streaming turn
 * the client refetches back-to-back, so a repeated 150ms build can pin the loop
 * indefinitely while never once looking like a slow request.
 */
const SLOW_THREAD_TIMELINE_BUILD_LOG_THRESHOLD_MS = 150;

/**
 * Per-thread quiet period between slow-build lines.
 *
 * The condition being reported is sustained, not incidental: a viewed long
 * thread rebuilds back-to-back for the whole turn, so logging every occurrence
 * would emit on the order of a line per second per thread — burying the rest of
 * the log in exactly the situation where the rest of the log matters. One line
 * per thread per interval is enough to see that it is happening and how bad it
 * is.
 */
const SLOW_THREAD_TIMELINE_BUILD_LOG_INTERVAL_MS = 30_000;

/** Bounds the throttle map on a server that views very many threads. */
const SLOW_THREAD_TIMELINE_BUILD_LOG_MAX_TRACKED_THREADS = 256;

interface LogSlowThreadTimelineBuildArgs {
  profile: ThreadTimelineBuildProfile;
  threadId: string;
}

interface SlowThreadTimelineBuildLogger {
  log(args: LogSlowThreadTimelineBuildArgs): void;
}

interface CreateSlowThreadTimelineBuildLoggerOptions {
  logger: Pick<ServerLogger, "info">;
  /** Injectable for tests; defaults to wall clock. */
  now?: () => number;
}

export function createSlowThreadTimelineBuildLogger(
  options: CreateSlowThreadTimelineBuildLoggerOptions,
): SlowThreadTimelineBuildLogger {
  const now = options.now ?? (() => Date.now());
  const lastLoggedAtByThread = new Map<string, number>();
  // Builds suppressed since the last emitted line, so a throttled log still
  // conveys the rate rather than looking like a one-off.
  const suppressedByThread = new Map<string, number>();

  return {
    log({ profile, threadId }) {
      if (
        profile.totalDurationMs < SLOW_THREAD_TIMELINE_BUILD_LOG_THRESHOLD_MS
      ) {
        return;
      }
      const at = now();
      const lastLoggedAt = lastLoggedAtByThread.get(threadId);
      if (
        lastLoggedAt !== undefined &&
        at - lastLoggedAt < SLOW_THREAD_TIMELINE_BUILD_LOG_INTERVAL_MS
      ) {
        suppressedByThread.set(
          threadId,
          (suppressedByThread.get(threadId) ?? 0) + 1,
        );
        return;
      }

      const suppressedSinceLastLog = suppressedByThread.get(threadId) ?? 0;
      suppressedByThread.delete(threadId);
      lastLoggedAtByThread.delete(threadId);
      lastLoggedAtByThread.set(threadId, at);
      while (
        lastLoggedAtByThread.size >
        SLOW_THREAD_TIMELINE_BUILD_LOG_MAX_TRACKED_THREADS
      ) {
        const oldest = lastLoggedAtByThread.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        lastLoggedAtByThread.delete(oldest);
        suppressedByThread.delete(oldest);
      }

      options.logger.info(
        {
          threadId,
          totalDurationMs: profile.totalDurationMs,
          thresholdMs: SLOW_THREAD_TIMELINE_BUILD_LOG_THRESHOLD_MS,
          suppressedSinceLastLog,
          // `selectionStrategy: "full"` means segment windowing did not engage
          // and the whole thread was reprojected — the first thing to check.
          selectionStrategy: profile.selectionStrategy,
          pageKind: profile.pageKind,
          segmentLimit: profile.segmentLimit,
          eventRowCount: profile.eventRowCount,
          eventDataBytes: profile.eventDataBytes,
          decodedEventCount: profile.decodedEventCount,
          projectedRowCount: profile.projectedRowCount,
          responseRowCount: profile.responseRowCount,
          stageTimings: profile.stageTimings,
        },
        "Thread timeline build blocked the event loop",
      );
    },
  };
}
