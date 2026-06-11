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
