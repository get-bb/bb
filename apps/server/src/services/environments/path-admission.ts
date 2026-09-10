import { findEnvironmentPathClaim, getPreparingEnvironment } from "@bb/db";
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
    findEnvironmentPathClaim(deps.db, args.hostId, null, null) !== null
  ) {
    const path = args.path.replace(/\/+$/u, "") || "/";
    const provisioning =
      args.threadId === null
        ? null
        : getPreparingEnvironment(deps.db, args.threadId);
    if (
      findEnvironmentPathClaim(deps.db, args.hostId, path, provisioning) !==
      null
    )
      throw new ApiError(409, "workspace_busy", CHECKOUT_BUSY_MESSAGE);
  }
  return admit();
}
