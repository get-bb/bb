import {
  assertWorkTogetherMembershipLookup,
  freezeWorkTogetherMembership,
  type WorkTogetherMembership,
  type WorkTogetherMembershipLookup,
  type WorkTogetherMembershipVerifier,
} from "./work-together-membership.js";

const DEFAULT_TTL_MS = 5_000;
const MIN_TTL_MS = 1;
const MAX_TTL_MS = 5_000;

const DEFAULT_MAX_ENTRIES = 10_000;
const MIN_MAX_ENTRIES = 1;
const MAX_MAX_ENTRIES = 100_000;

export type WorkTogetherMembershipPositiveCacheOptions = {
  readonly delegate: WorkTogetherMembershipVerifier;
  /** Cache TTL in milliseconds. Integer 1..5000; default 5000. */
  readonly ttlMs?: number;
  /** Maximum unexpired positive entries. Integer 1..100000; default 10000. */
  readonly maxEntries?: number;
  /** Clock returning epoch milliseconds. Defaults to Date.now. */
  readonly now?: () => number;
};

type CacheEntry = {
  readonly value: WorkTogetherMembership;
  readonly expiresAt: number;
};

/**
 * Positive-only membership cache wrapper.
 *
 * Caches only non-null successful results. Never caches null or errors. At full
 * unexpired capacity returns the fresh authority result without caching and
 * never fails a successful lookup because the cache is full.
 */
export function createWorkTogetherMembershipPositiveCache(
  options: WorkTogetherMembershipPositiveCacheOptions,
): WorkTogetherMembershipVerifier {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const now = options.now ?? Date.now;
  assertBoundedPositiveInteger(ttlMs, MIN_TTL_MS, MAX_TTL_MS, "ttlMs");
  assertBoundedPositiveInteger(
    maxEntries,
    MIN_MAX_ENTRIES,
    MAX_MAX_ENTRIES,
    "maxEntries",
  );

  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<WorkTogetherMembership | null>>();

  return {
    currentMembership(args) {
      let key: string;
      let observedAt: number;
      try {
        assertWorkTogetherMembershipLookup(args);
        key = cacheKey(args);
        observedAt = readClock(now);
      } catch (error) {
        return Promise.reject(error);
      }
      pruneExpired(cache, observedAt);

      const hit = cache.get(key);
      if (hit !== undefined && observedAt < hit.expiresAt) {
        return Promise.resolve(hit.value);
      }
      if (hit !== undefined) {
        cache.delete(key);
      }

      const inFlight = pending.get(key);
      if (inFlight !== undefined) {
        return inFlight;
      }

      const lookup: Promise<WorkTogetherMembership | null> = options.delegate
        .currentMembership(args)
        .then((result) => {
          if (result !== null) {
            const validatedResult = freezeWorkTogetherMembership(result);
            const storeAt = readClock(now);
            pruneExpired(cache, storeAt);
            if (cache.size < maxEntries) {
              cache.set(key, {
                value: validatedResult,
                expiresAt: storeAt + ttlMs,
              });
            }
            return validatedResult;
          }
          return result;
        })
        .finally(() => {
          if (pending.get(key) === lookup) {
            pending.delete(key);
          }
        });

      pending.set(key, lookup);
      return lookup;
    },
  };
}

function readClock(now: () => number): number {
  const value = now();
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER - MAX_TTL_MS
  ) {
    throw new Error("Invalid Work Together membership cache clock");
  }
  return value;
}

function cacheKey(args: WorkTogetherMembershipLookup): string {
  // Exact pair; cellId and subject never contain this separator.
  return `${args.cellId}\0${args.subject}`;
}

function pruneExpired(cache: Map<string, CacheEntry>, nowMs: number): void {
  for (const [key, entry] of cache) {
    if (nowMs >= entry.expiresAt) {
      cache.delete(key);
    }
  }
}

function assertBoundedPositiveInteger(
  value: number,
  min: number,
  max: number,
  name: string,
): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new Error(`Invalid Work Together membership cache ${name}`);
  }
}
