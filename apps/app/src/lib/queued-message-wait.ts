import type { QueuedMessagePayload, QueuedMessageWaitingOn } from "@bb/domain";
import { formatScheduledTime } from "@/lib/relative-time";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The remaining wait as a coarse countdown ("in 45s", "in 3m", "in 3h",
 * "in 2d"), or null once the instant is due.
 *
 * Coarse on purpose: the row is a status line, not a timer, and a per-second
 * hours-long countdown would redraw the whole pending region every tick for a
 * digit nobody is reading. Null at zero rather than "in 0s" because a due row
 * is waiting on the drain, not on the clock, and saying so would be a lie the
 * user could watch not come true.
 */
export function formatQueuedMessageCountdown(remainingMs: number): string | null {
  if (remainingMs <= 0) return null;
  if (remainingMs < MINUTE_MS) {
    return `in ${Math.ceil(remainingMs / 1000)}s`;
  }
  if (remainingMs < HOUR_MS) {
    return `in ${Math.floor(remainingMs / MINUTE_MS)}m`;
  }
  if (remainingMs < DAY_MS) {
    return `in ${Math.floor(remainingMs / HOUR_MS)}h`;
  }
  return `in ${Math.floor(remainingMs / DAY_MS)}d`;
}

/**
 * Whether "Send now" can do anything about this row's wait.
 *
 * Send-now re-runs the dispatch attempt with the plugin pass and the row's own
 * schedule skipped, so a `time` or `plugin` wait clears by definition. The core
 * waits split, and NOT along the "core vs plugin" line the name suggests:
 *
 * - `provisioning` and `interaction` re-park on every attempt regardless of how
 *   it was made, so send-now can only fail with a 409. Hide it.
 * - `thread-busy` is different. Send-now dispatches with `mode: "auto"`, which
 *   against a running thread resolves to a `join-turn` attempt, and the
 *   thread-busy check only fires for `start-turn`. So the wait genuinely
 *   clears — the message steers into the live turn. This is also the ordinary
 *   queued row, which has always offered Send now and must keep offering it.
 *
 * A null wait is a row written before waits were typed; it behaves as
 * `thread-busy`, which is what the server assumes for it everywhere else.
 */
export function isQueuedMessageSendNowAllowed(
  waitingOn: QueuedMessageWaitingOn | null,
): boolean {
  if (waitingOn === null) return true;
  switch (waitingOn.kind) {
    case "provisioning":
    case "interaction":
      return false;
    case "time":
    case "plugin":
    case "thread-busy":
      return true;
  }
}

/**
 * Whether a row has a wait worth a line of its own.
 *
 * Exists so a caller can decide to mount the ticking status line WITHOUT first
 * building the label — building it needs a clock, and reading the clock during
 * render is impure. {@link describeQueuedMessageWait} returns null exactly when
 * this returns false, so the two cannot disagree.
 */
export function queuedMessageHasWaitLine(args: {
  payload: QueuedMessagePayload;
  waitingOn: QueuedMessageWaitingOn | null;
}): boolean {
  if (args.payload.kind === "retry") return true;
  if (args.waitingOn === null) return false;
  return args.waitingOn.kind !== "thread-busy";
}

export interface DescribeQueuedMessageWaitArgs {
  now: number;
  payload: QueuedMessagePayload;
  /** Resolved manifest name for a `plugin` wait; the id is an acceptable fallback. */
  pluginDisplayName: string | null;
  sendAt: number | null;
  waitingOn: QueuedMessageWaitingOn | null;
}

/**
 * The one-line status a parked row shows above the composer, or null when the
 * row has nothing to explain and should render exactly as a queued message
 * always has.
 *
 * Null is the important case: an ordinary message queued behind a running turn
 * carries `thread-busy`, and "Waiting for the current turn" on every row of a
 * five-deep queue is noise that says only what the list header already says.
 * The rows that get a line are the ones a reader cannot otherwise explain.
 *
 * The live countdown is deliberately NOT part of this string — see
 * {@link queuedMessageCountdownInstant}. `now` is here only to decide whether a
 * scheduled instant needs a day qualifier ("Tomorrow 9:00"), which changes at
 * midnight rather than every second.
 */
export function describeQueuedMessageWait(
  args: DescribeQueuedMessageWaitArgs,
): string | null {
  // A retry speaks for itself before it speaks for its wait: it has no message
  // of its own, so "attempt 2" is the only thing that distinguishes it from
  // the failed turn already rendered above it in the timeline.
  if (args.payload.kind === "retry") {
    const parts = ["Retry", `attempt ${args.payload.attempt}`];
    if (args.sendAt !== null) {
      parts.push(formatScheduledTime({ now: args.now, timestamp: args.sendAt }));
    }
    return parts.join(" · ");
  }

  if (!queuedMessageHasWaitLine(args)) return null;
  if (args.waitingOn === null) return null;
  switch (args.waitingOn.kind) {
    case "thread-busy":
      return null;
    case "time":
      return args.sendAt === null
        ? "Scheduled"
        : `Scheduled · ${formatScheduledTime({ now: args.now, timestamp: args.sendAt })}`;
    case "provisioning":
      return "Waiting for workspace";
    case "interaction":
      return "Waiting for reply";
    case "plugin":
      return `Held by ${args.pluginDisplayName ?? args.waitingOn.pluginId} · ${args.waitingOn.reason}`;
  }
}

/**
 * The instant a row should tick a live countdown towards, or null when it has
 * nothing to count down to.
 *
 * This is what keeps the 1 Hz ticker off the ordinary queue. Only a `time` wait
 * changes second to second; every other row's line is static text, so only
 * scheduled rows mount the subscribing component. A retry's `sendAt` is
 * deliberately excluded — its line already names the attempt, and a second
 * ticking clock on a row the user cannot act on differently is noise.
 */
export function queuedMessageCountdownInstant(args: {
  payload: QueuedMessagePayload;
  sendAt: number | null;
  waitingOn: QueuedMessageWaitingOn | null;
}): number | null {
  if (args.payload.kind === "retry") return null;
  if (args.waitingOn === null || args.waitingOn.kind !== "time") return null;
  return args.sendAt;
}
