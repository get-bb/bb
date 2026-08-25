import { describe, expect, it } from "vitest";
import type { ResolvedLimits } from "./limits.js";
import {
  evaluateDispatch,
  GLOBAL_SCOPE_KEY,
  hostScopeKey,
  isExemptDispatch,
  MAX_REASON_LENGTH,
  providerScopeKey,
  scopeKeysFor,
  type DispatchScope,
  type ScopeKey,
} from "./scope.js";

const NO_LIMITS: ResolvedLimits = {
  global: null,
  perHost: null,
  perProvider: null,
  maxCpuPercent: null,
  maxMemoryPercent: null,
  includeChildThreads: false,
};

const SCOPE: DispatchScope = { hostId: "host-1", providerId: "codex" };

function counts(values: Record<ScopeKey, number>) {
  return (key: ScopeKey): number => values[key] ?? 0;
}

describe("isExemptDispatch", () => {
  it("exempts child threads and plugin-spawned threads by default", () => {
    // This is the deadlock guard: a workflows parent stays active while its
    // children run, so counting children against the same pool lets parents
    // fill it and block the children they are waiting on.
    expect(
      isExemptDispatch({
        parentThreadId: "thr_parent",
        originPluginId: null,
        includeChildThreads: false,
      }),
    ).toBe(true);
    expect(
      isExemptDispatch({
        parentThreadId: null,
        originPluginId: "workflows",
        includeChildThreads: false,
      }),
    ).toBe(true);
  });

  it("does not exempt an ordinary user-started root thread", () => {
    expect(
      isExemptDispatch({
        parentThreadId: null,
        originPluginId: null,
        includeChildThreads: false,
      }),
    ).toBe(false);
  });

  it("counts children once the user opts in", () => {
    expect(
      isExemptDispatch({
        parentThreadId: "thr_parent",
        originPluginId: "workflows",
        includeChildThreads: true,
      }),
    ).toBe(false);
  });
});

describe("scopeKeysFor", () => {
  it("omits the host scope when no environment has been chosen", () => {
    // A create-stage dispatch has no host yet; it must count globally and per
    // provider but must not be filed under some invented host key.
    expect(scopeKeysFor({ hostId: null, providerId: "codex" })).toEqual([
      GLOBAL_SCOPE_KEY,
      providerScopeKey("codex"),
    ]);
  });

  it("lists all three when both are known", () => {
    expect(scopeKeysFor(SCOPE)).toEqual([
      GLOBAL_SCOPE_KEY,
      hostScopeKey("host-1"),
      providerScopeKey("codex"),
    ]);
  });
});

describe("evaluateDispatch", () => {
  it("proceeds when nothing is configured", () => {
    expect(
      evaluateDispatch({
        limits: NO_LIMITS,
        scope: SCOPE,
        hostName: "mac-mini",
        countInScope: counts({ [GLOBAL_SCOPE_KEY]: 99 }),
        load: { cpuPercent: 99, memoryPercent: 99 },
      }),
    ).toEqual({ action: "proceed" });
  });

  it("holds at the limit, not one past it", () => {
    // Off-by-one here is the whole feature: at a limit of 2 with 2 running,
    // the third dispatch must be held, and with 1 running it must proceed.
    const limits = { ...NO_LIMITS, global: 2 };
    expect(
      evaluateDispatch({
        limits,
        scope: SCOPE,
        hostName: null,
        countInScope: counts({ [GLOBAL_SCOPE_KEY]: 1 }),
        load: null,
      }).action,
    ).toBe("proceed");
    expect(
      evaluateDispatch({
        limits,
        scope: SCOPE,
        hostName: null,
        countInScope: counts({ [GLOBAL_SCOPE_KEY]: 2 }),
        load: null,
      }).action,
    ).toBe("hold");
  });

  it("reports the broadest binding limit when several are full", () => {
    // Deterministic attribution matters because passes re-run on release and
    // restart; a reason that changed between passes would look like churn.
    const verdict = evaluateDispatch({
      limits: { ...NO_LIMITS, global: 2, perHost: 1, perProvider: 1 },
      scope: SCOPE,
      hostName: "mac-mini",
      countInScope: counts({
        [GLOBAL_SCOPE_KEY]: 2,
        [hostScopeKey("host-1")]: 1,
        [providerScopeKey("codex")]: 1,
      }),
      load: null,
    });
    expect(verdict).toEqual({
      action: "hold",
      scopeKey: GLOBAL_SCOPE_KEY,
      reason: "2 of 2 running on all hosts",
    });
  });

  it("falls through to the host limit when the global one has room", () => {
    const verdict = evaluateDispatch({
      limits: { ...NO_LIMITS, global: 10, perHost: 2 },
      scope: SCOPE,
      hostName: "mac-mini",
      countInScope: counts({
        [GLOBAL_SCOPE_KEY]: 3,
        [hostScopeKey("host-1")]: 2,
      }),
      load: null,
    });
    expect(verdict).toEqual({
      action: "hold",
      scopeKey: hostScopeKey("host-1"),
      reason: "2 of 2 running on host mac-mini",
    });
  });

  it("skips the host limit entirely when no host is chosen yet", () => {
    // A create-stage dispatch with an unresolved environment cannot be judged
    // against a per-host pool; holding it against an arbitrary host would be
    // wrong, and holding it against "no host" would block every create.
    expect(
      evaluateDispatch({
        limits: { ...NO_LIMITS, perHost: 0 },
        scope: { hostId: null, providerId: "codex" },
        hostName: null,
        countInScope: counts({}),
        load: null,
      }).action,
    ).toBe("proceed");
  });

  it("names the provider when the provider pool binds", () => {
    const verdict = evaluateDispatch({
      limits: { ...NO_LIMITS, perProvider: 3 },
      scope: SCOPE,
      hostName: "mac-mini",
      countInScope: counts({ [providerScopeKey("codex")]: 3 }),
      load: null,
    });
    expect(verdict).toEqual({
      action: "hold",
      scopeKey: providerScopeKey("codex"),
      reason: "3 of 3 running on provider codex",
    });
  });

  it("holds on load and files it under the host scope", () => {
    // Filing a load hold under the host is what lets a thread finishing on
    // that host release it.
    const verdict = evaluateDispatch({
      limits: { ...NO_LIMITS, maxCpuPercent: 90 },
      scope: SCOPE,
      hostName: "mac-mini",
      countInScope: counts({}),
      load: { cpuPercent: 92, memoryPercent: 10 },
    });
    expect(verdict).toEqual({
      action: "hold",
      scopeKey: hostScopeKey("host-1"),
      reason: "CPU 92% on mac-mini",
    });
  });

  it("proceeds when a load threshold is set but no sample has arrived", () => {
    // A monitoring gap must not become an outage.
    expect(
      evaluateDispatch({
        limits: { ...NO_LIMITS, maxCpuPercent: 1 },
        scope: SCOPE,
        hostName: "mac-mini",
        countInScope: counts({}),
        load: null,
      }).action,
    ).toBe("proceed");
  });

  it("prefers count limits over load limits when both bind", () => {
    const verdict = evaluateDispatch({
      limits: { ...NO_LIMITS, global: 1, maxCpuPercent: 50 },
      scope: SCOPE,
      hostName: "mac-mini",
      countInScope: counts({ [GLOBAL_SCOPE_KEY]: 1 }),
      load: { cpuPercent: 99, memoryPercent: 99 },
    });
    expect(verdict.action).toBe("hold");
    if (verdict.action !== "hold") return;
    expect(verdict.reason).toBe("1 of 1 running on all hosts");
  });

  it("keeps the reason inside the hold contract's cap for a hostile host name", () => {
    // Host names are user-set and unbounded; the hold column is capped at 200.
    const verdict = evaluateDispatch({
      limits: { ...NO_LIMITS, perHost: 1 },
      scope: SCOPE,
      hostName: "x".repeat(500),
      countInScope: counts({ [hostScopeKey("host-1")]: 1 }),
      load: null,
    });
    expect(verdict.action).toBe("hold");
    if (verdict.action !== "hold") return;
    expect(verdict.reason.length).toBe(MAX_REASON_LENGTH);
  });

  it("falls back to the host id when the host has no name", () => {
    const verdict = evaluateDispatch({
      limits: { ...NO_LIMITS, perHost: 1 },
      scope: SCOPE,
      hostName: "   ",
      countInScope: counts({ [hostScopeKey("host-1")]: 1 }),
      load: null,
    });
    expect(verdict.action).toBe("hold");
    if (verdict.action !== "hold") return;
    expect(verdict.reason).toBe("1 of 1 running on host host-1");
  });
});
