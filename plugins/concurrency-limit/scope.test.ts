import { describe, expect, it } from "vitest";
import type { ResolvedLimits } from "./limits.js";
import {
  evaluateDispatch,
  GLOBAL_SCOPE_KEY,
  hostScopeKey,
  isExemptDispatch,
  MAX_REASON_LENGTH,
  scopeKeysFor,
  type ScopeKey,
} from "./scope.js";

const NO_LIMITS: ResolvedLimits = { global: null, perHost: null };

function counts(values: Record<ScopeKey, number>) {
  return (key: ScopeKey): number => values[key] ?? 0;
}

describe("isExemptDispatch", () => {
  it("exempts child threads and plugin-spawned threads", () => {
    // This is the deadlock guard, and it is unconditional: a workflows parent
    // stays active while its children run, so counting children against the
    // same pool lets parents fill it and block the children they wait on.
    expect(
      isExemptDispatch({ parentThreadId: "thr_parent", originPluginId: null }),
    ).toBe(true);
    expect(
      isExemptDispatch({ parentThreadId: null, originPluginId: "workflows" }),
    ).toBe(true);
  });

  it("does not exempt an ordinary user-started root thread", () => {
    expect(
      isExemptDispatch({ parentThreadId: null, originPluginId: null }),
    ).toBe(false);
  });
});

describe("scopeKeysFor", () => {
  it("omits the host scope when no environment has been chosen", () => {
    // A create-stage dispatch has no host yet; it must count globally but must
    // not be filed under some invented host key.
    expect(scopeKeysFor(null)).toEqual([GLOBAL_SCOPE_KEY]);
  });

  it("lists both scopes when the host is known", () => {
    expect(scopeKeysFor("host-1")).toEqual([
      GLOBAL_SCOPE_KEY,
      hostScopeKey("host-1"),
    ]);
  });
});

describe("evaluateDispatch", () => {
  it("proceeds when nothing is configured", () => {
    expect(
      evaluateDispatch({
        limits: NO_LIMITS,
        hostId: "host-1",
        hostName: "mac-mini",
        countInScope: counts({ [GLOBAL_SCOPE_KEY]: 99 }),
      }),
    ).toEqual({ action: "proceed" });
  });

  it("holds at the limit, not one past it", () => {
    // Off-by-one here is the whole feature: at a limit of 2 with 2 running,
    // the third dispatch must be held, and with 1 running it must proceed.
    const limits: ResolvedLimits = { global: 2, perHost: null };
    expect(
      evaluateDispatch({
        limits,
        hostId: "host-1",
        hostName: null,
        countInScope: counts({ [GLOBAL_SCOPE_KEY]: 1 }),
      }).action,
    ).toBe("proceed");
    expect(
      evaluateDispatch({
        limits,
        hostId: "host-1",
        hostName: null,
        countInScope: counts({ [GLOBAL_SCOPE_KEY]: 2 }),
      }).action,
    ).toBe("wait");
  });

  it("reports the global limit when both are full", () => {
    // Deterministic attribution matters because passes re-run on release and
    // restart; a reason that changed between passes would look like churn.
    expect(
      evaluateDispatch({
        limits: { global: 2, perHost: 1 },
        hostId: "host-1",
        hostName: "mac-mini",
        countInScope: counts({
          [GLOBAL_SCOPE_KEY]: 2,
          [hostScopeKey("host-1")]: 1,
        }),
      }),
    ).toEqual({
      action: "wait",
      scopeKey: GLOBAL_SCOPE_KEY,
      reason: "2 of 2 running on all hosts",
    });
  });

  it("falls through to the host limit when the global one has room", () => {
    expect(
      evaluateDispatch({
        limits: { global: 10, perHost: 2 },
        hostId: "host-1",
        hostName: "mac-mini",
        countInScope: counts({
          [GLOBAL_SCOPE_KEY]: 3,
          [hostScopeKey("host-1")]: 2,
        }),
      }),
    ).toEqual({
      action: "wait",
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
        limits: { global: null, perHost: 0 },
        hostId: null,
        hostName: null,
        countInScope: counts({}),
      }).action,
    ).toBe("proceed");
  });

  it("keeps the reason inside the hold contract's cap for a hostile host name", () => {
    // Host names are user-set and unbounded; the hold column is capped at 200.
    const verdict = evaluateDispatch({
      limits: { global: null, perHost: 1 },
      hostId: "host-1",
      hostName: "x".repeat(500),
      countInScope: counts({ [hostScopeKey("host-1")]: 1 }),
    });
    expect(verdict.action).toBe("wait");
    if (verdict.action !== "wait") return;
    expect(verdict.reason.length).toBe(MAX_REASON_LENGTH);
  });

  it("falls back to the host id when the host has no name", () => {
    const verdict = evaluateDispatch({
      limits: { global: null, perHost: 1 },
      hostId: "host-1",
      hostName: "   ",
      countInScope: counts({ [hostScopeKey("host-1")]: 1 }),
    });
    expect(verdict.action).toBe("wait");
    if (verdict.action !== "wait") return;
    expect(verdict.reason).toBe("1 of 1 running on host host-1");
  });
});
