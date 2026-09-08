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

export async function resolveEnvironmentPathIdentity(
  deps: WorkSessionDeps,
  hostId: string,
  path: string,
): Promise<string> {
  const canonicalPath = await canonicalEnvironmentPath(deps, hostId, path);
  const rows = deps.db
    .select({ id: environments.id, path: environments.path })
    .from(environments)
    .where(
      and(
        eq(environments.hostId, hostId),
        isNull(environments.canonicalPath),
        isNotNull(environments.path),
      ),
    )
    .all();
  for (const row of rows) {
    if (row.path === null) continue;
    const identity =
      row.path === path
        ? canonicalPath
        : await canonicalEnvironmentPath(deps, hostId, row.path);
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
  }
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
