import nodePath from "node:path";
import { listProjectEnvironmentsWithPaths, listProjectSources } from "@bb/db";
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

/**
 * Discovery serves an open composer, so a host gets one short budget instead
 * of the normal command timeout: the daemon bounds its git call to ~10s and a
 * machine that cannot answer within that window becomes a failure row rather
 * than a delay on every healthy machine's rows.
 */
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
  return environment.status === "ready" || environment.status === "retiring";
}

/**
 * The daemon canonicalizes stored paths for us, so the source path rides along
 * with the environment paths. Canonical identity is ownership identity —
 * dropping a stored path could reclassify a bb workspace as user-managed — so
 * a project that exceeds the wire bound fails this host's discovery clearly
 * instead of returning a truncated, misclassifying comparison set.
 */
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

  // Reusable environments win alias collisions: suppressing a discovered row
  // for a terminal environment must never shadow a live one at the same
  // canonical directory.
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
    // A bare record is the repository itself, never a workable checkout; its
    // linked worktrees stay. The configured source checkout is represented by
    // "Work locally" instead of a row.
    if (checkout.kind === "bare") {
      continue;
    }
    if (
      entry.canonicalPath !== null &&
      entry.canonicalPath === sourceCanonicalPath
    ) {
      continue;
    }
    // Canonical identity when the path exists; a stale registration can only
    // coalesce with an identically-reported stale record on this host.
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
          // Environment metadata wins, but git's prunable verdict does not:
          // a registration git wants pruned stays unavailable even when a
          // reusable environment still points at it.
          availability:
            entry.prunable !== null
              ? { kind: "unavailable", reason: "prunable" }
              : { kind: "selectable", canonicalPath: entryCanonicalPath },
          ownership: environment.managed ? "bb-managed" : "user-managed",
          environmentId: environment.id,
          environmentName: environment.name,
        });
        continue;
      }
      if (environment.managed) {
        // Still bb's workspace mid-lifecycle (provisioning, destroying, …):
        // offering it as user-managed would misclassify cleanup ownership.
        continue;
      }
      // A non-reusable unmanaged environment leaves the directory a plain
      // user worktree; submit-time validation owns any conflict.
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
    });
  }

  // Reusable environments that git did not report (directories outside the
  // source's worktree registry) stay listed, keyed by their stored path.
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
      // Cannot render a checkout for a directory git never reported and whose
      // environment recorded no branch; the row would be unlabelable.
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
      ownership: environment.managed ? "bb-managed" : "user-managed",
      environmentId: environment.id,
      environmentName: environment.name,
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

/**
 * Discovers every configured source's worktrees and merges them with the
 * project's environments by canonical `(hostId, canonicalPath)` identity.
 * Hosts run in parallel; a host with no connected daemon fast-fails without
 * spending the reconnect budget, and each failed host becomes a typed failure
 * row while healthy hosts keep their results.
 */
export async function discoverProjectWorktrees(
  deps: WorkSessionDeps,
  args: DiscoverProjectWorktreesArgs,
): Promise<ProjectWorktreesResponse> {
  // Every project source is a local_path row by schema check constraint, so
  // the targeted per-project query needs no further narrowing.
  const sources = listProjectSources(deps.db, args.projectId);
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
