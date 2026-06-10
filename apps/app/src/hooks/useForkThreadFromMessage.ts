import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { Environment, Thread } from "@bb/domain";
import * as api from "@/lib/api";
import { getThreadRoutePath } from "@/lib/app-route-paths";
import { buildForkThreadRequest } from "@/lib/fork-thread-request";
import { threadDefaultExecutionOptionsQueryKey } from "@/hooks/queries/query-keys";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";

export interface ForkThreadFromMessageArgs {
  /** The forked agent message's visible text (rendered as the fork anchor). */
  messageText: string;
  /** Turn the anchor message belongs to. Reserved for richer fork context. */
  sourceTurnId: string | null;
}

export interface UseForkThreadFromMessageArgs {
  /** Source thread the fork branches from. Null until the thread loads. */
  sourceThread: Thread | null;
  /** Source thread's environment. Null until it loads / for personal threads. */
  sourceEnvironment: Environment | null;
}

/**
 * Builds the fork create-thread request, creates the forked thread, and
 * navigates to it (Approach A: the thread is seeded with the anchor as a
 * display-only thread-start turn and waits for the user's first message). Focus
 * is handled by the thread-detail composer, which auto-focuses on mount keyed on
 * the new thread id — no explicit focus signal is threaded here.
 *
 * Returns a no-op handler while the source thread/environment are unresolved or
 * when the source has no host to base a fresh worktree on (the Fork affordance
 * should already be disabled in those cases).
 */
export function useForkThreadFromMessage({
  sourceThread,
  sourceEnvironment,
}: UseForkThreadFromMessageArgs): (
  args: ForkThreadFromMessageArgs,
) => Promise<void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createThread = useCreateThread();

  return useCallback(
    async ({ messageText }: ForkThreadFromMessageArgs) => {
      if (sourceThread === null || createThread.isPending) {
        return;
      }

      // model / permissionMode are not on the thread row; resolve the source's
      // effective execution options (cached if already fetched by the composer).
      const executionOptions = await queryClient.fetchQuery({
        queryKey: threadDefaultExecutionOptionsQueryKey(sourceThread.id),
        queryFn: () => api.getThreadDefaultExecutionOptions(sourceThread.id),
      });
      if (executionOptions === null) {
        return;
      }

      const request = buildForkThreadRequest({
        sourceThread,
        sourceEnvironment,
        anchorMessageText: messageText,
        model: executionOptions.model,
        permissionMode: executionOptions.permissionMode,
      });
      if (request === null) {
        return;
      }

      try {
        const thread = await createThread.mutateAsync(request);
        navigate(
          getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          }),
        );
      } catch {
        // Global mutation error handling already surfaced the failure.
      }
    },
    [createThread, navigate, queryClient, sourceEnvironment, sourceThread],
  );
}
