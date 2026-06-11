import type { QueryClient } from "@tanstack/react-query";
import type { DiffPatchEntry } from "@bb/server-contract";
import { environmentDiffPatchQueryKey } from "../queries/query-keys";

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

/** Cache one file's patch under the per-(target, path) diff-patch key. */
export function writeDiffPatchEntry({
  queryClient,
  identity,
  entry,
}: WriteDiffPatchEntryArgs): void {
  queryClient.setQueryData<DiffPatchEntry>(
    environmentDiffPatchQueryKey(
      identity.environmentId,
      identity.targetType,
      identity.targetKey,
      entry.path,
    ),
    entry,
  );
}
