import type { QueryClient } from "@tanstack/react-query";
import type { DiffPatchEntry } from "@bb/server-contract";
import {
  environmentDiffPatchQueryKey,
  environmentDiffPatchQueryKeyPrefix,
} from "./query-keys";

/**
 * The diff tab's per-file patch cache (mirror of
 * apps/app/src/hooks/cache-owners/environment-diff-patch-cache-owner.ts).
 *
 * Patches live in the profile QueryClient under a per-(environment, target,
 * path) key but have no query observers: the patch hook reads them with
 * `getQueryData`. Two consequences the web design handles and this module
 * keeps:
 *
 * - React Query's `gcTime` would count from the write, not from the last
 *   reader, so entries are built with `gcTime: Infinity` and retention is
 *   owned by {@link retainDiffPatchQueries} (evict a while after the last
 *   reader unmounts).
 * - Realtime workspace events must *evict* (remove) the patches, not
 *   invalidate them, because nothing would refetch an observer-less query;
 *   `getQueryData` returning undefined is what makes the list re-request a
 *   visible path. Every eviction bumps a per-environment generation so a
 *   patch fetch that started before the eviction drops its now-stale write
 *   instead of re-seeding the just-cleared cache.
 *
 * Generations are tracked per QueryClient (each server profile owns one) so
 * two profiles never share counters.
 */

export interface PatchQueryIdentity {
  environmentId: string;
  targetType: string | null;
  targetKey: string | null;
}

interface EvictionGenerations {
  perEnvironment: Map<string, number>;
  /** Folded into every environment's generation (all-environment evictions). */
  all: number;
}

const evictionGenerationsByClient = new WeakMap<
  QueryClient,
  EvictionGenerations
>();

function getGenerations(queryClient: QueryClient): EvictionGenerations {
  let generations = evictionGenerationsByClient.get(queryClient);
  if (generations === undefined) {
    generations = { perEnvironment: new Map(), all: 0 };
    evictionGenerationsByClient.set(queryClient, generations);
  }
  return generations;
}

/** Current eviction generation for an environment (0 if never evicted). */
export function getDiffPatchEvictionGeneration(
  queryClient: QueryClient,
  environmentId: string,
): number {
  const generations = getGenerations(queryClient);
  return (generations.perEnvironment.get(environmentId) ?? 0) + generations.all;
}

/**
 * Evict one environment's cached patches: bump its generation first (so an
 * in-flight fetch resolving later drops its write), then remove the queries.
 */
export function removeEnvironmentDiffPatchQueries(
  queryClient: QueryClient,
  environmentId: string,
): void {
  const generations = getGenerations(queryClient);
  generations.perEnvironment.set(
    environmentId,
    (generations.perEnvironment.get(environmentId) ?? 0) + 1,
  );
  queryClient.removeQueries({
    queryKey: environmentDiffPatchQueryKeyPrefix(environmentId),
  });
}

/** Evict every environment's cached patches (a global environment change). */
export function removeAllDiffPatchQueries(queryClient: QueryClient): void {
  const generations = getGenerations(queryClient);
  generations.all += 1;
  queryClient.removeQueries({
    queryKey: [environmentDiffPatchQueryKeyPrefix("")[0]],
  });
}

/** Read a single file's cached patch for the given target scope, if present. */
export function readDiffPatchEntry(
  queryClient: QueryClient,
  identity: PatchQueryIdentity,
  path: string,
): DiffPatchEntry | undefined {
  return queryClient.getQueryData<DiffPatchEntry>(
    environmentDiffPatchQueryKey(
      identity.environmentId,
      identity.targetType,
      identity.targetKey,
      path,
    ),
  );
}

/** Cache one file's patch under the per-(target, path) key (no gc timer). */
export function writeDiffPatchEntry(
  queryClient: QueryClient,
  identity: PatchQueryIdentity,
  entry: DiffPatchEntry,
): void {
  const queryKey = environmentDiffPatchQueryKey(
    identity.environmentId,
    identity.targetType,
    identity.targetKey,
    entry.path,
  );
  queryClient
    .getQueryCache()
    .build(queryClient, { queryKey, gcTime: Infinity });
  queryClient.setQueryData<DiffPatchEntry>(queryKey, entry);
}

/** How long an environment's patches outlive their last reader. */
const DIFF_PATCH_RETENTION_MS = 2 * 60_000;

interface DiffPatchRetentionLease {
  readers: number;
  evictionTimer: ReturnType<typeof setTimeout> | null;
}

const retentionLeasesByClient = new WeakMap<
  QueryClient,
  Map<string, DiffPatchRetentionLease>
>();

function getRetentionLeases(
  queryClient: QueryClient,
): Map<string, DiffPatchRetentionLease> {
  let leases = retentionLeasesByClient.get(queryClient);
  if (leases === undefined) {
    leases = new Map();
    retentionLeasesByClient.set(queryClient, leases);
  }
  return leases;
}

/**
 * Keep an environment's cached patches alive while a reader is mounted. When
 * the last reader releases, the patches are evicted after
 * {@link DIFF_PATCH_RETENTION_MS} — long enough for a quick close/reopen of
 * the panel to keep its loaded diff, short enough that browsing many threads
 * on a phone does not accumulate every visited diff. A reader that mounts
 * again inside that window cancels the pending eviction. Returns the release
 * function (idempotent).
 */
export function retainDiffPatchQueries(
  queryClient: QueryClient,
  environmentId: string,
  retentionMs: number = DIFF_PATCH_RETENTION_MS,
): () => void {
  const leases = getRetentionLeases(queryClient);
  let lease = leases.get(environmentId);
  if (lease === undefined) {
    lease = { readers: 0, evictionTimer: null };
    leases.set(environmentId, lease);
  }
  if (lease.evictionTimer !== null) {
    clearTimeout(lease.evictionTimer);
    lease.evictionTimer = null;
  }
  lease.readers += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lease.readers -= 1;
    if (lease.readers > 0) return;
    lease.evictionTimer = setTimeout(() => {
      lease.evictionTimer = null;
      if (lease.readers > 0) return;
      leases.delete(environmentId);
      removeEnvironmentDiffPatchQueries(queryClient, environmentId);
    }, retentionMs);
  };
}
