import type { Environment, PermissionMode, Thread } from "@bb/domain";
import type { AppCreateThreadRequest } from "@/lib/api";
import { resolveChildThreadEnvironment } from "@/lib/child-thread-environment";

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
 * Builds the create-thread request for forking a thread. A fork establishes the
 * cloned provider session — the server clones the source session at its branch
 * point because the request carries `originKind: "fork"` + a forkable
 * same-host source — and lands the new thread idle with an empty timeline. The
 * user steers the first executed turn; the "Forked from <parent>" banner conveys
 * lineage. The request therefore carries empty input (no anchor seed, no context
 * snapshot): the runtime's no-input-no-turn guard runs no first turn, so the
 * cloned session is established without dispatching a run.
 *
 * `startedOnBehalfOf` is null: the fork is linked purely via `originKind` +
 * `sourceThreadId` (the server gates the native fork on those, not on
 * `startedOnBehalfOf`), and with empty input there is no first turn to attribute
 * to the parent.
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
  model,
  permissionMode,
}: BuildForkThreadRequestArgs): AppCreateThreadRequest | null {
  if (!isThreadForkable(sourceEnvironment)) {
    return null;
  }

  return {
    projectId: sourceThread.projectId,
    providerId: sourceThread.providerId,
    model,
    permissionMode,
    // No title: a fresh fork auto-titles from its first real turn (distinct from
    // the source) rather than echoing the source name with a "(fork)" suffix.
    // Empty input: a native fork is established idle with an empty timeline (the
    // runtime starts no first turn), and the user steers the first turn.
    input: [],
    environment: resolveChildThreadEnvironment(sourceEnvironment),
    sourceThreadId: sourceThread.id,
    startedOnBehalfOf: null,
    originKind: "fork",
  };
}
