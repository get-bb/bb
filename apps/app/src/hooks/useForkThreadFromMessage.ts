import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Environment, Thread } from "@bb/domain";
import * as api from "@/lib/api";
import { getThreadRoutePath } from "@/lib/route-paths";
import { buildForkThreadRequest } from "@/lib/fork-thread-request";
import { threadDefaultExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";

export interface UseForkThreadFromMessageArgs {
  /** Source thread the fork branches from. Null until the thread loads. */
  sourceThread: Thread | null;
  /** Source thread's environment. Null until it loads / for personal threads. */
  sourceEnvironment: Environment | null;
}

/**
 * Builds the fork create-thread request, creates the forked thread, and
 * navigates to it. A native fork clones the parent's provider session at its
 * branch point, so the new thread opens with an empty timeline and the full
 * forked history behind it; the user steers the first executed turn. Focus is
 * handled by the thread-detail composer, which auto-focuses on mount keyed on
 * the new thread id — no explicit focus signal is threaded here.
 *
 * Returns a no-op handler while the source thread/environment are unresolved or
 * when the source has no host to base a fresh worktree on (the Fork affordance
 * should already be disabled in those cases).
 */
export function useForkThreadFromMessage({
  sourceThread,
  sourceEnvironment,
}: UseForkThreadFromMessageArgs): () => Promise<void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createThread = useCreateThread();
  // Synchronous re-entrancy guard: the first `await` below yields before
  // `createThread.isPending` flips, so a second click in that gap would slip
  // past the pending check and create a duplicate fork. The ref is set at entry
  // and cleared in `finally`, closing that window.
  const forkInFlightRef = useRef(false);

  return useCallback(async () => {
    if (
      sourceThread === null ||
      createThread.isPending ||
      forkInFlightRef.current
    ) {
      return;
    }

    forkInFlightRef.current = true;
    try {
      // model / permissionMode are not on the thread row; resolve the source's
      // effective execution options (cached if already fetched by the composer).
      const executionOptions = await queryClient.fetchQuery({
        queryKey: threadDefaultExecutionOptionsQueryKey(sourceThread.id),
        queryFn: ({ signal }) =>
          api.getThreadDefaultExecutionOptions(sourceThread.id, signal),
      });
      if (executionOptions === null) {
        return;
      }

      const request = buildForkThreadRequest({
        sourceThread,
        sourceEnvironment,
        model: executionOptions.model,
        permissionMode: executionOptions.permissionMode,
      });
      if (request === null) {
        return;
      }

      const thread = await createThread.mutateAsync(request);
      navigate(
        getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        }),
      );
    } catch {
      // Global mutation error handling already surfaced the failure.
    } finally {
      forkInFlightRef.current = false;
    }
  }, [createThread, navigate, queryClient, sourceEnvironment, sourceThread]);
}
