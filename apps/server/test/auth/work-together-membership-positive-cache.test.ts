import { describe, expect, it } from "vitest";
import { createWorkTogetherMembershipPositiveCache } from "../../src/auth/work-together-membership-positive-cache.js";
import {
  freezeWorkTogetherMembership,
  type WorkTogetherMembership,
  type WorkTogetherMembershipLookup,
  type WorkTogetherMembershipVerifier,
} from "../../src/auth/work-together-membership.js";

const CELL_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CELL_B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const SUBJECT_A = "user_alice0001";
const SUBJECT_B = "user_bob0000002";
const LARGE_REVISION = "9007199254740993";

function membership(
  role: "owner" | "member",
  revision: string,
): WorkTogetherMembership {
  return freezeWorkTogetherMembership({
    role,
    membershipRevision: revision,
  });
}

function createDelegate(handler: {
  currentMembership: (
    args: WorkTogetherMembershipLookup,
  ) => Promise<WorkTogetherMembership | null>;
}): WorkTogetherMembershipVerifier & {
  calls: WorkTogetherMembershipLookup[];
} {
  const calls: WorkTogetherMembershipLookup[] = [];
  return {
    calls,
    async currentMembership(args) {
      calls.push(args);
      return handler.currentMembership(args);
    },
  };
}

describe("work-together membership positive-only cache", () => {
  it("returns a cached positive hit without reconsulting the delegate", async () => {
    let now = 1_000;
    const frozen = membership("owner", "7");
    const delegate = createDelegate({
      async currentMembership() {
        return frozen;
      },
    });
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate,
      now: () => now,
      ttlMs: 5_000,
    });

    const first = await cache.currentMembership({
      cellId: CELL_A,
      subject: SUBJECT_A,
    });
    now = 1_000 + 4_999;
    const second = await cache.currentMembership({
      cellId: CELL_A,
      subject: SUBJECT_A,
    });

    expect(first).toEqual(frozen);
    expect(first).not.toBe(frozen);
    expect(second).toBe(first);
    expect(Object.isFrozen(second)).toBe(true);
    expect(delegate.calls).toHaveLength(1);
  });

  it("expires exactly when now >= expiresAt (default 5s boundary)", async () => {
    let now = 10_000;
    let revision = "1";
    const delegate = createDelegate({
      async currentMembership() {
        return membership("member", revision);
      },
    });
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate,
      now: () => now,
      // default ttlMs = 5000
    });

    const first = await cache.currentMembership({
      cellId: CELL_A,
      subject: SUBJECT_A,
    });
    expect(first?.membershipRevision).toBe("1");

    now = 10_000 + 4_999;
    revision = "2";
    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toEqual({ role: "member", membershipRevision: "1" });
    expect(delegate.calls).toHaveLength(1);

    now = 10_000 + 5_000;
    revision = "3";
    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toEqual({ role: "member", membershipRevision: "3" });
    expect(delegate.calls).toHaveLength(2);
  });

  it("never caches null results", async () => {
    let now = 0;
    let result: WorkTogetherMembership | null = null;
    const delegate = createDelegate({
      async currentMembership() {
        return result;
      },
    });
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate,
      now: () => now,
      ttlMs: 5_000,
    });

    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toBeNull();

    result = membership("owner", "1");
    now = 1;
    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "1" });
    expect(delegate.calls).toHaveLength(2);
  });

  it("never caches errors and clears settled pending promises", async () => {
    let now = 0;
    let shouldFail = true;
    const delegate = createDelegate({
      async currentMembership() {
        if (shouldFail) {
          throw new Error("authority unavailable");
        }
        return membership("owner", "9");
      },
    });
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate,
      now: () => now,
      ttlMs: 5_000,
    });

    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).rejects.toThrow("authority unavailable");

    shouldFail = false;
    now = 1;
    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "9" });
    expect(delegate.calls).toHaveLength(2);
  });

  it("revalidates and freezes delegate results before returning or caching", async () => {
    const mutable = { role: "owner", membershipRevision: "1" } as const;
    const delegate = createDelegate({
      async currentMembership() {
        return mutable;
      },
    });
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate,
      now: () => 0,
    });

    const result = await cache.currentMembership({
      cellId: CELL_A,
      subject: SUBJECT_A,
    });
    expect(result).toEqual(mutable);
    expect(result).not.toBe(mutable);
    expect(Object.isFrozen(result)).toBe(true);

    const invalidDelegate = createDelegate({
      async currentMembership() {
        return {
          role: "owner",
          membershipRevision: "0",
        } as WorkTogetherMembership;
      },
    });
    const invalidCache = createWorkTogetherMembershipPositiveCache({
      delegate: invalidDelegate,
      now: () => 0,
    });
    await expect(
      invalidCache.currentMembership({
        cellId: CELL_A,
        subject: SUBJECT_A,
      }),
    ).rejects.toThrow(/membership lookup failed/i);
  });

  it("rejects invalid clock readings without consulting authority", async () => {
    const delegate = createDelegate({
      async currentMembership() {
        return membership("owner", "1");
      },
    });
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate,
      now: () => Number.NaN,
    });

    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).rejects.toThrow(/cache clock/i);
    expect(delegate.calls).toHaveLength(0);
  });

  it("rejects malformed lookup keys before consulting authority", async () => {
    const delegate = createDelegate({
      async currentMembership() {
        return membership("owner", "1");
      },
    });
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate,
      now: () => 0,
    });

    await expect(
      cache.currentMembership({ cellId: "not-a-cell", subject: SUBJECT_A }),
    ).rejects.toThrow(/invalid work together membership lookup/i);
    expect(delegate.calls).toHaveLength(0);
  });

  it("isolates cache entries per cellId and per subject", async () => {
    const delegate = createDelegate({
      async currentMembership(args) {
        if (args.cellId === CELL_A && args.subject === SUBJECT_A) {
          return membership("owner", "1");
        }
        if (args.cellId === CELL_A && args.subject === SUBJECT_B) {
          return membership("member", "2");
        }
        if (args.cellId === CELL_B && args.subject === SUBJECT_A) {
          return membership("member", "3");
        }
        return null;
      },
    });
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate,
      now: () => 0,
      ttlMs: 5_000,
    });

    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "1" });
    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_B }),
    ).resolves.toEqual({ role: "member", membershipRevision: "2" });
    await expect(
      cache.currentMembership({ cellId: CELL_B, subject: SUBJECT_A }),
    ).resolves.toEqual({ role: "member", membershipRevision: "3" });

    // Hits must not cross keys.
    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "1" });
    expect(delegate.calls).toHaveLength(3);
  });

  it("coalesces concurrent identical lookups into one delegate call", async () => {
    let resolveDelegate!: (value: WorkTogetherMembership) => void;
    const delegatePromise = new Promise<WorkTogetherMembership>((resolve) => {
      resolveDelegate = resolve;
    });
    const delegate = createDelegate({
      async currentMembership() {
        return delegatePromise;
      },
    });
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate,
      now: () => 0,
      ttlMs: 5_000,
    });

    const pendingA = cache.currentMembership({
      cellId: CELL_A,
      subject: SUBJECT_A,
    });
    const pendingB = cache.currentMembership({
      cellId: CELL_A,
      subject: SUBJECT_A,
    });

    expect(delegate.calls).toHaveLength(1);
    const frozen = membership("owner", LARGE_REVISION);
    resolveDelegate(frozen);

    const [resolvedA, resolvedB] = await Promise.all([pendingA, pendingB]);
    expect(resolvedA).toEqual(frozen);
    expect(resolvedA).not.toBe(frozen);
    expect(resolvedB).toBe(resolvedA);
    expect(pendingA).toBe(pendingB);

    // Settled pending is cleared; a later call can hit the positive cache.
    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toBe(resolvedA);
    expect(delegate.calls).toHaveLength(1);
  });

  it("at full unexpired capacity returns fresh authority without eviction or fail-open", async () => {
    let now = 0;
    const revisions = ["1", "2", "3", "4"];
    let call = 0;
    const controlled = createDelegate({
      async currentMembership() {
        const revision = revisions[call] ?? "999";
        call += 1;
        return membership("owner", revision);
      },
    });

    const cache = createWorkTogetherMembershipPositiveCache({
      delegate: controlled,
      now: () => now,
      ttlMs: 5_000,
      maxEntries: 1,
    });

    const first = await cache.currentMembership({
      cellId: CELL_A,
      subject: SUBJECT_A,
    });
    expect(first).toEqual({ role: "owner", membershipRevision: "1" });

    // Cache is full with one unexpired entry. A different key still succeeds
    // but must not be stored and must not evict the first entry.
    const second = await cache.currentMembership({
      cellId: CELL_B,
      subject: SUBJECT_B,
    });
    expect(second).toEqual({ role: "owner", membershipRevision: "2" });
    expect(controlled.calls).toHaveLength(2);

    // Original key remains a positive hit.
    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "1" });
    expect(controlled.calls).toHaveLength(2);

    // Second key was not cached — another lookup reconsults authority.
    await expect(
      cache.currentMembership({ cellId: CELL_B, subject: SUBJECT_B }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "3" });
    expect(controlled.calls).toHaveLength(3);

    // After expiry of the sole entry, capacity frees without fail-open gaps.
    now = 5_000;
    await expect(
      cache.currentMembership({ cellId: CELL_A, subject: SUBJECT_A }),
    ).resolves.toEqual({ role: "owner", membershipRevision: "4" });
  });

  it("rejects out-of-range ttlMs and maxEntries at construction", () => {
    const delegate = createDelegate({
      async currentMembership() {
        return null;
      },
    });

    expect(() =>
      createWorkTogetherMembershipPositiveCache({
        delegate,
        ttlMs: 0,
      }),
    ).toThrow(/ttlMs/);
    expect(() =>
      createWorkTogetherMembershipPositiveCache({
        delegate,
        ttlMs: 5_001,
      }),
    ).toThrow(/ttlMs/);
    expect(() =>
      createWorkTogetherMembershipPositiveCache({
        delegate,
        maxEntries: 0,
      }),
    ).toThrow(/maxEntries/);
    expect(() =>
      createWorkTogetherMembershipPositiveCache({
        delegate,
        maxEntries: 100_001,
      }),
    ).toThrow(/maxEntries/);
  });

  it("does not expose mutable cache state on the verifier", () => {
    const cache = createWorkTogetherMembershipPositiveCache({
      delegate: createDelegate({
        async currentMembership() {
          return membership("owner", "1");
        },
      }),
    });

    expect(cache).toEqual({
      currentMembership: expect.any(Function),
    });
    expect(Object.keys(cache)).toEqual(["currentMembership"]);
    expect(
      Object.getOwnPropertyNames(cache).filter(
        (name) => name !== "currentMembership",
      ),
    ).toEqual([]);
  });
});
