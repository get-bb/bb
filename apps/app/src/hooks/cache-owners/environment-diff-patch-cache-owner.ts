import type { QueryClient } from "@tanstack/react-query";
import type { DiffPatchEntry } from "@bb/server-contract";
import { HEAVY_PAYLOAD_GC_TIME_MS } from "../queries/query-policies";
import {
  environmentDiffPatchQueryKey,
  environmentDiffPatchQueryKeyPrefix,
} from "../queries/query-keys";

export interface PatchQueryIdentity {
  environmentId: string;
  targetType: string | null;
  targetKey: string | null;
}

const diffPatchEvictionGenerations = new Map<string, number>();
const diffPatchFreshnessGenerations = new Map<string, number>();

let allEnvironmentsEvictionGeneration = 0;

export function getDiffPatchEvictionGeneration(environmentId: string): number {
  return (
    (diffPatchEvictionGenerations.get(environmentId) ?? 0) +
    allEnvironmentsEvictionGeneration
  );
}

export function bumpDiffPatchEvictionGeneration(environmentId: string): void {
  diffPatchEvictionGenerations.set(
    environmentId,
    (diffPatchEvictionGenerations.get(environmentId) ?? 0) + 1,
  );
  bumpDiffPatchFreshnessGeneration(environmentId);
}

export function getDiffPatchFreshnessGeneration(environmentId: string): number {
  return diffPatchFreshnessGenerations.get(environmentId) ?? 0;
}

export function bumpDiffPatchFreshnessGeneration(environmentId: string): void {
  diffPatchFreshnessGenerations.set(
    environmentId,
    getDiffPatchFreshnessGeneration(environmentId) + 1,
  );
}

export function bumpAllDiffPatchEvictionGenerations(): void {
  allEnvironmentsEvictionGeneration += 1;
}

interface ReadDiffPatchEntryArgs {
  queryClient: QueryClient;
  identity: PatchQueryIdentity;
  path: string;
}

const diffPatchFreshnessByClient = new WeakMap<
  QueryClient,
  Map<string, Map<string, number>>
>();

function getDiffPatchFreshnessEntries(
  queryClient: QueryClient,
  environmentId: string,
): Map<string, number> {
  let entriesByEnvironment = diffPatchFreshnessByClient.get(queryClient);
  if (entriesByEnvironment === undefined) {
    entriesByEnvironment = new Map();
    diffPatchFreshnessByClient.set(queryClient, entriesByEnvironment);
  }
  let entries = entriesByEnvironment.get(environmentId);
  if (entries === undefined) {
    entries = new Map();
    entriesByEnvironment.set(environmentId, entries);
  }
  return entries;
}

function diffPatchEntryFreshnessKey(
  identity: PatchQueryIdentity,
  path: string,
): string {
  return JSON.stringify([identity.targetType, identity.targetKey, path]);
}

export function isDiffPatchEntryFresh({
  queryClient,
  identity,
  path,
}: ReadDiffPatchEntryArgs): boolean {
  const freshnessGeneration = getDiffPatchFreshnessGeneration(
    identity.environmentId,
  );
  const entryGeneration = getDiffPatchFreshnessEntries(
    queryClient,
    identity.environmentId,
  ).get(diffPatchEntryFreshnessKey(identity, path));
  return entryGeneration === undefined
    ? freshnessGeneration === 0
    : entryGeneration === freshnessGeneration;
}

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
  freshnessGeneration?: number;
}

export function writeDiffPatchEntry({
  queryClient,
  identity,
  entry,
  freshnessGeneration = getDiffPatchFreshnessGeneration(identity.environmentId),
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
  getDiffPatchFreshnessEntries(queryClient, identity.environmentId).set(
    diffPatchEntryFreshnessKey(identity, entry.path),
    freshnessGeneration,
  );
}

export function pruneDiffPatchEntries({
  queryClient,
  identity,
  paths,
}: {
  queryClient: QueryClient;
  identity: PatchQueryIdentity;
  paths: readonly string[];
}): void {
  const retainedPaths = new Set(paths);
  const entries = getDiffPatchFreshnessEntries(
    queryClient,
    identity.environmentId,
  );
  for (const key of Array.from(entries.keys())) {
    const [targetType, targetKey, path] = JSON.parse(key) as [
      string | null,
      string | null,
      string,
    ];
    if (
      targetType !== identity.targetType ||
      targetKey !== identity.targetKey ||
      retainedPaths.has(path)
    ) {
      continue;
    }
    entries.delete(key);
    queryClient.removeQueries({
      exact: true,
      queryKey: environmentDiffPatchQueryKey(
        identity.environmentId,
        identity.targetType,
        identity.targetKey,
        path,
      ),
    });
  }
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
      diffPatchFreshnessByClient.get(queryClient)?.delete(environmentId);
      queryClient.removeQueries({
        queryKey: environmentDiffPatchQueryKeyPrefix(environmentId),
      });
    }, HEAVY_PAYLOAD_GC_TIME_MS);
  };
}
