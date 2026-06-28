import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { QueryClientArg } from "../cache-effect-types";
import {
  THREAD_CONVERSATION_OUTLINE_QUERY_KEY,
  THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  THREAD_DETAIL_BOOTSTRAP_QUERY_KEY,
  THREAD_PENDING_INTERACTIONS_QUERY_KEY,
  THREAD_PROMPT_HISTORY_QUERY_KEY,
  THREAD_QUERY_KEY,
  THREAD_QUEUED_MESSAGES_QUERY_KEY,
  THREAD_TIMELINE_QUERY_KEY,
  threadConversationOutlineQueryKey,
  threadDefaultExecutionOptionsQueryKey,
  threadDetailBootstrapQueryKey,
  threadPendingInteractionsQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadQueuedMessagesQueryKey,
  threadTimelineQueryKey,
} from "../queries/query-keys";

const ACTIVE_THREAD_QUERY_ROOTS = new Set<unknown>([
  THREAD_QUERY_KEY,
  THREAD_DETAIL_BOOTSTRAP_QUERY_KEY,
  THREAD_DEFAULT_EXECUTION_OPTIONS_QUERY_KEY,
  THREAD_QUEUED_MESSAGES_QUERY_KEY,
  THREAD_PROMPT_HISTORY_QUERY_KEY,
  THREAD_PENDING_INTERACTIONS_QUERY_KEY,
  THREAD_TIMELINE_QUERY_KEY,
  THREAD_CONVERSATION_OUTLINE_QUERY_KEY,
]);

function getThreadIdFromActiveThreadQueryKey(
  queryKey: QueryKey,
): string | null {
  const [queryRoot, threadId] = queryKey;
  if (!ACTIVE_THREAD_QUERY_ROOTS.has(queryRoot)) {
    return null;
  }
  return typeof threadId === "string" && threadId.length > 0
    ? threadId
    : null;
}

function getActiveThreadBundleQueryKeys(threadId: string): QueryKey[] {
  return [
    threadQueryKey(threadId),
    threadDetailBootstrapQueryKey(threadId),
    threadDefaultExecutionOptionsQueryKey(threadId),
    threadQueuedMessagesQueryKey(threadId),
    threadPromptHistoryQueryKey(threadId),
    threadPendingInteractionsQueryKey(threadId),
    threadTimelineQueryKey(threadId),
    threadConversationOutlineQueryKey(threadId),
  ];
}

function collectActiveThreadBundleThreadIds(queryClient: QueryClient): string[] {
  const threadIds = new Set<string>();
  for (const query of queryClient.getQueryCache().findAll({ type: "active" })) {
    const threadId = getThreadIdFromActiveThreadQueryKey(query.queryKey);
    if (threadId !== null) {
      threadIds.add(threadId);
    }
  }
  return Array.from(threadIds);
}

export function invalidateActiveThreadBundleQueriesAfterBrowserResume({
  queryClient,
}: QueryClientArg): void {
  for (const threadId of collectActiveThreadBundleThreadIds(queryClient)) {
    for (const queryKey of getActiveThreadBundleQueryKeys(threadId)) {
      queryClient.invalidateQueries({ queryKey });
    }
  }
}
