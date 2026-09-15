import nodePath from "node:path";
import {
  getHost,
  listProjectEnvironmentsWithPaths,
  listProjectSourcesByProjectIds,
} from "@bb/db";
import {
  WORKTREE_COMPARISON_PATHS_MAX,
  type HostWorktreeListResult,
} from "@bb/domain";
import type {
  ProjectWorktree,
  ProjectWorktreeFailure,
  ProjectWorktreesResponse,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import {
  callHostOnlineRpc,
  isHostUnavailableApiError,
} from "../hosts/online-rpc.js";

const WORKTREE_DISCOVERY_TIMEOUT_MS = 15_000;

type ProjectEnvironmentRow = ReturnType<
  typeof listProjectEnvironmentsWithPaths
>[number];

interface DiscoverProjectWorktreesArgs {
  projectId: string;
}

interface SourceDiscovery {
  failure: ProjectWorktreeFailure | null;
  worktrees: ProjectWorktree[];
}

function isReusableEnvironment(environment: ProjectEnvironmentRow): boolean {
  return environment.status === "ready";
}

function environmentOwnership(
  environment: ProjectEnvironmentRow,
): ProjectWorktree["ownership"] {
  return environment.providerOwnsPath ? "bb-managed" : "user-managed";
}

function buildComparisonPaths(
  sourcePath: string,
  environments: readonly ProjectEnvironmentRow[],
): string[] {
  const paths = new Set<string>([sourcePath]);
  for (const environment of environments) {
    if (environment.path !== null) {
      paths.add(environment.path);
    }
  }
  if (paths.size > WORKTREE_COMPARISON_PATHS_MAX) {
    throw new ApiError(
      400,
      "comparison_paths_exceeded",
      `Discovery compares at most ${WORKTREE_COMPARISON_PATHS_MAX} stored paths per machine; this project has ${paths.size}`,
    );
  }
  return [...paths];
}

function worktreeSortLabel(row: ProjectWorktree): string {
  if (row.environmentName !== null) {
    return row.environmentName;
  }
  if (row.checkout.kind === "branch") {
    return row.checkout.branchName;
  }
  return `Detached at ${row.checkout.headSha.slice(0, 7)}`;
}

interface MergeHostWorktreesArgs {
  hostId: string;
  sourcePath: string;
  environments: readonly ProjectEnvironmentRow[];
  result: HostWorktreeListResult;
}

function mergeHostWorktrees(args: MergeHostWorktreesArgs): ProjectWorktree[] {
  const canonicalByStoredPath = new Map(
    args.result.resolvedPaths.map((resolved) => [
      resolved.path,
      resolved.canonicalPath,
    ]),
  );
  const sourceCanonicalPath =
    canonicalByStoredPath.get(args.sourcePath) ?? null;

  const environmentByCanonicalPath = new Map<string, ProjectEnvironmentRow>();
  const orderedEnvironments = [...args.environments].sort(
    (left, right) =>
      Number(isReusableEnvironment(right)) -
      Number(isReusableEnvironment(left)),
  );
  for (const environment of orderedEnvironments) {
    if (environment.path === null) {
      continue;
    }
    const canonicalPath = canonicalByStoredPath.get(environment.path) ?? null;
    if (
      canonicalPath !== null &&
      !environmentByCanonicalPath.has(canonicalPath)
    ) {
      environmentByCanonicalPath.set(canonicalPath, environment);
    }
  }

  const rows: ProjectWorktree[] = [];
  const seenIdentities = new Set<string>();
  const matchedEnvironmentIds = new Set<string>();

  for (const entry of args.result.worktrees) {
    const checkout = entry.checkout;
    if (checkout.kind === "bare") {
      continue;
    }
    if (
      entry.canonicalPath !== null &&
      entry.canonicalPath === sourceCanonicalPath
    ) {
      continue;
    }
    const identity =
      entry.canonicalPath ?? `reported:${nodePath.normalize(entry.path)}`;
    if (seenIdentities.has(identity)) {
      continue;
    }
    seenIdentities.add(identity);

    const entryCanonicalPath = entry.canonicalPath;
    const environment =
      entryCanonicalPath !== null
        ? environmentByCanonicalPath.get(entryCanonicalPath)
        : undefined;
    if (environment !== undefined && entryCanonicalPath !== null) {
      matchedEnvironmentIds.add(environment.id);
      if (isReusableEnvironment(environment)) {
        rows.push({
          hostId: args.hostId,
          path: entry.path,
          checkout,
          lock: entry.lock,
          availability:
            entry.prunable !== null
              ? { kind: "unavailable", reason: "prunable" }
              : { kind: "selectable", canonicalPath: entryCanonicalPath },
          ownership: environmentOwnership(environment),
          environmentId: environment.id,
          environmentName: environment.name,
          environmentProviderId: environment.environmentProviderId,
        });
        continue;
      }
      if (environment.providerOwnsPath) {
        continue;
      }
    }

    rows.push({
      hostId: args.hostId,
      path: entry.path,
      checkout,
      lock: entry.lock,
      availability:
        entry.canonicalPath === null
          ? { kind: "unavailable", reason: "missing" }
          : entry.prunable !== null
            ? { kind: "unavailable", reason: "prunable" }
            : { kind: "selectable", canonicalPath: entry.canonicalPath },
      ownership: "user-managed",
      environmentId: null,
      environmentName: null,
      environmentProviderId: null,
    });
  }

  for (const environment of orderedEnvironments) {
    if (
      !isReusableEnvironment(environment) ||
      matchedEnvironmentIds.has(environment.id) ||
      environment.path === null
    ) {
      continue;
    }
    const canonicalPath = canonicalByStoredPath.get(environment.path) ?? null;
    if (canonicalPath !== null && canonicalPath === sourceCanonicalPath) {
      continue;
    }
    if (canonicalPath !== null && seenIdentities.has(canonicalPath)) {
      continue;
    }
    const branchName = environment.branchName ?? environment.defaultBranch;
    if (branchName === null) {
      continue;
    }
    if (canonicalPath !== null) {
      seenIdentities.add(canonicalPath);
    }
    rows.push({
      hostId: args.hostId,
      path: environment.path,
      checkout: { kind: "branch", branchName },
      lock: null,
      availability:
        canonicalPath !== null
          ? { kind: "selectable", canonicalPath }
          : { kind: "unavailable", reason: "missing" },
      ownership: environmentOwnership(environment),
      environmentId: environment.id,
      environmentName: environment.name,
      environmentProviderId: environment.environmentProviderId,
    });
  }

  rows.sort((left, right) => {
    const environmentRank =
      Number(right.environmentId !== null) -
      Number(left.environmentId !== null);
    if (environmentRank !== 0) {
      return environmentRank;
    }
    const labelCompare = worktreeSortLabel(left).localeCompare(
      worktreeSortLabel(right),
    );
    if (labelCompare !== 0) {
      return labelCompare;
    }
    return left.path.localeCompare(right.path);
  });
  return rows;
}

function normalizeDiscoveryFailure(
  hostId: string,
  error: unknown,
): ProjectWorktreeFailure {
  if (isHostUnavailableApiError(error)) {
    return { hostId, code: "host_offline", message: "Machine is offline" };
  }
  const code = error instanceof ApiError ? error.body.code : null;
  const message =
    code === "not_git_repo"
      ? "Project source is not a git repository"
      : code === "path_not_found"
        ? "Project source path was not found"
        : code === "command_timeout"
          ? "Worktree discovery timed out"
          : code === "comparison_paths_exceeded"
            ? "Too many environment paths on this machine to discover safely"
            : "Worktree discovery failed";
  return { hostId, code: "discovery_failed", message };
}

export async function discoverProjectWorktrees(
  deps: WorkSessionDeps,
  args: DiscoverProjectWorktreesArgs,
): Promise<ProjectWorktreesResponse> {
  const sources = listProjectSourcesByProjectIds(deps.db, [
    args.projectId,
  ]).filter((source) => getHost(deps.db, source.hostId)?.type === "persistent");
  const environments = listProjectEnvironmentsWithPaths(
    deps.db,
    args.projectId,
  );
  const environmentsByHost = new Map<string, ProjectEnvironmentRow[]>();
  for (const environment of environments) {
    const bucket = environmentsByHost.get(environment.hostId);
    if (bucket) {
      bucket.push(environment);
    } else {
      environmentsByHost.set(environment.hostId, [environment]);
    }
  }

  const perSource = await Promise.all(
    sources.map(async (source): Promise<SourceDiscovery> => {
      const hostEnvironments = environmentsByHost.get(source.hostId) ?? [];
      if (!deps.hub.hasDaemonForHost(source.hostId)) {
        return {
          failure: {
            hostId: source.hostId,
            code: "host_offline",
            message: "Machine is offline",
          },
          worktrees: [],
        };
      }
      try {
        const result = await callHostOnlineRpc(deps, {
          hostId: source.hostId,
          timeoutMs: WORKTREE_DISCOVERY_TIMEOUT_MS,
          command: {
            type: "host.list_worktrees",
            path: source.path,
            comparisonPaths: buildComparisonPaths(
              source.path,
              hostEnvironments,
            ),
          },
        });
        return {
          failure: null,
          worktrees: mergeHostWorktrees({
            hostId: source.hostId,
            sourcePath: source.path,
            environments: hostEnvironments,
            result,
          }),
        };
      } catch (error) {
        return {
          failure: normalizeDiscoveryFailure(source.hostId, error),
          worktrees: [],
        };
      }
    }),
  );

  return {
    worktrees: perSource.flatMap((entry) => entry.worktrees),
    failures: perSource.flatMap((entry) =>
      entry.failure ? [entry.failure] : [],
    ),
  };
}
