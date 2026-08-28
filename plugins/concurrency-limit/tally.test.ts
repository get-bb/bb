import { describe, expect, it } from "vitest";
import { GLOBAL_SCOPE_KEY, hostScopeKey } from "./scope.js";
import { IN_FLIGHT_TIMEOUT_MS, OccupancyTally } from "./tally.js";
import { RECONCILE_INTERVAL_MS } from "./server.js";

const NOW = 1_000_000;
const A = "host-a";
const B = "host-b";

function seeded(counts?: Parameters<OccupancyTally["seed"]>[0]) {
  const tally = new OccupancyTally();
  tally.seed(counts ?? { global: 0, byHost: {} });
  return tally;
}

describe("seeding", () => {
  it("counts seeded threads in every scope they were grouped under", () => {
    const tally = seeded({
      global: 5,
      byHost: { "host-a": 3, "host-b": 2 },
    });
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(5);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(3);
    expect(tally.count(hostScopeKey("unknown"), NOW)).toBe(0);
  });

  it("clears observed threads on re-seed so a refresh cannot double-count", () => {
    // The fresh snapshot already contains the thread we watched start; keeping
    // our own record of it too would count the same thread twice, and the
    // limiter would ratchet itself shut over time.
    const tally = seeded();
    tally.noteActive("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    tally.seed({ global: 1, byHost: { "host-a": 1 } });
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
  });

  it("keeps in-flight proceeds across a re-seed", () => {
    // A snapshot taken now cannot contain a dispatch whose row has not landed,
    // so dropping in-flight entries on re-seed would briefly admit over the
    // limit every single minute.
    const tally = seeded();
    tally.notePendingSubmit("thr_1", A, NOW);
    tally.seed({ global: 2, byHost: { "host-a": 2 } });
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(3);
  });
});

describe("in-flight proceeds", () => {
  it("counts a proceed before its thread starts", () => {
    // Evaluation is serial under one lock, so without this a limit of 1 admits
    // every dispatch that arrives before the first thread actually starts.
    const tally = seeded();
    tally.notePendingSubmit("thr_1", A, NOW);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
  });

  it("does not double count a proceed once its thread starts", () => {
    // The reason `thread.created` no longer marks occupancy at all: creation
    // is ungated, so it fires for a `pending` thread BEFORE the gate admits
    // it, and counting both it and the gate's own in-flight entry made a limit
    // of N behave as N-1 for as long as a thread was starting.
    const tally = seeded();
    tally.notePendingSubmit("thr_1", A, NOW);
    tally.noteActive("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
  });

  it("holds an admitted thread's slot for longer than a reconcile interval", () => {
    // `starting` produces no lifecycle event of its own, so the in-flight
    // entry is all that holds the slot until a reseed (which counts
    // `starting`) takes over. If it expired first, a slow-provisioning thread
    // would stop being counted and the limiter would over-admit.
    const tally = seeded();
    tally.notePendingSubmit("thr_1", A, NOW);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW + RECONCILE_INTERVAL_MS)).toBe(1);
  });

  it("keeps each thread's proceed in its own host pool", () => {
    const tally = seeded();
    tally.notePendingSubmit("thr_a", A, NOW);
    tally.notePendingSubmit("thr_b", B, NOW);
    tally.noteActive("thr_b", B);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-b"), NOW)).toBe(1);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(2);
  });

  it("counts a proceed globally when its host is not known yet", () => {
    // The common first-message case: no environment has been chosen, so the
    // dispatch counts against the global pool but against no host's.
    const tally = seeded();
    tally.notePendingSubmit("thr_1", null, NOW);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(0);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    tally.noteActive("thr_1", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
  });

  it("expires a proceed whose thread never started", () => {
    // A dispatch can fail after our gate said yes — an invalid amendment from
    // a later gate, a provisioning failure. Without expiry those phantom slots
    // leak until reload and the limiter strangles itself.
    const tally = seeded();
    tally.notePendingSubmit("thr_1", A, NOW);
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
    const tally = seeded({ global: 2, byHost: { "host-a": 2 } });
    tally.noteFreed("thr_old", A);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
  });

  it("does not decrement twice when a thread goes idle and is then archived", () => {
    // Both events fire for the same thread and both mean "free"; treating the
    // second as another freed slot would inflate available capacity.
    const tally = seeded({ global: 2, byHost: { "host-a": 2 } });
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
  it("keeps hosts in separate pools while sharing the global one", () => {
    const tally = seeded();
    tally.noteActive("thr_a", A);
    tally.noteActive("thr_b", B);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(2);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-b"), NOW)).toBe(1);
  });

  it("counts a thread with no known host globally but under no host pool", () => {
    const tally = seeded();
    tally.noteActive("thr_1", null);
    expect(tally.count(GLOBAL_SCOPE_KEY, NOW)).toBe(1);
    expect(tally.count(hostScopeKey("host-a"), NOW)).toBe(0);
  });
});
