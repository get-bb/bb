import { describe, expect, it } from "vitest";
import {
  canPark,
  nextWakeDelayMs,
  resolveShelf,
  resolveSnoozePresets,
  snoozeWakeLabel,
  MAX_TIMEOUT_MS,
  type ThreadActivitySignals,
  type ThreadLifecycleRow,
} from "./lifecycle";

const quiet: ThreadActivitySignals = {
  hasPendingInteraction: false,
  isWorking: false,
  isUnread: false,
  latestAttentionAt: 0,
};

const row = (
  overrides: Partial<ThreadLifecycleRow> = {},
): ThreadLifecycleRow => ({
  threadId: "thr_1",
  settledAt: null,
  snoozedUntil: null,
  snoozedAt: null,
  ...overrides,
});

describe("canPark", () => {
  it("refuses while the agent is blocked on the user", () => {
    expect(canPark({ ...quiet, hasPendingInteraction: true })).toBe(false);
  });

  // The trap this whole feature has to avoid: bb has more kinds of live work
  // than a session status, and parking any of them hides running work.
  it("refuses while any work is running", () => {
    expect(canPark({ ...quiet, isWorking: true })).toBe(false);
  });

  it("allows a quiet thread", () => {
    expect(canPark(quiet)).toBe(true);
  });
});

describe("resolveShelf", () => {
  it("keeps an unparked thread active", () => {
    expect(resolveShelf(undefined, quiet, 1_000)).toBe("active");
  });

  it("settles a parked, quiet thread", () => {
    expect(resolveShelf(row({ settledAt: 500 }), quiet, 1_000)).toBe("settled");
  });

  it("brings a settled thread back when it starts working", () => {
    expect(
      resolveShelf(
        row({ settledAt: 500 }),
        { ...quiet, isWorking: true },
        1_000,
      ),
    ).toBe("active");
  });

  it("brings a settled thread back when it asks a question", () => {
    expect(
      resolveShelf(
        row({ settledAt: 500 }),
        { ...quiet, hasPendingInteraction: true },
        1_000,
      ),
    ).toBe("active");
  });

  it("un-settles on new attention after the settle", () => {
    expect(
      resolveShelf(
        row({ settledAt: 500 }),
        { ...quiet, latestAttentionAt: 900 },
        1_000,
      ),
    ).toBe("active");
  });

  it("keeps a snoozed thread hidden until its wake time", () => {
    expect(
      resolveShelf(row({ snoozedUntil: 2_000, snoozedAt: 500 }), quiet, 1_000),
    ).toBe("snoozed");
  });

  it("wakes a snoozed thread when the timer elapses", () => {
    expect(
      resolveShelf(row({ snoozedUntil: 900, snoozedAt: 500 }), quiet, 1_000),
    ).toBe("active");
  });

  // "Something happened" wakes it early — otherwise snooze hides the exact
  // thing the user needed to see.
  it("wakes a snoozed thread early when it raises its hand", () => {
    expect(
      resolveShelf(
        row({ snoozedUntil: 5_000, snoozedAt: 500 }),
        { ...quiet, hasPendingInteraction: true },
        1_000,
      ),
    ).toBe("active");
    expect(
      resolveShelf(
        row({ snoozedUntil: 5_000, snoozedAt: 500 }),
        { ...quiet, latestAttentionAt: 800 },
        1_000,
      ),
    ).toBe("active");
  });

  it("does not wake on activity that predates the snooze", () => {
    expect(
      resolveShelf(
        row({ snoozedUntil: 5_000, snoozedAt: 900 }),
        { ...quiet, latestAttentionAt: 800 },
        1_000,
      ),
    ).toBe("snoozed");
  });
});

describe("snoozeWakeLabel", () => {
  it("rounds minutes up so a hidden thread never reads 0m", () => {
    expect(snoozeWakeLabel(1_000 + 1, 1_000)).toBe("1m");
    expect(snoozeWakeLabel(1_000 + 90_000, 1_000)).toBe("2m");
  });

  it("switches to hours and days", () => {
    expect(snoozeWakeLabel(1_000 + 2 * 3_600_000, 1_000)).toBe("2h");
    expect(snoozeWakeLabel(1_000 + 50 * 3_600_000, 1_000)).toBe("3d");
  });

  it("reads 'now' once the wake time has passed", () => {
    expect(snoozeWakeLabel(500, 1_000)).toBe("now");
  });
});

describe("resolveSnoozePresets", () => {
  it("offers this evening while it is still well before evening", () => {
    const presets = resolveSnoozePresets(new Date(2026, 0, 5, 9, 0, 0));
    expect(presets.map((preset) => preset.id)).toEqual([
      "hour",
      "evening",
      "tomorrow",
      "next-week",
    ]);
  });

  it("drops this evening once evening is near", () => {
    const presets = resolveSnoozePresets(new Date(2026, 0, 5, 17, 30, 0));
    expect(presets.map((preset) => preset.id)).toEqual([
      "hour",
      "tomorrow",
      "next-week",
    ]);
  });

  // Calendar arithmetic, not +24h: a fixed offset lands on the wrong local
  // day across a daylight-saving change.
  it("puts tomorrow at 9am on the next calendar day", () => {
    const presets = resolveSnoozePresets(new Date(2026, 0, 5, 23, 30, 0));
    const tomorrow = new Date(
      presets.find((preset) => preset.id === "tomorrow")!.snoozedUntil,
    );
    expect(tomorrow.getDate()).toBe(6);
    expect(tomorrow.getHours()).toBe(9);
  });

  it("puts next week on the coming Monday", () => {
    // 2026-01-05 is a Monday, so "next week" is the following Monday.
    const presets = resolveSnoozePresets(new Date(2026, 0, 5, 10, 0, 0));
    const nextWeek = new Date(
      presets.find((preset) => preset.id === "next-week")!.snoozedUntil,
    );
    expect(nextWeek.getDay()).toBe(1);
    expect(nextWeek.getDate()).toBe(12);
  });
});

describe("nextWakeDelayMs", () => {
  it("arms for the soonest upcoming wake", () => {
    expect(nextWakeDelayMs([5_000, 3_000, 9_000], 1_000)).toBe(2_050);
  });

  it("ignores wakes that have already passed", () => {
    expect(nextWakeDelayMs([500], 1_000)).toBeNull();
    expect(nextWakeDelayMs([], 1_000)).toBeNull();
  });

  // A far-future wake overflows setTimeout's signed 32-bit delay and fires
  // immediately, turning one snooze into a tight re-arm loop.
  it("clamps a far-future wake to the maximum timeout", () => {
    expect(nextWakeDelayMs([Number.MAX_SAFE_INTEGER], 0)).toBe(MAX_TIMEOUT_MS);
  });
});
