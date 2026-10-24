import type { QueryClient } from "@tanstack/react-query";

import type { EnvironmentDiffViewedResponse } from "@bb/server-contract";
import {
  environmentDiffTargetKey,
  environmentDiffViewedQueryKey,
} from "../queries/query-keys";
import { cancelOptimisticQueries } from "./optimistic-query-cancellation";
import type { WorkspaceDiffTarget } from "@bb/domain";

interface DiffViewedChange {
  environmentId: string;
  target: WorkspaceDiffTarget;
  path: string;
  revision: string;
  viewed: boolean;
}

function diffViewedQueryKey({ environmentId, target }: DiffViewedChange) {
  return environmentDiffViewedQueryKey(
    environmentId,
    target.type,
    environmentDiffTargetKey(target),
  );
}

export async function applyOptimisticDiffViewedChange(
  queryClient: QueryClient,
  change: DiffViewedChange,
): Promise<void> {
  const queryKey = diffViewedQueryKey(change);
  await cancelOptimisticQueries(queryClient, { queryKey });
  queryClient.setQueriesData<EnvironmentDiffViewedResponse>(
    {
      queryKey,
      predicate: (query) => {
        const paths = query.queryKey[4];
        return Array.isArray(paths) && paths.includes(change.path);
      },
    },
    (previous) => {
      const files = (previous?.files ?? []).filter(
        (file) => file.path !== change.path,
      );
      return {
        files: change.viewed
          ? [...files, { path: change.path, revision: change.revision }]
          : files,
      };
    },
  );
}

export function invalidateDiffViewedQuery(
  queryClient: QueryClient,
  change: DiffViewedChange,
): void {
  void queryClient.invalidateQueries({ queryKey: diffViewedQueryKey(change) });
}
