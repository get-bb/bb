const LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS = 60_000;

/**
 * Long timer gaps on a laptop are overwhelmingly process suspension during
 * system sleep, not JavaScript monopolizing the event loop. Keep sub-minute
 * delays visible as real stalls while preventing a wake from flooding the log
 * with event-loop and heartbeat warnings for time the process did not run.
 */
export function isLikelySystemSuspensionDelay(args: {
  gapMs: number;
  intervalMs: number;
}): boolean {
  return args.gapMs - args.intervalMs >= LIKELY_SYSTEM_SUSPENSION_MIN_DELAY_MS;
}
