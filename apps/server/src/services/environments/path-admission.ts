import {
  environmentHasLiveThreads,
  environments,
  findEnvironmentPathClaim,
  getHost,
  getPreparingEnvironment,
  getThread,
  type EnvironmentRow,
} from "@bb/db";
import { eq } from "drizzle-orm";
import type { WorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";

export const CHECKOUT_BUSY_MESSAGE =
  "Cannot checkout branch while another thread is using this workspace";

export function findBlockingEnvironmentPathClaim(
  deps: WorkSessionDeps,
  args: { hostId: string; path: string; owner: EnvironmentRow | null },
): EnvironmentRow | null {
  if (
    findEnvironmentPathClaim(deps.db, args.hostId, args.path, args.owner) ===
    null
  )
    return null;
  return deps.db.transaction(
    () => {
      let claim = findEnvironmentPathClaim(
        deps.db,
        args.hostId,
        args.path,
        args.owner,
      );
      while (claim !== null) {
        if (claim.ownerThreadId === null || claim.teardownStatus !== null)
          return claim;
        const owner = getThread(deps.db, claim.ownerThreadId);
        if (owner?.status === "starting" || owner?.status === "stopping")
          return claim;
        if (getHost(deps.db, claim.hostId)?.phase === "removing") return claim;
        const reusable =
          (claim.status === "ready" && claim.path !== null) ||
          environmentHasLiveThreads(deps.db, claim.id);
        const updated = deps.db
          .update(environments)
          .set(
            reusable
              ? {
                  updatedAt: Date.now(),
                  ownerThreadId: null,
                  claimPath: null,
                  statusMessage: null,
                  retireAt: null,
                }
              : {
                  updatedAt: Date.now(),
                  teardownStatus: "running",
                  retireAt: Date.now(),
                },
          )
          .where(eq(environments.id, claim.id))
          .run();
        if (updated.changes === 0) return claim;
        deps.hub.notifyEnvironment(claim.id, ["metadata-changed"]);
        if (!reusable) return { ...claim, teardownStatus: "running" };
        claim = findEnvironmentPathClaim(
          deps.db,
          args.hostId,
          args.path,
          args.owner,
        );
      }
      return null;
    },
    { behavior: "immediate" },
  );
}

export function assertEnvironmentPathAvailable(
  deps: WorkSessionDeps,
  args: { hostId: string; path: string | null; threadId: string | null },
): void {
  if (args.path === null) return;
  const path = args.path.replace(/\/+$/u, "") || "/";
  const owner =
    args.threadId === null
      ? null
      : getPreparingEnvironment(deps.db, args.threadId);
  const claim = findBlockingEnvironmentPathClaim(deps, {
    hostId: args.hostId,
    path,
    owner,
  });
  if (claim !== null) {
    throw new ApiError(
      409,
      "workspace_busy",
      claim.teardownStatus === null
        ? CHECKOUT_BUSY_MESSAGE
        : "Workspace cleanup is pending. Try again shortly.",
    );
  }
}
