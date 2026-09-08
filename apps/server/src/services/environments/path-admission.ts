import { findEnvironmentLaunchPathClaim, getEnvironmentLaunch } from "@bb/db";
import type { WorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";

export const CHECKOUT_BUSY_MESSAGE =
  "Cannot checkout branch while another thread is using this workspace";

export async function withEnvironmentPathAdmission<T>(
  deps: WorkSessionDeps,
  args: { hostId: string; path: string | null; threadId: string | null },
  admit: () => T,
): Promise<T> {
  if (
    args.path !== null &&
    findEnvironmentLaunchPathClaim(deps.db, args.hostId, null, null) !== null
  ) {
    const path = args.path.replace(/\/+$/u, "") || "/";
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
