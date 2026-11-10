import {
  environmentHasLiveThreads,
  environments,
  findEnvironmentPathClaim,
  getHost,
  getPreparingEnvironment,
  getThread,
  type EnvironmentRow,
} from "@bb/db";
import { canonicalizeHostPath } from "@bb/domain";
import { eq } from "drizzle-orm";
import type { WorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { ENVIRONMENT_HOOK_TIMEOUT_MS } from "./environment-hooks.js";

export const CHECKOUT_BUSY_MESSAGE =
  "Cannot checkout branch while another thread is using this workspace";

export const PATH_CLAIM_SETTLE_TIMEOUT_MS = ENVIRONMENT_HOOK_TIMEOUT_MS;

type PathAdmissionDeps = Pick<WorkSessionDeps, "db" | "hub">;

interface BlockingPathClaim {
  claim: EnvironmentRow;
  settling: boolean;
}

class SettlingPathClaimError extends ApiError {
  constructor(readonly claim: EnvironmentRow) {
    super(409, "workspace_busy", CHECKOUT_BUSY_MESSAGE);
  }
}

function findBlockingClaim(
  deps: PathAdmissionDeps,
  args: { hostId: string; path: string; owner: EnvironmentRow | null },
): BlockingPathClaim | null {
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
          return { claim, settling: false };
        if (getHost(deps.db, claim.hostId)?.phase === "removing")
          return { claim, settling: false };
        const owner = getThread(deps.db, claim.ownerThreadId);
        if (owner?.status === "starting" || owner?.status === "stopping")
          return { claim, settling: true };
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
        if (updated.changes === 0) return { claim, settling: false };
        deps.hub.notifyEnvironment(claim.id, ["metadata-changed"]);
        if (!reusable)
          return {
            claim: { ...claim, teardownStatus: "running" },
            settling: false,
          };
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

export function findBlockingEnvironmentPathClaim(
  deps: PathAdmissionDeps,
  args: { hostId: string; path: string; owner: EnvironmentRow | null },
): EnvironmentRow | null {
  return findBlockingClaim(deps, args)?.claim ?? null;
}

export function assertEnvironmentPathAvailable(
  deps: PathAdmissionDeps,
  args: { hostId: string; path: string | null; threadId: string | null },
): void {
  if (args.path === null) return;
  const path = canonicalizeHostPath(args.path);
  const owner =
    args.threadId === null
      ? null
      : getPreparingEnvironment(deps.db, args.threadId);
  const blocking = findBlockingClaim(deps, {
    hostId: args.hostId,
    path,
    owner,
  });
  if (blocking === null) return;
  if (blocking.settling) throw new SettlingPathClaimError(blocking.claim);
  throw new ApiError(
    409,
    "workspace_busy",
    blocking.claim.teardownStatus === null
      ? CHECKOUT_BUSY_MESSAGE
      : "Workspace cleanup is pending. Try again shortly.",
  );
}

export function settlingPathClaim(error: unknown): EnvironmentRow | null {
  return error instanceof SettlingPathClaimError ? error.claim : null;
}

export function watchPathClaimChanges(hub: PathAdmissionDeps["hub"]) {
  const changed = new Set<string>();
  let wake: (() => void) | null = null;
  const stop = hub.onChangedMessage((message) => {
    if (message.entity !== "thread" && message.entity !== "environment") return;
    changed.add(`${message.entity}:${message.id}`);
    wake?.();
  });
  return {
    stop,
    async settled(claim: EnvironmentRow, deadline: number): Promise<boolean> {
      const keys = [
        `environment:${claim.id}`,
        `thread:${claim.ownerThreadId ?? ""}`,
      ];
      while (!keys.some((key) => changed.has(key))) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, remaining);
          wake = () => {
            clearTimeout(timeout);
            resolve();
          };
        });
        wake = null;
      }
      return true;
    },
  };
}

export async function admitAfterPathClaimsSettle(
  deps: PathAdmissionDeps,
  admit: () => void,
): Promise<void> {
  const deadline = Date.now() + PATH_CLAIM_SETTLE_TIMEOUT_MS;
  for (;;) {
    const changes = watchPathClaimChanges(deps.hub);
    try {
      admit();
      return;
    } catch (error) {
      const claim = settlingPathClaim(error);
      if (claim === null || !(await changes.settled(claim, deadline)))
        throw error;
    } finally {
      changes.stop();
    }
  }
}
