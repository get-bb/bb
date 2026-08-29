import { describe, expect, it } from "vitest";
import type { QueuedMessageWaitingOn } from "@bb/domain";
import {
  describeQueuedMessageWait,
  formatQueuedMessageCountdown,
  isQueuedMessageSendNowAllowed,
  queuedMessageCountdownInstant,
  queuedMessageFallbackTitle,
  queuedMessageHasWaitLine,
  queuedMessageWaitIcon,
} from "./queued-message-wait";

// Built from local parts so the expected clock strings do not depend on the
// runner's timezone. Aug 28 has no DST transition in the zones this runs in,
// so adding hours cannot shift the wall clock by an extra step.
const NOW = new Date(2026, 7, 28, 9, 0, 0).getTime();

/** The clock text `formatScheduledTime` will render, in the runner's locale. */
function clockAt(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function describeWait(
  waitingOn: QueuedMessageWaitingOn | null,
  overrides: {
    failureReason?: string | null;
    now?: number;
    pluginDisplayName?: string | null;
    sendAt?: number | null;
  } = {},
): string | null {
  return describeQueuedMessageWait({
    failureReason: overrides.failureReason ?? null,
    now: overrides.now ?? NOW,
    payload: { kind: "inline" },
    pluginDisplayName: overrides.pluginDisplayName ?? null,
    sendAt: overrides.sendAt ?? null,
    waitingOn,
  });
}

describe("describeQueuedMessageWait", () => {
  it("leaves an ordinary queued message unexplained", () => {
    // `thread-busy` IS the ordinary queued row — the server names the wait
    // rather than leaving it null. Labelling every row of a deep queue
    // "waiting for the current turn" would say only what the list header says.
    expect(describeWait({ kind: "thread-busy" })).toBeNull();
    // A row written before waits were typed behaves the same way.
    expect(describeWait(null)).toBeNull();
  });

  it("names each core wait a reader cannot otherwise explain", () => {
    expect(describeWait({ kind: "provisioning" })).toBe("Waiting for workspace");
    expect(describeWait({ kind: "interaction" })).toBe(
      "Waiting for your reply",
    );
  });

  it("names the absent machine a host-offline row is waiting on", () => {
    // The whole point of carrying the name on the wait: a user with two
    // enrolled machines cannot act on "waiting for the host".
    expect(describeWait({ kind: "host-offline", hostName: "M4" })).toBe(
      "Waiting for M4 to reconnect",
    );
  });

  it("lets a failure outrank the wait the row is still waiting on", () => {
    // The row keeps its wait — a failed drain does not clear its wait — but what a
    // reader needs first is that the last attempt did not go through.
    expect(
      describeWait(
        { kind: "thread-busy" },
        { failureReason: "Host is not connected" },
      ),
    ).toBe("Host is not connected");
    // ...including on a row whose wait would otherwise say nothing at all.
    expect(
      queuedMessageHasWaitLine({
        failureReason: "Host is not connected",
        payload: { kind: "inline" },
        waitingOn: { kind: "thread-busy" },
      }),
    ).toBe(true);
  });

  it("attributes a plugin wait by display name, falling back to its id", () => {
    const waitingOn: QueuedMessageWaitingOn = {
      kind: "plugin",
      pluginId: "concurrency-limit",
      reason: "4 of 4 running",
    };
    expect(
      describeWait(waitingOn, { pluginDisplayName: "Concurrency Limit" }),
    ).toBe("Held by Concurrency Limit · 4 of 4 running");
    // An unresolved manifest must still attribute the wait to someone.
    expect(describeWait(waitingOn)).toBe(
      "Held by concurrency-limit · 4 of 4 running",
    );
  });

  it("carries the scheduled instant but never the countdown", () => {
    // The countdown is rendered by a separate ticking component, so a label
    // that baked it in would be stale the second after it was built.
    const label = describeWait({ kind: "time" }, { sendAt: NOW + 3 * HOUR });
    expect(label).toBe(`Scheduled for ${clockAt(NOW + 3 * HOUR)}`);
    expect(label).not.toMatch(/\bin \d/);
    expect(describeWait({ kind: "time" })).toBe("Scheduled");
  });

  it("leads a retry with why the turn failed, then when and which attempt", () => {
    // A retry row is waiting on the retry policy's own plugin wait, so its
    // reason IS the failure that caused the retry — the most useful thing the
    // row can say about itself, since it has no message of its own to show.
    expect(
      describeQueuedMessageWait({
        failureReason: null,
        now: NOW,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
        },
        pluginDisplayName: null,
        sendAt: NOW + HOUR,
        waitingOn: {
          kind: "plugin",
          pluginId: "provider-retry",
          reason: "Rate limited",
        },
      }),
    ).toBe(`Rate limited · retrying at ${clockAt(NOW + HOUR)} · attempt 2`);
  });
});

describe("queuedMessageWaitIcon", () => {
  it("gives every explained wait a glyph and the ordinary row none", () => {
    const icon = (
      waitingOn: QueuedMessageWaitingOn | null,
      failureReason: string | null = null,
    ) =>
      queuedMessageWaitIcon({
        failureReason,
        payload: { kind: "inline" },
        waitingOn,
      });

    expect(icon({ kind: "time" })).toBe("TimeSchedule");
    expect(icon({ kind: "provisioning" })).toBe("Folder");
    expect(icon({ kind: "host-offline", hostName: "M4" })).toBe("CloudOff");
    expect(icon({ kind: "interaction" })).toBe("CircleQuestion");
    expect(icon({ kind: "plugin", pluginId: "p", reason: "r" })).toBe(
      "Limitation",
    );
    // The ordinary queued row has no line, so it has no glyph either.
    expect(icon({ kind: "thread-busy" })).toBeNull();
    expect(icon(null)).toBeNull();
    // A failure is not a kind of waiting, so it overrides whatever the row is
    // still waiting on.
    expect(icon({ kind: "time" }, "Host is not connected")).toBe("AlertCircle");
  });

  it("marks a retry with the reload glyph regardless of its wait", () => {
    expect(
      queuedMessageWaitIcon({
        failureReason: null,
        payload: { kind: "retry", retryOfTurnRequestId: "req-1", attempt: 2 },
        waitingOn: { kind: "plugin", pluginId: "provider-retry", reason: "r" },
      }),
    ).toBe("RotateCcw");
  });
});

describe("queuedMessageFallbackTitle", () => {
  it("names the failed turn a retry row re-submits", () => {
    // A retry stores the original blocks as agent-only so the timeline does
    // not print the user's message twice, which leaves the row with nothing to
    // quote and only its origin to state.
    expect(
      queuedMessageFallbackTitle({
        createdAt: NOW,
        now: NOW,
        payload: { kind: "retry", retryOfTurnRequestId: "req-1", attempt: 2 },
      }),
    ).toBe(`Retry failed turn from ${clockAt(NOW)}`);
  });
});

describe("isQueuedMessageSendNowAllowed", () => {
  it("hides send-now only for the waits a re-attempt cannot clear", () => {
    // Send-now re-runs the attempt skipping the plugin pass and the schedule,
    // so these two clear by definition.
    expect(isQueuedMessageSendNowAllowed({ kind: "time" })).toBe(true);
    expect(
      isQueuedMessageSendNowAllowed({
        kind: "plugin",
        pluginId: "limiter",
        reason: "busy",
      }),
    ).toBe(true);
    // `thread-busy` clears too: send-now dispatches with mode "auto", which
    // against a running thread is a join-turn attempt, and the thread-busy
    // check only fires for start-turn. This is the ordinary queued row, which
    // has always offered Send now.
    expect(isQueuedMessageSendNowAllowed({ kind: "thread-busy" })).toBe(true);
    expect(isQueuedMessageSendNowAllowed(null)).toBe(true);
    // These two re-queue on every attempt regardless of how it was made, so
    // offering send-now could only produce a 409.
    expect(isQueuedMessageSendNowAllowed({ kind: "provisioning" })).toBe(false);
    expect(isQueuedMessageSendNowAllowed({ kind: "interaction" })).toBe(false);
    // Send-now cannot conjure a machine that is not connected either.
    expect(
      isQueuedMessageSendNowAllowed({ kind: "host-offline", hostName: "M4" }),
    ).toBe(false);
  });
});

describe("formatQueuedMessageCountdown", () => {
  it("stays silent once the instant is due", () => {
    // A due row waits on the drain, not the clock; "in 0s" would be a promise
    // the user could watch not come true.
    expect(formatQueuedMessageCountdown(0)).toBeNull();
    expect(formatQueuedMessageCountdown(-1)).toBeNull();
  });

  it("steps up a unit exactly at each boundary", () => {
    expect(formatQueuedMessageCountdown(1)).toBe("in 1s");
    expect(formatQueuedMessageCountdown(MINUTE - 1)).toBe("in 60s");
    expect(formatQueuedMessageCountdown(MINUTE)).toBe("in 1m");
    expect(formatQueuedMessageCountdown(HOUR - 1)).toBe("in 59m");
    expect(formatQueuedMessageCountdown(HOUR)).toBe("in 1h");
    expect(formatQueuedMessageCountdown(24 * HOUR - 1)).toBe("in 23h");
    expect(formatQueuedMessageCountdown(24 * HOUR)).toBe("in 1d");
  });
});

describe("queuedMessageCountdownInstant", () => {
  it("ticks only for a scheduled row", () => {
    // This is what keeps the shared 1 Hz ticker off an ordinary queue: every
    // other row's line is static text.
    expect(
      queuedMessageCountdownInstant({
        payload: { kind: "inline" },
        sendAt: NOW + HOUR,
        waitingOn: { kind: "time" },
      }),
    ).toBe(NOW + HOUR);
    expect(
      queuedMessageCountdownInstant({
        payload: { kind: "inline" },
        sendAt: NOW + HOUR,
        waitingOn: { kind: "provisioning" },
      }),
    ).toBeNull();
    expect(
      queuedMessageCountdownInstant({
        payload: { kind: "retry", retryOfTurnRequestId: "req-1", attempt: 2 },
        sendAt: NOW + HOUR,
        waitingOn: { kind: "time" },
      }),
    ).toBeNull();
  });
});
