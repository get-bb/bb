import { describe, expect, it } from "vitest";
import type { ProviderRateLimitState } from "@get-bb/plugin-sdk/provider-bridge";
import { reconcileFreshCodexUsageLimit } from "./reconcile-usage-limit.js";

const now = 1_790_000_000_000;
function warning(): ProviderRateLimitState {
  return {
    providerId: "codex",
    status: "warning",
    kind: "subscription-window",
    windows: [
      {
        providerKey: "primary",
        label: "Session",
        status: "warning",
        resetsAtMs: now + 60_000,
      },
      {
        providerKey: "secondary",
        label: "Weekly",
        status: "allowed",
        resetsAtMs: now + 604800_000,
      },
    ],
    reachedReason: null,
    overageStatus: null,
    overageReason: null,
  };
}

describe("terminal Codex usage limit and fresh structured quota", () => {
  it("blocks only warning windows while preserving the allowed weekly reset", () => {
    const state = warning();
    expect(reconcileFreshCodexUsageLimit(state, true, now)).toMatchObject({
      status: "blocked",
      windows: [
        { status: "blocked", resetsAtMs: now + 60_000 },
        { status: "allowed" },
      ],
    });
    expect(state.status).toBe("warning");
  });
  it("keeps warnings without a terminal usageLimitExceeded unchanged", () => {
    const state = warning();
    expect(reconcileFreshCodexUsageLimit(state, false, now)).toBe(state);
  });
  it.each([null, now - 1, now, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects missing or stale reset %s",
    (reset) => {
      const state = warning();
      state.windows[0].resetsAtMs = reset;
      expect(reconcileFreshCodexUsageLimit(state, true, now)).toBe(state);
    },
  );
  it.each(["credits", "spend-control", "unknown"] as const)(
    "does not promote %s limits",
    (kind) => {
      const state = { ...warning(), kind };
      expect(reconcileFreshCodexUsageLimit(state, true, now)).toBe(state);
    },
  );
  it.each(["allowed", "unknown", "blocked"] as const)(
    "keeps %s status unchanged",
    (status) => {
      const state = { ...warning(), status };
      expect(reconcileFreshCodexUsageLimit(state, true, now)).toBe(state);
    },
  );
});
