import { describe, expect, it } from "vitest";
import {
  GLOBAL_SCOPE_KEY,
  hostScopeKey,
  providerScopeKey,
  type DispatchScope,
} from "./scope.js";
import { IN_FLIGHT_TIMEOUT_MS, OccupancyTally } from "./tally.js";

const NOW = 1_000_000;
const A: DispatchScope = { hostId: "host-a", providerId: "codex" };
const B: DispatchScope = { hostId: "host-b", providerId: "claude-code" };

function seeded(counts?: Parameters<OccupancyTally["seed"]>[0]) {
  const tally = new OccupancyTally();
  tally.seed(counts ?? { global: 0, byHost: {}, byProvider: {} });
  return tally;
}

describe("seeding", () => {
  it("counts seeded threads in every scope they were grouped under", () => {
    const tally = seeded({
      global: 5,
      byHost: { "host-a": 3, "host-b": 2 },
      byProvider: { codex: 4, "claude-code": 1 },
    });
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(5);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(3);
    expect(tally.count(providerScopeKey("codex"), NOW)).toBe(4);
    expect(tally.count(hostScopeKey("unknown"), NOW)).toBe(0);
  });

  it("clears observed threads on re-seed so a refresh cannot double-count", () => {
    // The fresh snapshot already contains the thread we watched start; keeping
    // our own record of it too would count the same thread twice, and the
    // limiter would ratchet itself shut over time.
    const tally = seeded();
    tally.noteCreated("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    tally.seed({ global: 1, byHost: { "host-a": 1 }, byProvider: { codex: 1 } });
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
  });

  it("keeps in-flight proceeds across a re-seed", () => {
    // A snapshot taken now cannot contain a dispatch whose row has not landed,
    // so dropping in-flight entries on re-seed would briefly admit over the
    // limit every single minute.
    const tally = seeded();
    tally.notePendingCreate(A, NOW);
    tally.seed({ global: 2, byHost: { "host-a": 2 }, byProvider: { codex: 2 } });
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(3);
  });
});

describe("in-flight proceeds", () => {
  it("counts a create proceed before its row exists", () => {
    // Evaluation is serial under one lock, so without this a limit of 1 admits
    // every dispatch that arrives before the first thread's row lands.
    const tally = seeded();
    tally.notePendingCreate(A, NOW);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
  });

  it("hands a create proceed over to the thread without double counting", () => {
    const tally = seeded();
    tally.notePendingCreate(A, NOW);
    tally.noteCreated("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    // The thread going active afterwards is the same occupancy, not a second.
    tally.noteActive("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
  });

  it("matches a create proceed to its own host rather than another's", () => {
    const tally = seeded();
    tally.notePendingCreate(A, NOW);
    tally.notePendingCreate(B, NOW);
    tally.noteCreated("thr_b", B);
    // host-a's reservation must survive host-b's thread landing.
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-b"), NOW)).toBe(1);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(2);
  });

  it("settles a create proceed whose host was unresolved at gate time", () => {
    // The common create case: no environment yet, so the reservation carries
    // no host and must still be claimed by the thread that lands with one.
    const tally = seeded();
    tally.notePendingCreate({ hostId: null, providerId: "codex" }, NOW);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(0);
    tally.noteCreated("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
  });

  it("settles a create proceed whose thread landed before it had an environment", () => {
    // The production path: the gate can see a host (the environment was
    // pre-chosen) while the freshly inserted row still has none, because
    // provisioning has not run. If the reservation is not claimed here it sits
    // alongside the thread it belongs to, counting one dispatch twice until it
    // expires — which at a limit of 1 means the pool never reopens.
    const tally = seeded();
    tally.notePendingCreate(A, NOW);
    tally.noteCreated("thr_1", { hostId: null, providerId: "codex" });
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    tally.noteFreed("thr_1", { hostId: null, providerId: "codex" });
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(0);
  });

  it("expires a proceed whose thread never arrived", () => {
    // A dispatch can fail after our gate said yes — an invalid amendment from
    // a later gate, a provisioning failure. Without expiry those phantom slots
    // leak until reload and the limiter strangles itself.
    const tally = seeded();
    tally.notePendingCreate(A, NOW);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW + IN_FLIGHT_TIMEOUT_MS - 1)).toBe(
      1,
    );
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW + IN_FLIGHT_TIMEOUT_MS)).toBe(0);
  });

  it("replaces a submit proceed for the same thread instead of stacking", () => {
    const tally = seeded();
    tally.notePendingSubmit("thr_1", A, NOW);
    tally.notePendingSubmit("thr_1", A, NOW + 10);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW + 10)).toBe(1);
  });

  it("clears a submit proceed when its thread goes active", () => {
    const tally = seeded();
    tally.notePendingSubmit("thr_1", A, NOW);
    tally.noteActive("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
  });

  it("clears a submit proceed when its thread fails instead of starting", () => {
    const tally = seeded();
    tally.notePendingSubmit("thr_1", A, NOW);
    tally.noteFreed("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(0);
  });
});

describe("freeing slots", () => {
  it("takes a freed thread we watched start out of the observed set", () => {
    const tally = seeded();
    tally.noteActive("thr_1", A);
    tally.noteFreed("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(0);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(0);
  });

  it("takes a freed thread we never saw start out of the seed baseline", () => {
    // Threads that were already running when we seeded have no entry in the
    // observed set; their slot has to come off the baseline instead or the
    // limiter never recovers the capacity.
    const tally = seeded({
      global: 2,
      byHost: { "host-a": 2 },
      byProvider: { codex: 2 },
    });
    tally.noteFreed("thr_old", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
    expect(tally.count(providerScopeKey("codex"), NOW)).toBe(1);
  });

  it("does not decrement twice when a thread goes idle and is then archived", () => {
    // Both events fire for the same thread and both mean "free"; treating the
    // second as another freed slot would inflate available capacity.
    const tally = seeded({
      global: 2,
      byHost: { "host-a": 2 },
      byProvider: { codex: 2 },
    });
    tally.noteFreed("thr_old", A);
    tally.noteFreed("thr_old", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
  });

  it("never lets the baseline go negative", () => {
    const tally = seeded();
    tally.noteFreed("thr_a", A);
    tally.noteFreed("thr_b", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(0);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(0);
  });

  it("counts a thread again when it restarts after being freed", () => {
    const tally = seeded();
    tally.noteActive("thr_1", A);
    tally.noteFreed("thr_1", A);
    tally.noteActive("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    // And freeing it again must still only remove it once.
    tally.noteFreed("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(0);
  });
});

describe("scope isolation", () => {
  it("keeps hosts and providers in separate pools while sharing the global one", () => {
    const tally = seeded();
    tally.noteActive("thr_a", A);
    tally.noteActive("thr_b", B);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(2);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-b"), NOW)).toBe(1);
    expect(tally.count(providerScopeKey("codex"), NOW)).toBe(1);
  });

  it("counts a thread with no provider globally but under no provider pool", () => {
    const tally = seeded();
    tally.noteActive("thr_1", { hostId: "host-a", providerId: null });
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    expect(tally.count(providerScopeKey("codex"), NOW)).toBe(0);
  });
});
