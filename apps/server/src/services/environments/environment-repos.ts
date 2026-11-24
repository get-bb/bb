import {
  areHostPathsEqual,
  getHostPathSegments,
  getRelativeHostPath,
  splitHostPathRoot,
} from "@bb/domain";
import type {
  EnvironmentRepo,
  EnvironmentReposResponse,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { listEnvironmentExtraFolderPaths } from "./environment-workspace-folders.js";
import type { EnvironmentAdditionalPath } from "../projects/workspace-folder-paths.js";

const FIND_GIT_REPOS_MAX_DEPTH = 2;
const FIND_GIT_REPOS_MAX_REPOS = 32;
const REPOS_CACHE_TTL_MS = 10_000;
const REPOS_CACHE_MAX_ENTRIES = 256;

export interface EnvironmentReposTarget {
  additionalPaths: readonly EnvironmentAdditionalPath[];
  hostId: string;
  id: string;
  path: string;
  projectId: string;
}

interface CachedRepos {
  expiresAt: number;
  signature: string;
  value: Promise<EnvironmentReposResponse>;
}

const reposCacheByDb = new WeakMap<object, Map<string, CachedRepos>>();

function cacheFor(deps: WorkSessionDeps): Map<string, CachedRepos> {
  let cache = reposCacheByDb.get(deps.db);
  if (cache === undefined) {
    cache = new Map();
    reposCacheByDb.set(deps.db, cache);
  }
  return cache;
}

function labelFor(mainPath: string, repoPath: string): string {
  if (areHostPathsEqual(mainPath, repoPath)) return "";
  const inside = getRelativeHostPath({
    rootPath: mainPath,
    candidatePath: repoPath,
  });
  if (inside !== null) return inside;
  if (splitHostPathRoot(mainPath)?.root !== splitHostPathRoot(repoPath)?.root) {
    return repoPath;
  }
  const mainSegments = getHostPathSegments(mainPath) ?? [];
  const repoSegments = getHostPathSegments(repoPath) ?? [];
  let shared = 0;
  while (
    shared < mainSegments.length &&
    shared < repoSegments.length &&
    mainSegments[shared] === repoSegments[shared]
  ) {
    shared += 1;
  }
  return [
    ...mainSegments.slice(shared).map(() => ".."),
    ...repoSegments.slice(shared),
  ].join("/");
}

async function findEnvironmentRepos(
  deps: WorkSessionDeps,
  environment: EnvironmentReposTarget,
  extraFolders: readonly string[],
): Promise<EnvironmentReposResponse> {
  const { folders } = await callHostRetryableOnlineRpc(deps, {
    hostId: environment.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.find_git_repos",
      folderPaths: [environment.path, ...extraFolders],
      maxDepth: FIND_GIT_REPOS_MAX_DEPTH,
      maxRepos: FIND_GIT_REPOS_MAX_REPOS,
    },
  });
  const repos: EnvironmentRepo[] = [];
  const add = (candidate: Omit<EnvironmentRepo, "label">): void => {
    if (
      repos.some((repo) => areHostPathsEqual(repo.rootPath, candidate.rootPath))
    ) {
      return;
    }
    repos.push({
      ...candidate,
      label: labelFor(environment.path, candidate.path),
    });
  };
  folders.forEach((folder, index) => {
    if (!folder.exists) return;
    if (folder.gitRoot !== null) {
      add({
        rootPath: folder.gitRoot,
        path: folder.path,
        source: index === 0 ? "main" : "folder",
      });
      return;
    }
    for (const repo of folder.repos) {
      add({ rootPath: repo.gitRoot, path: repo.path, source: "discovered" });
    }
  });
  return {
    repos,
    truncated: folders.some((folder) => folder.truncated),
  };
}

export function resolveEnvironmentRepos(
  deps: WorkSessionDeps,
  environment: EnvironmentReposTarget,
): Promise<EnvironmentReposResponse> {
  const extraFolders = listEnvironmentExtraFolderPaths(deps.db, {
    additionalPaths: environment.additionalPaths,
    hostId: environment.hostId,
    mainPath: environment.path,
    projectId: environment.projectId,
  });
  const signature = JSON.stringify([
    environment.hostId,
    environment.path,
    extraFolders,
  ]);
  const cache = cacheFor(deps);
  const now = Date.now();
  const cached = cache.get(environment.id);
  if (
    cached !== undefined &&
    cached.signature === signature &&
    cached.expiresAt > now
  ) {
    return cached.value;
  }
  const value = findEnvironmentRepos(deps, environment, extraFolders);
  if (cache.size >= REPOS_CACHE_MAX_ENTRIES) {
    for (const [environmentId, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(environmentId);
    }
  }
  cache.set(environment.id, {
    expiresAt: now + REPOS_CACHE_TTL_MS,
    signature,
    value,
  });
  value.catch(() => {
    if (cache.get(environment.id)?.value === value) {
      cache.delete(environment.id);
    }
  });
  return value;
}
