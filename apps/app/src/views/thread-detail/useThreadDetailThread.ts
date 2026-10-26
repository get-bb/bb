import {
  didThreadDetailBootstrapRefreshAfterMount,
  useThread,
  useThreadDetailBootstrap,
} from "@/hooks/queries/thread-queries";
import { useMarkThreadRead } from "@/hooks/mutations/thread-state-mutations";
import { useThreadReadTracking } from "@/hooks/useThreadReadTracking";
import { useThreadUnreadDividerState } from "./useThreadUnreadDividerState";

export function useThreadDetailThread(threadId: string, trackRead: boolean) {
  const threadDetailBootstrapQuery = useThreadDetailBootstrap(threadId);
  const hasThreadDetailBootstrapSettled =
    threadDetailBootstrapQuery.isSuccess || threadDetailBootstrapQuery.isError;
  const threadQuery = useThread(threadId, {
    enabled: hasThreadDetailBootstrapSettled,
    refetchOnMount: didThreadDetailBootstrapRefreshAfterMount(
      threadDetailBootstrapQuery,
    )
      ? false
      : "always",
  });
  const thread = threadQuery.data;
  const unreadDividerState = useThreadUnreadDividerState({
    hasFreshThread:
      thread !== undefined &&
      !threadQuery.isPlaceholderData &&
      !threadQuery.isFetching &&
      !threadDetailBootstrapQuery.isFetching,
    routeThreadId: threadId,
    thread,
  });
  useThreadReadTracking({
    markThreadRead: useMarkThreadRead(),
    thread: trackRead && unreadDividerState.ready ? thread : undefined,
  });
  return {
    hasThreadDetailBootstrapSettled,
    threadDetailBootstrapQuery,
    threadQuery,
    unreadDividerState,
  };
}
