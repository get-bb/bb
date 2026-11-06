import { describe, expect, it } from "vitest";
import {
  EMPTY_FAMILY_WEEKLY,
  type AccountQuota,
  type LimitWindow,
} from "./contracts.js";
import { isQuotaExhausted } from "./quota.js";
import { quotaFromUsage } from "./usage.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-11-06T02:05:00Z");
const FUTURE_RESET = Date.parse("2026-11-06T04:00:00Z");
const PAST_RESET = Date.parse("2026-10-28T17:49:00Z");
const SEVEN_DAY_RESET = Date.parse("2026-11-10T00:00:00Z");

function quota(limitWindows: LimitWindow[]): AccountQuota {
  return {
    accountId: ACCOUNT_ID,
    usageRestriction: null,
    extraUsage: null,
    representativeClaim: null,
    familyWeekly: EMPTY_FAMILY_WEEKLY,
    limitWindows,
    observedAt: null,
    heldUntil: null,
    error: null,
  };
}

function fiveHour(
  utilization: number,
  resetAt: number | null,
  status: string,
): LimitWindow {
  return {
    slot: "primary",
    windowMinutes: 300,
    utilization,
    resetAt,
    status,
    observedAt: 1,
    source: "header",
  };
}

const sevenDay = {
  utilization: 30,
  resets_at: new Date(SEVEN_DAY_RESET).toISOString(),
};

describe("quotaFromUsage", () => {
  it("drops a rejected five-hour window when the account reports no five-hour limit", () => {
    const previous = quota([fiveHour(1, FUTURE_RESET, "rejected")]);
    const next = quotaFromUsage(
      ACCOUNT_ID,
      { five_hour: null, seven_day: sevenDay },
      previous,
      NOW,
    );
    expect(next?.limitWindows).toEqual([
      {
        slot: "secondary",
        windowMinutes: 10_080,
        utilization: 0.3,
        resetAt: SEVEN_DAY_RESET,
        status: "allowed",
        observedAt: NOW,
        source: "usage",
      },
    ]);
    expect(isQuotaExhausted(previous, null, NOW)).toBe(true);
    expect(next === null ? null : isQuotaExhausted(next, null, NOW)).toBe(
      false,
    );
  });

  it("clears the stored reset when no five-hour window is running", () => {
    const next = quotaFromUsage(
      ACCOUNT_ID,
      { five_hour: { utilization: 0, resets_at: null }, seven_day: sevenDay },
      quota([fiveHour(0.4, PAST_RESET, "allowed")]),
      NOW,
    );
    expect(next?.limitWindows[0]).toMatchObject({
      slot: "primary",
      utilization: 0,
      resetAt: null,
      status: "allowed",
    });
  });

  it("keeps shared windows when the payload reports neither", () => {
    const previous = quota([fiveHour(0.5, FUTURE_RESET, "allowed")]);
    const next = quotaFromUsage(
      ACCOUNT_ID,
      { seven_day_opus: { utilization: 20, resets_at: null } },
      previous,
      NOW,
    );
    expect(next?.limitWindows).toEqual(previous.limitWindows);
  });
});
