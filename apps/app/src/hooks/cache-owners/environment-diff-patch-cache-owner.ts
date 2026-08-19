import type { QueryClient } from "@tanstack/react-query";
import type { DiffPatchEntry } from "@bb/server-contract";
import { HEAVY_PAYLOAD_GC_TIME_MS } from "../queries/query-policies";
import {
  environmentDiffPatchQueryKey,
  environmentDiffPatchQueryKeyPrefix,
} from "../queries/query-keys";

/**
 * Identifies the diff-patch cache scope for one environment + diff target.
 * `targetType`/`targetKey` derive from the active `WorkspaceDiffTarget`, so a
 * target switch reads/writes under a distinct key and never collides.
 */
export interface PatchQueryIdentity {
  environmentId: string;
  targetType: string | null;
  targetKey: string | null;
}

/**
 * Per-environment eviction counter, bumped synchronously every time an
 * environment's patch cache is evicted (see
 * {@link bumpDiffPatchEvictionGeneration}). A patch fetch captures this counter
 * when it starts; if it no longer matches when the response lands, an eviction
 * happened mid-flight and the fetch must drop its (now stale) write instead of
 * re-seeding the just-cleared cache. The counter increments at eviction time —
 * before the async TOC refetch that re-triggers a fresh request — so the guard
 * holds even when a stale fetch resolves first.
 */
const diffPatchEvictionGenerations = new Map<string, number>();

/**
 * Advanced by {@link bumpAllDiffPatchEvictionGenerations} for an
 * all-environment eviction (e.g. server reconnect). Folded into every
 * environment's generation below so that environments never individually
 * evicted — and thus absent from the per-env map — still observe the bump.
 */
let allEnvironmentsEvictionGeneration = 0;

/** Current eviction generation for an environment (0 if never evicted). */
export function getDiffPatchEvictionGeneration(environmentId: string): number {
  return (
    (diffPatchEvictionGenerations.get(environmentId) ?? 0) +
    allEnvironmentsEvictionGeneration
  );
}

/** Increment an environment's eviction generation; call when its patches are evicted. */
export function bumpDiffPatchEvictionGeneration(environmentId: string): void {
  diffPatchEvictionGenerations.set(
    environmentId,
    (diffPatchEvictionGenerations.get(environmentId) ?? 0) + 1,
  );
}

/**
 * Bump EVERY environment's eviction generation — including ones never
 * individually evicted — by advancing a shared counter folded into
 * {@link getDiffPatchEvictionGeneration}. Call when the patch cache is evicted
 * for all environments at once (e.g. server reconnect), so a fetch in flight
 * under any environment drops its now-stale write.
 */
export function bumpAllDiffPatchEvictionGenerations(): void {
  allEnvironmentsEvictionGeneration += 1;
}

interface ReadDiffPatchEntryArgs {
  queryClient: QueryClient;
  identity: PatchQueryIdentity;
  path: string;
}

/** Read a single file's cached patch for the given target scope, if present. */
export function readDiffPatchEntry({
  queryClient,
  identity,
  path,
}: ReadDiffPatchEntryArgs): DiffPatchEntry | undefined {
  return queryClient.getQueryData<DiffPatchEntry>(
    environmentDiffPatchQueryKey(
      identity.environmentId,
      identity.targetType,
      identity.targetKey,
      path,
    ),
  );
}

interface WriteDiffPatchEntryArgs {
  queryClient: QueryClient;
  identity: PatchQueryIdentity;
  entry: DiffPatchEntry;
}

/**
 * Cache one file's patch under the per-(target, path) diff-patch key.
 *
 * Patch entries are observer-less (`getPatchState` reads them with
 * `getQueryData`), so React Query's `gcTime` would count from the write, not
 * from the last reader, and could drop a patch the panel is still showing.
 * The query is therefore built without a gc timer; retention is owned by
 * {@link retainDiffPatchQueries}, which evicts the environment's patches
 * {@link HEAVY_PAYLOAD_GC_TIME_MS} after the last reader unmounts.
 */
export function writeDiffPatchEntry({
  queryClient,
  identity,
  entry,
}: WriteDiffPatchEntryArgs): void {
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

interface DiffPatchRetentionLease {
  readers: number;
  evictionTimer: ReturnType<typeof setTimeout> | null;
}

const diffPatchRetentionLeases = new WeakMap<
  QueryClient,
  Map<string, DiffPatchRetentionLease>
>();

function getDiffPatchRetentionLeases(
  queryClient: QueryClient,
): Map<string, DiffPatchRetentionLease> {
  let leases = diffPatchRetentionLeases.get(queryClient);
  if (leases === undefined) {
    leases = new Map();
    diffPatchRetentionLeases.set(queryClient, leases);
  }
  return leases;
}

/**
 * Keep an environment's cached diff patches alive while a reader is mounted.
 * When the last reader releases its lease, the patches are evicted after
 * {@link HEAVY_PAYLOAD_GC_TIME_MS} — long enough for a quick thread
 * back-and-forth to keep its loaded diff, short enough that a browsing session
 * on a phone does not accumulate every visited thread's patches. A reader that
 * mounts again inside that window cancels the pending eviction. Returns the
 * release function.
 */
export function retainDiffPatchQueries({
  queryClient,
  environmentId,
}: {
  queryClient: QueryClient;
  environmentId: string;
}): () => void {
  const leases = getDiffPatchRetentionLeases(queryClient);
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
    if (released) {
      return;
    }
    released = true;
    lease.readers -= 1;
    if (lease.readers > 0) {
      return;
    }
    lease.evictionTimer = setTimeout(() => {
      lease.evictionTimer = null;
      if (lease.readers > 0) {
        return;
      }
      leases.delete(environmentId);
      bumpDiffPatchEvictionGeneration(environmentId);
      queryClient.removeQueries({
        queryKey: environmentDiffPatchQueryKeyPrefix(environmentId),
      });
    }, HEAVY_PAYLOAD_GC_TIME_MS);
  };
}
