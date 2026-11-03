import { useMemo } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { PATHS_EXIST_MAX_PATHS } from "@bb/host-daemon-contract";
import { sdk } from "@/lib/sdk";
import {
  hostPathExistenceQueryKey,
  hostPathExistsQueryKey,
} from "./query-keys";

type HostPathExistence = Record<string, boolean>;

interface HostPathExistsBatch {
  existence: Promise<HostPathExistence>;
  paths: Set<string>;
}

const HOST_PATH_EXISTENCE_STALE_TIME_MS = 10_000;

const pendingHostPathExistsBatches = new Map<string, HostPathExistsBatch>();

export function useHostPathExistence(
  hostId: string | null,
  paths: readonly string[],
): HostPathExistence {
  const sortedPaths = useMemo(() => {
    if (paths.length === 0) return [];
    return [...new Set(paths)].sort();
  }, [paths]);
  const enabledHostId =
    hostId !== null && sortedPaths.length > 0 ? hostId : null;

  const query = useQuery({
    queryKey: hostPathExistenceQueryKey(hostId, sortedPaths),
    queryFn: enabledHostId
      ? async ({ signal }) =>
          (
            await sdk.hosts.pathsExist({
              hostId: enabledHostId,
              paths: sortedPaths,
              signal,
            })
          ).existence
      : skipToken,
    staleTime: HOST_PATH_EXISTENCE_STALE_TIME_MS,
  });

  return query.data ?? {};
}

function createHostPathExistsBatch(hostId: string): HostPathExistsBatch {
  const paths = new Set<string>();
  const batch: HostPathExistsBatch = {
    paths,
    existence: new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    }).then(async () => {
      if (pendingHostPathExistsBatches.get(hostId) === batch) {
        pendingHostPathExistsBatches.delete(hostId);
      }
      return (await sdk.hosts.pathsExist({ hostId, paths: [...paths] }))
        .existence;
    }),
  };
  return batch;
}

async function loadHostPathExists(
  hostId: string,
  path: string,
): Promise<boolean> {
  let batch = pendingHostPathExistsBatches.get(hostId);
  if (batch === undefined || batch.paths.size >= PATHS_EXIST_MAX_PATHS) {
    batch = createHostPathExistsBatch(hostId);
    pendingHostPathExistsBatches.set(hostId, batch);
  }
  batch.paths.add(path);
  return (await batch.existence)[path] === true;
}

export function useHostPathExists(hostId: string, path: string): boolean {
  const query = useQuery({
    queryKey: hostPathExistsQueryKey(hostId, path),
    queryFn: () => loadHostPathExists(hostId, path),
    staleTime: HOST_PATH_EXISTENCE_STALE_TIME_MS,
  });
  return query.data === true;
}

export function isHostPathMissing(
  existence: HostPathExistence,
  path: string | null | undefined,
): boolean {
  if (path == null) return false;
  return existence[path] === false;
}
