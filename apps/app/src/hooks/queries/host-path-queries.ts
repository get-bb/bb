import { useMemo } from "react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { mergeRootResolutions } from "@/components/ui/markdown-relative-link-healing";
import {
  PATHS_EXIST_MAX_PATHS,
  type PathResolution,
} from "@bb/host-daemon-contract";
import { sdk } from "@/lib/sdk";
import {
  hostPathExistenceQueryKey,
  hostPathExistsQueryKey,
  hostPathResolutionQueryKey,
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

export interface HostPathRoot {
  hostId: string;
  rootPath: string;
}

interface HostPathResolveBatch {
  paths: Set<string>;
  resolutions: Promise<Record<string, PathResolution>>;
}

interface HostRootGroup {
  hostId: string;
  rootPaths: string[];
}

const MISSING_RESOLUTION: PathResolution = { kind: "matches", paths: [] };

const pendingHostPathResolveBatches = new Map<string, HostPathResolveBatch>();

function createHostPathResolveBatch(
  key: string,
  group: HostRootGroup,
): HostPathResolveBatch {
  const paths = new Set<string>();
  const batch: HostPathResolveBatch = {
    paths,
    resolutions: new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    }).then(async () => {
      if (pendingHostPathResolveBatches.get(key) === batch) {
        pendingHostPathResolveBatches.delete(key);
      }
      return (
        await sdk.hosts.experimental_resolvePaths({
          hostId: group.hostId,
          roots: group.rootPaths,
          paths: [...paths],
        })
      ).resolutions;
    }),
  };
  return batch;
}

async function loadHostPathResolution(
  group: HostRootGroup,
  path: string,
): Promise<PathResolution> {
  const key = JSON.stringify([group.hostId, group.rootPaths]);
  let batch = pendingHostPathResolveBatches.get(key);
  if (batch === undefined || batch.paths.size >= PATHS_EXIST_MAX_PATHS) {
    batch = createHostPathResolveBatch(key, group);
    pendingHostPathResolveBatches.set(key, batch);
  }
  batch.paths.add(path);
  return (await batch.resolutions)[path] ?? MISSING_RESOLUTION;
}

function groupRootsByHost(roots: readonly HostPathRoot[]): HostRootGroup[] {
  const groups: HostRootGroup[] = [];
  for (const root of roots) {
    const last = groups.at(-1);
    if (last?.hostId === root.hostId) last.rootPaths.push(root.rootPath);
    else groups.push({ hostId: root.hostId, rootPaths: [root.rootPath] });
  }
  return groups;
}

export function useRelativePathResolution(
  roots: readonly HostPathRoot[],
  path: string | null,
): PathResolution | undefined {
  const query = useQuery({
    queryKey: hostPathResolutionQueryKey(roots, path ?? ""),
    queryFn:
      path === null || roots.length === 0
        ? skipToken
        : async () =>
            mergeRootResolutions(
              await Promise.all(
                groupRootsByHost(roots).map((group) =>
                  loadHostPathResolution(group, path),
                ),
              ),
            ),
    staleTime: HOST_PATH_EXISTENCE_STALE_TIME_MS,
  });
  return query.data;
}

export function isHostPathMissing(
  existence: HostPathExistence,
  path: string | null | undefined,
): boolean {
  if (path == null) return false;
  return existence[path] === false;
}
