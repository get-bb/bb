import { describe, expect, it } from "vitest";
import type { QueuedMessageWaitingOn, ThreadStatus } from "@bb/domain";
import {
  describeQueuedMessageWait,
  formatQueuedMessageCountdown,
  isQueuedMessageSendNowAllowed,
  queuedMessageCountdownInstant,
  queuedMessageFallbackTitle,
  queuedMessageHasWaitLine,
  queuedMessageWaitIcon,
} from "./queued-message-wait";

const NOW = new Date(2026, 7, 28, 9, 0, 0).getTime();

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
    threadStatus?: ThreadStatus;
  } = {},
): string | null {
  return describeQueuedMessageWait({
    failureReason: overrides.failureReason ?? null,
    now: overrides.now ?? NOW,
    payload: { kind: "inline" },
    pluginDisplayName: overrides.pluginDisplayName ?? null,
    sendAt: overrides.sendAt ?? null,
    threadStatus: overrides.threadStatus ?? "active",
    waitingOn,
  });
}

describe("describeQueuedMessageWait", () => {
  it("leaves an ordinary queued message unexplained", () => {
    expect(describeWait({ kind: "thread-busy" })).toBeNull();
    expect(describeWait(null)).toBeNull();
  });

  it("names each core wait a reader cannot otherwise explain", () => {
    expect(describeWait({ kind: "stopping" })).toBe(
      "Sending when the thread stops",
    );
    expect(describeWait({ kind: "turn-starting" })).toBe(
      "Waiting for turn to start",
    );
    expect(describeWait({ kind: "provisioning" })).toBe(
      "Waiting for workspace",
    );
    expect(describeWait({ kind: "interaction" })).toBe(
      "Waiting for your reply",
    );
  });

  it("stops promising a turn start once the thread's run has failed", () => {
    expect(
      describeWait({ kind: "turn-starting" }, { threadStatus: "error" }),
    ).toBe("Turn didn't start · sends on the next turn");
  });

  it("names the absent machine a host-offline row is waiting on", () => {
    expect(describeWait({ kind: "host-offline", hostName: "M4" })).toBe(
      "Waiting for M4 to be ready",
    );
  });

  it("lets a failure outrank the wait the row is still waiting on", () => {
    expect(
      describeWait(
        { kind: "thread-busy" },
        { failureReason: "Host is not connected" },
      ),
    ).toBe("Host is not connected");
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
    expect(describeWait(waitingOn)).toBe(
      "Held by concurrency-limit · 4 of 4 running",
    );
  });

  it("carries the scheduled instant but never the countdown", () => {
    const label = describeWait({ kind: "time" }, { sendAt: NOW + 3 * HOUR });
    expect(label).toBe(`Scheduled for ${clockAt(NOW + 3 * HOUR)}`);
    expect(label).not.toMatch(/\bin \d/);
    expect(describeWait({ kind: "time" })).toBe("Scheduled");
  });

  it("leads a retry with why it is being retried, then when and which attempt", () => {
    expect(
      describeQueuedMessageWait({
        failureReason: null,
        now: NOW,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
        pluginDisplayName: null,
        sendAt: NOW + HOUR,
        threadStatus: "active",
        waitingOn: { kind: "time" },
      }),
    ).toBe(`Rate limited · retrying at ${clockAt(NOW + HOUR)} · attempt 2`);
    expect(
      describeQueuedMessageWait({
        failureReason: null,
        now: NOW,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
        pluginDisplayName: "Concurrency limit",
        sendAt: null,
        threadStatus: "active",
        waitingOn: {
          kind: "plugin",
          pluginId: "concurrency-limit",
          reason: "2 of 2 running on all hosts",
        },
      }),
    ).toBe(
      "Rate limited · held by Concurrency limit · 2 of 2 running on all hosts · attempt 2",
    );
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
    expect(icon({ kind: "turn-starting" })).toBe("TimeSchedule");
    expect(icon({ kind: "provisioning" })).toBe("Folder");
    expect(icon({ kind: "host-offline", hostName: "M4" })).toBe("CloudOff");
    expect(icon({ kind: "interaction" })).toBe("CircleQuestion");
    expect(icon({ kind: "plugin", pluginId: "p", reason: "r" })).toBeNull();
    expect(icon({ kind: "thread-busy" })).toBeNull();
    expect(icon(null)).toBeNull();
    expect(icon({ kind: "time" }, "Host is not connected")).toBe("AlertCircle");
  });

  it("marks a retry with the reload glyph regardless of its wait", () => {
    expect(
      queuedMessageWaitIcon({
        failureReason: null,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
        waitingOn: { kind: "plugin", pluginId: "provider-retry", reason: "r" },
      }),
    ).toBe("RotateCcw");
  });
});

describe("queuedMessageFallbackTitle", () => {
  it("names the failed turn a retry row re-submits", () => {
    expect(
      queuedMessageFallbackTitle({
        createdAt: NOW,
        now: NOW,
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
      }),
    ).toBe(`Retry failed turn from ${clockAt(NOW)}`);
  });

  it("titles a restart resume as a resume, with when it resumes and which attempt", () => {
    const payload = {
      kind: "retry" as const,
      retryOfTurnRequestId: "req-1",
      attempt: 3,
      reason: "bb restarted",
    };
    expect(
      queuedMessageFallbackTitle({ createdAt: NOW, now: NOW, payload }),
    ).toBe("Resume after bb restarted");
    expect(
      describeQueuedMessageWait({
        failureReason: null,
        now: NOW,
        payload,
        pluginDisplayName: null,
        sendAt: NOW + 5_000,
        threadStatus: "idle",
        waitingOn: { kind: "time" },
      }),
    ).toBe(`resuming at ${clockAt(NOW + 5_000)} · attempt 3`);
  });
});

describe("isQueuedMessageSendNowAllowed", () => {
  it.each([
    { waitingOn: null, allowed: true },
    { waitingOn: { kind: "time" }, allowed: true },
    {
      waitingOn: { kind: "plugin", pluginId: "limiter", reason: "busy" },
      allowed: true,
    },
    { waitingOn: { kind: "thread-busy" }, allowed: true },
    { waitingOn: { kind: "stopping" }, allowed: false },
    { waitingOn: { kind: "turn-starting" }, allowed: false },
    { waitingOn: { kind: "provisioning" }, allowed: false },
    { waitingOn: { kind: "interaction" }, allowed: false },
    { waitingOn: { kind: "host-offline", hostName: "M4" }, allowed: false },
  ] as const)(
    "allows manual recovery for $waitingOn",
    ({ waitingOn, allowed }) => {
      expect(
        isQueuedMessageSendNowAllowed({ waitingOn, failureReason: null }),
      ).toBe(allowed);
      expect(
        isQueuedMessageSendNowAllowed({
          waitingOn,
          failureReason: "Provider unavailable",
        }),
      ).toBe(true);
    },
  );
});

describe("formatQueuedMessageCountdown", () => {
  it("stays silent once the instant is due", () => {
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
        payload: {
          kind: "retry",
          retryOfTurnRequestId: "req-1",
          attempt: 2,
          reason: "Rate limited",
        },
        sendAt: NOW + HOUR,
        waitingOn: { kind: "time" },
      }),
    ).toBeNull();
  });
});
