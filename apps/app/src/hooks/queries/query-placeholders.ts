import type { QueryKey } from "@tanstack/react-query";
import type {
  ProjectBranchesResponse,
  ThreadResponse,
  ThreadTimelineResponse,
} from "@bb/server-contract";
import {
  PROJECT_SOURCE_BRANCHES_QUERY_KEY,
  THREAD_QUERY_KEY,
  THREAD_TIMELINE_QUERY_KEY,
} from "./query-keys";

type ThreadScopedQueryKeyPrefix =
  | typeof THREAD_QUERY_KEY
  | typeof THREAD_TIMELINE_QUERY_KEY;

interface ResolveProjectSourceBranchesPlaceholderArgs {
  previousData: ProjectBranchesResponse | undefined;
  previousQueryKey: QueryKey | undefined;
  projectId: string;
  hostId: string;
  limit: number;
  selectedBranch: string;
}

function extractThreadIdFromThreadScopedQueryKey(
  queryKey: QueryKey | undefined,
  queryKeyPrefix: ThreadScopedQueryKeyPrefix,
): string | undefined {
  if (!queryKey || queryKey[0] !== queryKeyPrefix) {
    return undefined;
  }

  const threadId = queryKey[1];
  return typeof threadId === "string" ? threadId : undefined;
}

function resolveThreadScopedPlaceholder<TData>(
  previousData: TData | undefined,
  previousQueryKey: QueryKey | undefined,
  nextThreadId: string,
  queryKeyPrefix: ThreadScopedQueryKeyPrefix,
): TData | undefined {
  if (previousData === undefined) {
    return undefined;
  }

  return extractThreadIdFromThreadScopedQueryKey(
    previousQueryKey,
    queryKeyPrefix,
  ) === nextThreadId
    ? previousData
    : undefined;
}

export function resolveProjectSourceBranchesPlaceholder({
  previousData,
  previousQueryKey,
  projectId,
  hostId,
  limit,
  selectedBranch,
}: ResolveProjectSourceBranchesPlaceholderArgs):
  | ProjectBranchesResponse
  | undefined {
  if (
    previousData === undefined ||
    !previousQueryKey ||
    previousQueryKey[0] !== PROJECT_SOURCE_BRANCHES_QUERY_KEY
  ) {
    return undefined;
  }

  const previousProjectId = previousQueryKey[1];
  const previousHostId = previousQueryKey[2];
  const previousLimit = previousQueryKey[4];
  const previousSelectedBranch = previousQueryKey[5];

  return previousProjectId === projectId &&
    previousHostId === hostId &&
    previousLimit === limit &&
    previousSelectedBranch === selectedBranch
    ? previousData
    : undefined;
}

export function resolveThreadPlaceholder(
  previousData: ThreadResponse | undefined,
  previousQueryKey: QueryKey | undefined,
  nextThreadId: string,
): ThreadResponse | undefined {
  return resolveThreadScopedPlaceholder(
    previousData,
    previousQueryKey,
    nextThreadId,
    THREAD_QUERY_KEY,
  );
}

export function resolveThreadTimelinePlaceholder(
  previousData: ThreadTimelineResponse | undefined,
  previousQueryKey: QueryKey | undefined,
  nextThreadId: string,
): ThreadTimelineResponse | undefined {
  if (previousData === undefined) {
    return undefined;
  }

  const previousThreadId = extractThreadIdFromThreadScopedQueryKey(
    previousQueryKey,
    THREAD_TIMELINE_QUERY_KEY,
  );

  return previousThreadId === nextThreadId ? previousData : undefined;
}
