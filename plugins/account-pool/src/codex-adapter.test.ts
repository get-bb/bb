import { describe, expect, it } from "vitest";
import { codexQuotaFromUsage, createCodexAdapter } from "./codex-adapter.js";
import type { AccountQuota } from "./contracts.js";
import { isQuotaExhausted } from "./quota.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

function emptyQuota(): AccountQuota {
  return {
    accountId: ACCOUNT_ID,
    fiveHourUtilization: null,
    fiveHourResetAt: null,
    fiveHourStatus: null,
    sevenDayUtilization: null,
    sevenDayResetAt: null,
    sevenDayStatus: null,
    representativeClaim: null,
    familyWeekly: {
      fable: null,
      sonnet: null,
      opus: null,
      haiku: null,
      other: null,
    },
    limitWindows: [],
    observedAt: null,
    heldUntil: null,
    error: null,
  };
}

const adapter = createCodexAdapter({
  refreshUrl: "https://auth.example/oauth/token",
  usageUrl: "https://usage.example/usage",
});

describe("codexQuotaFromUsage", () => {
  it("keeps a Pro account's single weekly window out of the Claude slots", () => {
    const quota = codexQuotaFromUsage(
      ACCOUNT_ID,
      {
        plan_type: "pro",
        rate_limit: {
          allowed: true,
          limit_reached: false,
          primary_window: {
            used_percent: 48,
            limit_window_seconds: 604_800,
            reset_after_seconds: 180_092,
            reset_at: 1_788_748_205,
          },
          secondary_window: null,
        },
      },
      emptyQuota(),
      1_000,
    );
    expect(quota).toMatchObject({
      fiveHourUtilization: null,
      sevenDayUtilization: null,
      familyWeekly: { fable: null, other: null },
      limitWindows: [
        {
          slot: "primary",
          windowMinutes: 10_080,
          utilization: 0.48,
          resetAt: 1_788_748_205_000,
          status: "allowed",
          source: "usage",
        },
      ],
    });
  });

  it("clears slots a pre-window adapter wrote for a Codex account", () => {
    const stale: AccountQuota = {
      ...emptyQuota(),
      fiveHourUtilization: 1,
      fiveHourStatus: "rejected",
      familyWeekly: {
        ...emptyQuota().familyWeekly,
        other: {
          utilization: 1,
          resetAt: null,
          status: "rejected",
          observedAt: 1,
          source: "header",
        },
      },
    };
    expect(isQuotaExhausted(stale, "other", 0.9, 2_000)).toBe(true);
    const refreshed = codexQuotaFromUsage(
      ACCOUNT_ID,
      {
        rate_limit: {
          primary_window: { used_percent: 10, limit_window_seconds: 604_800 },
        },
      },
      stale,
      2_000,
    );
    expect(refreshed).toMatchObject({
      fiveHourUtilization: null,
      fiveHourStatus: null,
      familyWeekly: { other: null },
    });
    if (refreshed === null) throw new Error("Expected a quota.");
    expect(isQuotaExhausted(refreshed, "other", 0.9, 2_000)).toBe(false);
  });

  it("returns null for a payload without rate limits", () => {
    expect(codexQuotaFromUsage(ACCOUNT_ID, {}, emptyQuota(), 1)).toBeNull();
  });
});

describe("codex header quotas", () => {
  it.each(["primary", "secondary"] as const)(
    "honors a fresh over-limit %s header after the previous reset expires",
    (slot) => {
      const previous = adapter.quotaFromHeaders(
        ACCOUNT_ID,
        new Headers({
          [`x-codex-${slot}-used-percent`]: "25",
          [`x-codex-${slot}-reset-after-seconds`]: "1",
        }),
        emptyQuota(),
        "other",
        1_000,
      );
      const rejected = adapter.quotaFromHeaders(
        ACCOUNT_ID,
        new Headers({ [`x-codex-${slot}-over-limit`]: "true" }),
        previous,
        "other",
        3_000,
      );
      expect(isQuotaExhausted(rejected, "other", 0.98, 3_000)).toBe(true);
      expect(
        rejected.limitWindows.find((window) => window.slot === slot)?.resetAt,
      ).toBeNull();
      const recovered = codexQuotaFromUsage(
        ACCOUNT_ID,
        {
          rate_limit: {
            [`${slot}_window`]: { used_percent: 10, reset_after_seconds: 60 },
          },
        },
        rejected,
        4_000,
      );
      if (recovered === null) throw new Error("Expected refreshed usage.");
      expect(isQuotaExhausted(recovered, "other", 0.98, 4_000)).toBe(false);
    },
  );

  it("retains the reported window length when a later response omits it", () => {
    const fromUsage = codexQuotaFromUsage(
      ACCOUNT_ID,
      {
        rate_limit: {
          primary_window: { used_percent: 10, limit_window_seconds: 604_800 },
        },
      },
      emptyQuota(),
      1_000,
    );
    if (fromUsage === null) throw new Error("Expected a quota.");
    const rejected = adapter.quotaFromHeaders(
      ACCOUNT_ID,
      new Headers({ "x-codex-primary-used-percent": "100" }),
      fromUsage,
      "other",
      2_000,
    );
    expect(rejected.limitWindows).toEqual([
      {
        slot: "primary",
        windowMinutes: 10_080,
        utilization: 1,
        resetAt: null,
        status: "rejected",
        observedAt: 2_000,
        source: "header",
      },
    ]);
    expect(isQuotaExhausted(rejected, "other", 0.9, 2_000)).toBe(true);
    expect(isQuotaExhausted(fromUsage, "other", 0.9, 2_000)).toBe(false);
  });

  it("drops a placeholder secondary window with zero usage and no reset", () => {
    const quota = adapter.quotaFromHeaders(
      ACCOUNT_ID,
      new Headers({
        "x-codex-primary-used-percent": "47",
        "x-codex-primary-window-minutes": "10080",
        "x-codex-primary-reset-at": "4102452000",
        "x-codex-secondary-used-percent": "0",
        "x-codex-secondary-reset-at": "0",
      }),
      emptyQuota(),
      "other",
      5_000,
    );
    expect(quota.limitWindows.map((window) => window.slot)).toEqual([
      "primary",
    ]);
  });

  it("clears a stored placeholder window when the headers repeat it", () => {
    const previous: AccountQuota = {
      ...emptyQuota(),
      limitWindows: [
        {
          slot: "primary",
          windowMinutes: 10_080,
          utilization: 0.47,
          resetAt: 4_102_452_000_000,
          status: null,
          observedAt: 1_000,
          source: "header",
        },
        {
          slot: "secondary",
          windowMinutes: null,
          utilization: 0,
          resetAt: 0,
          status: null,
          observedAt: 1_000,
          source: "header",
        },
      ],
    };
    const quota = adapter.quotaFromHeaders(
      ACCOUNT_ID,
      new Headers({
        "x-codex-primary-used-percent": "48",
        "x-codex-secondary-used-percent": "0",
        "x-codex-secondary-reset-at": "0",
      }),
      previous,
      "other",
      5_000,
    );
    expect(quota.limitWindows.map((window) => window.slot)).toEqual([
      "primary",
    ]);
  });

  it("keeps a zero-usage window that reports a length or a reset", () => {
    const quota = adapter.quotaFromHeaders(
      ACCOUNT_ID,
      new Headers({
        "x-codex-primary-used-percent": "0",
        "x-codex-primary-window-minutes": "300",
        "x-codex-secondary-used-percent": "0",
        "x-codex-secondary-reset-after-seconds": "60",
      }),
      emptyQuota(),
      "other",
      5_000,
    );
    expect(quota.limitWindows.map((window) => window.slot)).toEqual([
      "primary",
      "secondary",
    ]);
  });

  it("reads both windows and their lengths from response headers", () => {
    const quota = adapter.quotaFromHeaders(
      ACCOUNT_ID,
      new Headers({
        "x-codex-primary-used-percent": "25",
        "x-codex-primary-window-minutes": "300",
        "x-codex-primary-reset-after-seconds": "60",
        "x-codex-secondary-used-percent": "40",
        "x-codex-secondary-window-minutes": "10080",
        "x-codex-secondary-reset-at": "4102452000",
      }),
      emptyQuota(),
      "other",
      5_000,
    );
    expect(quota.limitWindows).toEqual([
      {
        slot: "primary",
        windowMinutes: 300,
        utilization: 0.25,
        resetAt: 65_000,
        status: null,
        observedAt: 5_000,
        source: "header",
      },
      {
        slot: "secondary",
        windowMinutes: 10_080,
        utilization: 0.4,
        resetAt: 4_102_452_000_000,
        status: null,
        observedAt: 5_000,
        source: "header",
      },
    ]);
    expect(
      adapter.quotaFromHeaders(
        ACCOUNT_ID,
        new Headers(),
        quota,
        "other",
        6_000,
      ),
    ).toBe(quota);
  });
});

describe("requestHeaders", () => {
  it("forwards Codex routing and lite-mode headers but drops downstream auth", () => {
    const headers = adapter.requestHeaders(
      new Headers({
        authorization: "Bearer downstream",
        "x-bb-account-pool-token": "machine-token",
        "x-codex-turn-state": "sticky",
        "x-openai-internal-codex-responses-lite": "true",
        "x-openai-internal-other": "dropped",
        "openai-beta": "responses=experimental",
        "content-type": "application/json",
      }),
      {
        id: ACCOUNT_ID,
        provider: "codex",
        kind: "oauth",
        label: "codex",
        email: null,
        accountUuid: null,
        codexAccountId: "chatgpt-account",
        subscriptionType: null,
        rateLimitTier: null,
        enabled: true,
        priority: 0,
        createdAt: 0,
        lastUsedAt: null,
        lastUsedHostId: null,
      },
      {
        kind: "oauth",
        accessToken: "upstream-token",
        refreshToken: "refresh",
        expiresAt: null,
      },
    );
    expect(Object.fromEntries(headers)).toEqual({
      authorization: "Bearer upstream-token",
      "chatgpt-account-id": "chatgpt-account",
      "content-type": "application/json",
      "openai-beta": "responses=experimental",
      "x-codex-turn-state": "sticky",
      "x-openai-internal-codex-responses-lite": "true",
    });
  });
});
