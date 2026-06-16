import { useMemo } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { checkPathsExist } from "@/lib/api-host-daemon";
import {
  hostDaemonPortAtom,
  localHostDaemonHostIdAtom,
} from "@/lib/system-config-atoms";
import { useAsyncAtomValue } from "@/lib/use-async-atom-value";
import { localPathExistenceQueryKey } from "./query-keys";

export type LocalPathExistence = Record<string, boolean>;

/**
 * Probe the local host daemon to check whether each given path still exists
 * on disk. Returns `{}` while loading / unavailable; the consumer should
 * treat a missing entry as "unknown", not "exists".
 */
export function useLocalPathExistence(
  paths: readonly string[],
): LocalPathExistence {
  const localDaemonHostId = useAsyncAtomValue(localHostDaemonHostIdAtom, null);
  const daemonPort = useAsyncAtomValue(hostDaemonPortAtom, null);

  const sortedPaths = useMemo(() => {
    if (paths.length === 0) return [];
    return [...new Set(paths)].sort();
  }, [paths]);

  const enabled =
    localDaemonHostId != null && daemonPort != null && sortedPaths.length > 0;

  const query = useQuery({
    queryKey: localPathExistenceQueryKey(localDaemonHostId ?? "", sortedPaths),
    queryFn: enabled
      ? () => checkPathsExist(daemonPort, sortedPaths)
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
export function isLocalPathMissing(
  existence: LocalPathExistence,
  path: string | null | undefined,
): boolean {
  if (path == null) return false;
  return existence[path] === false;
}
