import type { BaseBranchSpec, EnvironmentArgs } from "@bb/server-contract";
import type { Environment } from "@bb/domain";

/**
 * Resolves the base branch for a child thread's fresh managed worktree. The
 * child branches from the source thread's current branch HEAD when that branch
 * is known (`named`); otherwise it defers to the source's default branch
 * (`default`, resolved server-side) so a source on a non-branch / freshly
 * provisioned worktree still produces a valid request.
 */
function resolveChildThreadBaseBranch(
  sourceEnvironment: Environment | null,
): BaseBranchSpec {
  const branchName = sourceEnvironment?.branchName ?? null;
  if (branchName !== null && branchName.length > 0) {
    return { kind: "named", name: branchName };
  }
  return { kind: "default" };
}

/**
 * Resolves the execution environment for a thread spawned from another thread
 * (a fork or a side chat). Shared by both builders so the two flows stay in
 * lockstep:
 *
 * - When the source has a resolvable host, the child runs in a **fresh managed
 *   worktree** branched from the source's current branch HEAD (or the source's
 *   default branch when no branch is known). This keeps the child in the same
 *   project as its source, satisfying the same-project `parentThreadId` guard
 *   and the cross-project send-back constraint, while giving it its own
 *   checkout.
 * - When the source has **no host** (e.g. a personal-project source with no
 *   environment), there is no worktree to base on, so the child falls back to
 *   the **personal workspace**. The server only accepts personal workspaces
 *   inside the personal project, which is exactly where a host-less source
 *   lives.
 */
export function resolveChildThreadEnvironment(
  sourceEnvironment: Environment | null,
): EnvironmentArgs {
  const hostId = sourceEnvironment?.hostId ?? null;
  if (hostId === null) {
    return {
      type: "host",
      workspace: { type: "personal" },
    };
  }

  return {
    type: "host",
    hostId,
    workspace: {
      type: "managed-worktree",
      baseBranch: resolveChildThreadBaseBranch(sourceEnvironment),
    },
  };
}
