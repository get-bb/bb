import { describe, expect, it } from "vitest";
import { ParkedRowRegistry, type ParkedRecord } from "./parked-rows.js";
import { GLOBAL_SCOPE_KEY, hostScopeKey } from "./scope.js";

const HOLDER = "plugin:concurrency-limit";

function parkedRecord(overrides: Partial<ParkedRecord> = {}): ParkedRecord {
  return {
    id: "hold_1",
    threadId: "thr_1",
    reason: "2 of 2 running on all hosts",
    createdAt: 1_000,
    holder: HOLDER,
    ...overrides,
  };
}

describe("ownership", () => {
  it("ignores holds owned by anyone else", () => {
    // Every listener sees every hold — a scheduled send, another plugin's
    // hold, core's reprovision park. Releasing one of those is refused by core
    // and would mean the free that should have released our own hold is lost.
    const registry = new ParkedRowRegistry(HOLDER);
    expect(registry.noteParked(parkedRecord({ holder: "user" }))).toBe(false);
    expect(
      registry.noteParked(parkedRecord({ id: "hold_2", holder: "core:reprovision" })),
    ).toBe(false);
    expect(registry.noteParked(parkedRecord())).toBe(true);
    expect(registry.liveRows()).toHaveLength(1);
  });
});

describe("attributing a hold to the limit that caused it", () => {
  it("links a gate verdict to the hold event that follows it", () => {
    const registry = new ParkedRowRegistry(HOLDER);
    registry.expectWait("2 of 2 running on host mac", hostScopeKey("host-a"));
    registry.noteParked(parkedRecord({ reason: "2 of 2 running on host mac" }));
    expect(registry.liveRows()[0]?.scopeKey).toBe(hostScopeKey("host-a"));
  });

  it("matches by reason when several verdicts are outstanding", () => {
    // Verdicts and events are in the same order under core's serial lock, but
    // reason matching is what keeps attribution right if they ever are not.
    const registry = new ParkedRowRegistry(HOLDER);
    registry.expectWait("global", GLOBAL_SCOPE_KEY);
    registry.expectWait("host", hostScopeKey("host-a"));
    registry.noteParked(parkedRecord({ id: "hold_p", reason: "host" }));
    registry.noteParked(parkedRecord({ id: "hold_g", reason: "global" }));
    const byId = new Map(registry.liveRows().map((h) => [h.queuedMessageId, h.scopeKey]));
    expect(byId.get("hold_p")).toBe(hostScopeKey("host-a"));
    expect(byId.get("hold_g")).toBe(GLOBAL_SCOPE_KEY);
  });

  it("records an unattributable hold rather than dropping it", () => {
    // A hold we cannot attribute is still ours to release; forgetting it would
    // strand the dispatch until the orphan sweep or the user intervened.
    const registry = new ParkedRowRegistry(HOLDER);
    registry.noteParked(parkedRecord());
    expect(registry.liveRows()[0]?.scopeKey).toBeNull();
  });
});

describe("oldestForScopes", () => {
  it("releases the oldest hold waiting on a freed scope", () => {
    const registry = new ParkedRowRegistry(HOLDER);
    registry.expectWait("a", hostScopeKey("host-a"));
    registry.noteParked(
      parkedRecord({ id: "hold_new", reason: "a", createdAt: 5_000 }),
    );
    registry.expectWait("a", hostScopeKey("host-a"));
    registry.noteParked(
      parkedRecord({ id: "hold_old", reason: "a", createdAt: 1_000 }),
    );
    expect(
      registry.oldestForScopes([hostScopeKey("host-a")])?.queuedMessageId,
    ).toBe("hold_old");
  });

  it("leaves holds waiting on a different pool alone", () => {
    // A thread finishing on host-b frees nothing for a hold that is waiting on
    // host-a's pool; releasing it would just re-hold and churn.
    const registry = new ParkedRowRegistry(HOLDER);
    registry.expectWait("a", hostScopeKey("host-a"));
    registry.noteParked(parkedRecord({ id: "hold_a", reason: "a" }));
    expect(registry.oldestForScopes([hostScopeKey("host-b")])).toBeNull();
    expect(
      registry.oldestForScopes([GLOBAL_SCOPE_KEY, hostScopeKey("host-a")])
        ?.queuedMessageId,
    ).toBe("hold_a");
  });

  it("treats an unattributed hold as eligible for any free", () => {
    // Holds adopted after a restart have no known scope. Core re-runs the gate
    // on release, so an unwarranted release re-holds — strictly better than
    // never releasing them at all.
    const registry = new ParkedRowRegistry(HOLDER);
    registry.adopt([parkedRecord({ id: "hold_x" })]);
    expect(
      registry.oldestForScopes([hostScopeKey("anything")])?.queuedMessageId,
    ).toBe("hold_x");
  });

  it("breaks ties deterministically so restarts pick the same hold", () => {
    const registry = new ParkedRowRegistry(HOLDER);
    registry.adopt([
      parkedRecord({ id: "hold_b", createdAt: 1_000 }),
      parkedRecord({ id: "hold_a", createdAt: 1_000 }),
    ]);
    expect(registry.oldestForScopes([GLOBAL_SCOPE_KEY])?.queuedMessageId).toBe("hold_a");
  });

  it("stops offering a hold once it is released or cancelled", () => {
    const registry = new ParkedRowRegistry(HOLDER);
    registry.adopt([parkedRecord({ id: "hold_x" })]);
    registry.noteResolved("hold_x");
    expect(registry.oldestForScopes([GLOBAL_SCOPE_KEY])).toBeNull();
  });
});

describe("adopt", () => {
  it("re-adopts a hold after a failed release without duplicating a tracked one", () => {
    const registry = new ParkedRowRegistry(HOLDER);
    registry.expectWait("a", hostScopeKey("host-a"));
    registry.noteParked(parkedRecord({ id: "hold_x", reason: "a" }));
    // Reconciliation re-reads live holds; the known scope must survive.
    registry.adopt([parkedRecord({ id: "hold_x", reason: "a" })]);
    expect(registry.liveRows()).toHaveLength(1);
    expect(registry.liveRows()[0]?.scopeKey).toBe(hostScopeKey("host-a"));
  });

  it("ignores other owners' holds from the live list", () => {
    const registry = new ParkedRowRegistry(HOLDER);
    registry.adopt([parkedRecord({ id: "hold_u", holder: "user" })]);
    expect(registry.liveRows()).toEqual([]);
  });
});
