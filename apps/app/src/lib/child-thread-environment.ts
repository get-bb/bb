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
 * - A **personal-workspace** source (i.e. a personal-project thread) keeps a
 *   **personal workspace**. The server requires personal-project threads to use
 *   a personal workspace and rejects a managed worktree there, so we must not
 *   build one even though the source has a host. A host-less source likewise
 *   has no worktree to base on and falls back to the personal workspace.
 * - Otherwise (a standard-project source with a host and a real worktree), the
 *   child runs in a **fresh managed worktree** branched from the source's
 *   current branch HEAD (or the source's default branch when no branch is
 *   known). This keeps the child in the same project as its source, satisfying
 *   the same-project `parentThreadId` guard and the cross-project send-back
 *   constraint, while giving it its own checkout.
 */
export function resolveChildThreadEnvironment(
  sourceEnvironment: Environment | null,
): EnvironmentArgs {
  const hostId = sourceEnvironment?.hostId ?? null;
  const usesManagedWorktree =
    hostId !== null && sourceEnvironment?.workspaceProvisionType !== "personal";

  if (usesManagedWorktree) {
    return {
      type: "host",
      hostId,
      workspace: {
        type: "managed-worktree",
        baseBranch: resolveChildThreadBaseBranch(sourceEnvironment),
      },
    };
  }

  // Personal-project / personal-workspace and host-less sources use the
  // personal workspace; carry the source's host when known so the child stays
  // on it.
  return hostId === null
    ? { type: "host", workspace: { type: "personal" } }
    : { type: "host", hostId, workspace: { type: "personal" } };
}
