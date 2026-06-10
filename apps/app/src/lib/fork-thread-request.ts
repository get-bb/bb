import type { BaseBranchSpec, EnvironmentArgs } from "@bb/server-contract";
import type { Environment, PermissionMode, Thread } from "@bb/domain";
import type { AppCreateThreadRequest } from "@/lib/api";

/**
 * Inputs for building a fork's create-thread request. The source thread
 * supplies lineage + provider + title; the source environment supplies the host
 * and branch the fresh worktree is based on; the resolved execution options
 * supply model / permission mode (which do not live on the thread row).
 */
export interface BuildForkThreadRequestArgs {
  /** Source thread the fork branches from. */
  sourceThread: Thread;
  /** Source thread's environment, or null when not yet loaded / personal. */
  sourceEnvironment: Environment | null;
  /** The forked agent message's visible text (the anchor). */
  anchorMessageText: string;
  /** Resolved model the fork inherits from the source thread. */
  model: string;
  /** Resolved permission mode the fork inherits from the source thread. */
  permissionMode: PermissionMode;
}

/**
 * Resolves the base branch for the fork's fresh managed worktree. A fork
 * branches from the source thread's current branch HEAD when that branch is
 * known (`named`); otherwise it defers to the source's default branch
 * (`default`, resolved server-side) so a source on a non-branch / freshly
 * provisioned worktree still produces a valid request.
 */
function resolveForkBaseBranch(
  sourceEnvironment: Environment | null,
): BaseBranchSpec {
  const branchName = sourceEnvironment?.branchName ?? null;
  if (branchName !== null && branchName.length > 0) {
    return { kind: "named", name: branchName };
  }
  return { kind: "default" };
}

/**
 * Builds the create-thread request for forking a thread from one of its agent
 * messages (Approach A: the thread is created immediately with the anchor as a
 * seed-without-run thread-start turn; the user steers the first executed turn).
 *
 * Returns `null` when the source has no resolvable host (e.g. a personal-only
 * source with no environment): a fork always runs in a fresh managed worktree,
 * so without a host there is no valid fork to create and the caller should
 * leave the Fork action disabled.
 */
export function buildForkThreadRequest({
  sourceThread,
  sourceEnvironment,
  anchorMessageText,
  model,
  permissionMode,
}: BuildForkThreadRequestArgs): AppCreateThreadRequest | null {
  const hostId = sourceEnvironment?.hostId ?? null;
  if (hostId === null) {
    return null;
  }

  const environment: EnvironmentArgs = {
    type: "host",
    hostId,
    workspace: {
      type: "managed-worktree",
      baseBranch: resolveForkBaseBranch(sourceEnvironment),
    },
  };

  const sourceTitle = sourceThread.title ?? sourceThread.titleFallback;
  const title =
    sourceTitle !== null && sourceTitle.length > 0
      ? `${sourceTitle} (fork)`
      : "Untitled (fork)";

  return {
    projectId: sourceThread.projectId,
    providerId: sourceThread.providerId,
    model,
    permissionMode,
    title,
    input: [{ type: "text", text: anchorMessageText, mentions: [] }],
    environment,
    parentThreadId: sourceThread.id,
    startedOnBehalfOf: {
      initiator: "agent",
      senderThreadId: sourceThread.id,
    },
    childOrigin: "fork",
  };
}
