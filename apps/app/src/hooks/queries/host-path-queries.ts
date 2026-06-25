import { useMemo } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { checkHostPathsExist } from "@/lib/api";
import { hostPathExistenceQueryKey } from "./query-keys";

export type HostPathExistence = Record<string, boolean>;

/**
 * Probe the selected work host to check whether each given path still exists
 * on disk. Returns `{}` while loading / unavailable; the consumer should treat
 * a missing entry as "unknown", not "exists".
 */
export function useHostPathExistence(
  hostId: string | null,
  paths: readonly string[],
): HostPathExistence {
  const sortedPaths = useMemo(() => {
    if (paths.length === 0) return [];
    return [...new Set(paths)].sort();
  }, [paths]);
  const enabledHostId = hostId !== null && sortedPaths.length > 0 ? hostId : null;

  const query = useQuery({
    queryKey: hostPathExistenceQueryKey(hostId, sortedPaths),
    queryFn: enabledHostId
      ? ({ signal }) =>
          checkHostPathsExist(enabledHostId, sortedPaths, signal)
      : skipToken,
    staleTime: 10_000,
  });

  return query.data ?? {};
}

/**
 * Returns true only when we have a definitive "missing" answer from the
 * daemon. Loading, errors, and unknown paths all return false so the UI
 * doesn't flash a destructive warning for transient state.
 */
export function isHostPathMissing(
  existence: HostPathExistence,
  path: string | null | undefined,
): boolean {
  if (path == null) return false;
  return existence[path] === false;
}
