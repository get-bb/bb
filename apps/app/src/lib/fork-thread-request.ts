import type { Environment, PermissionMode, Thread } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import type { AppCreateThreadRequest } from "@/lib/api";
import { resolveChildThreadEnvironment } from "@/lib/child-thread-environment";
import { buildConversationContextSnapshot } from "@/lib/conversation-context-snapshot";

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
  /** The forked agent message's visible text (the anchor / seed). */
  anchorMessageText: string;
  /** The source thread's timeline rows — snapshotted as the fork's lead-up context. */
  sourceTimelineRows: readonly TimelineRow[];
  /** Resolved model the fork inherits from the source thread. */
  model: string;
  /** Resolved permission mode the fork inherits from the source thread. */
  permissionMode: PermissionMode;
}

/**
 * Whether a thread can be forked: a fork always runs in a fresh managed worktree
 * branched off the source's host, so it is only possible when the source has a
 * resolved environment (which always carries a host). A host-less source (a
 * personal-project thread with no environment) cannot be forked, so the Fork
 * affordance is dropped rather than rendered as a no-op. Keeps the gate in
 * lockstep with {@link buildForkThreadRequest}, which returns null in the same
 * case.
 */
export function isThreadForkable(
  sourceEnvironment: Environment | null,
): boolean {
  return (sourceEnvironment?.hostId ?? null) !== null;
}

/**
 * Builds the create-thread request for forking a thread from one of its agent
 * messages (Approach A: the thread is created immediately with the anchor as a
 * seed-without-run thread-start turn; the user steers the first executed turn).
 *
 * Returns `null` when the source has no resolvable host (e.g. a personal-only
 * source with no environment): a fork always runs in a fresh managed worktree,
 * so without a host there is no valid fork to create and the caller should
 * leave the Fork action disabled. (A side chat shares the worktree resolution
 * via {@link resolveChildThreadEnvironment} but falls back to the personal
 * workspace instead of bailing — a fork cannot.)
 */
export function buildForkThreadRequest({
  sourceThread,
  sourceEnvironment,
  anchorMessageText,
  sourceTimelineRows,
  model,
  permissionMode,
}: BuildForkThreadRequestArgs): AppCreateThreadRequest | null {
  if (!isThreadForkable(sourceEnvironment)) {
    return null;
  }

  const environment = resolveChildThreadEnvironment(sourceEnvironment);

  // The anchor renders as the fork's visible seed-without-run row; the agent-only
  // snapshot gives the fork the lead-up that produced it (without cluttering its
  // timeline) and points it at the full parent thread for anything earlier.
  const contextSnapshot = buildConversationContextSnapshot({
    rows: sourceTimelineRows,
    sourceMessageText: anchorMessageText,
    parentThreadId: sourceThread.id,
    scope: "fork",
  });

  return {
    projectId: sourceThread.projectId,
    providerId: sourceThread.providerId,
    model,
    permissionMode,
    // No title: a fresh fork auto-titles from its first real turn (distinct from
    // the source) rather than echoing the source name with a "(fork)" suffix.
    input: [
      { type: "text", text: anchorMessageText, mentions: [] },
      ...contextSnapshot,
    ],
    environment,
    parentThreadId: sourceThread.id,
    startedOnBehalfOf: {
      initiator: "agent",
      senderThreadId: sourceThread.id,
    },
    childOrigin: "fork",
  };
}
