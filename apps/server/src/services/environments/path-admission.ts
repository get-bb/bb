import { and, eq, isNull, isNotNull } from "drizzle-orm";
import {
  environments,
  findEnvironmentLaunchPathClaim,
  getEnvironmentLaunch,
} from "@bb/db";
import type { WorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";

export const CHECKOUT_BUSY_MESSAGE =
  "Cannot checkout branch while another thread is using this workspace";

export async function canonicalEnvironmentPath(
  deps: WorkSessionDeps,
  hostId: string,
  path: string,
): Promise<string> {
  const result = await callHostOnlineRpc(deps, {
    hostId,
    command: { type: "host.canonical_path", path },
    timeoutMs: 10_000,
  });
  return result.path;
}

const backfillWarnings = new WeakMap<
  WorkSessionDeps["db"],
  Map<string, number>
>();

function unresolvedEnvironmentPaths(deps: WorkSessionDeps, hostId: string) {
  return deps.db
    .select({
      id: environments.id,
      path: environments.path,
      status: environments.status,
    })
    .from(environments)
    .where(
      and(
        eq(environments.hostId, hostId),
        isNull(environments.canonicalPath),
        isNotNull(environments.path),
      ),
    )
    .all();
}

export function backfillEnvironmentPathIdentities(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<void> {
  return deps.lifecycleDedupers.environmentPathBackfill.run(
    hostId,
    async () => {
      let warnings = backfillWarnings.get(deps.db);
      if (warnings === undefined) {
        warnings = new Map();
        backfillWarnings.set(deps.db, warnings);
      }
      const now = Date.now();
      for (const [id, loggedAt] of warnings) {
        if (now - loggedAt >= 60_000) warnings.delete(id);
      }
      for (const row of unresolvedEnvironmentPaths(deps, hostId)) {
        if (row.path === null) continue;
        let identity: string;
        try {
          identity = await canonicalEnvironmentPath(deps, hostId, row.path);
        } catch (error) {
          if (!warnings.has(row.id)) {
            warnings.set(row.id, Date.now());
            deps.logger.warn(
              { err: error, environmentId: row.id, hostId, path: row.path },
              "Cannot backfill environment canonical path; will retry on next request",
            );
          }
          continue;
        }
        deps.db
          .update(environments)
          .set({ canonicalPath: identity })
          .where(
            and(
              eq(environments.id, row.id),
              eq(environments.path, row.path),
              isNull(environments.canonicalPath),
            ),
          )
          .run();
        warnings.delete(row.id);
      }
    },
  );
}

export async function resolveEnvironmentPathIdentity(
  deps: WorkSessionDeps,
  hostId: string,
  path: string,
): Promise<string> {
  await backfillEnvironmentPathIdentities(deps, hostId);
  const unresolved = unresolvedEnvironmentPaths(deps, hostId);
  const assertNoUnresolvedOverlap = (candidate: string) => {
    for (const row of unresolved) {
      if (row.path === null || row.status === "destroyed") continue;
      const rawPath = row.path.replace(/\/+$/u, "") || "/";
      if (
        candidate === rawPath ||
        candidate.startsWith(rawPath === "/" ? "/" : `${rawPath}/`)
      ) {
        throw new ApiError(409, "workspace_busy", CHECKOUT_BUSY_MESSAGE);
      }
    }
  };
  assertNoUnresolvedOverlap(path);
  const canonicalPath = await canonicalEnvironmentPath(deps, hostId, path);
  assertNoUnresolvedOverlap(canonicalPath);
  return canonicalPath;
}

export async function withEnvironmentPathAdmission<T>(
  deps: WorkSessionDeps,
  args: { hostId: string; path: string | null; threadId: string | null },
  admit: () => T,
): Promise<T> {
  if (
    args.path !== null &&
    findEnvironmentLaunchPathClaim(deps.db, args.hostId, null, null) !== null
  ) {
    const path = await canonicalEnvironmentPath(deps, args.hostId, args.path);
    const launch =
      args.threadId === null
        ? null
        : getEnvironmentLaunch(deps.db, args.threadId);
    const owner =
      launch === null
        ? null
        : { threadId: launch.threadId, attempt: launch.attempt };
    if (
      findEnvironmentLaunchPathClaim(deps.db, args.hostId, path, owner) !== null
    )
      throw new ApiError(409, "workspace_busy", CHECKOUT_BUSY_MESSAGE);
  }
  return admit();
}
