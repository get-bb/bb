import {
  projectPathsQueryKeyPrefix,
  sidebarNavigationQueryKey,
  threadQueuedMessagesQueryKey,
  threadPromptHistoryQueryKey,
  threadQueryKey,
  threadsQueryKey,
  threadStorageFilePreviewQueryKeyPrefix,
  threadStorageFilesForThreadQueryKeyPrefix,
  threadStoragePathsForThreadQueryKeyPrefix,
  threadTimelineQueryKeyPrefix,
  threadTimelineTurnSummaryDetailsQueryKeyPrefix,
} from "../queries/query-keys";
import { threadDefaultExecutionOptionsQueryKey } from "../queries/thread-default-execution-options-query";
import type {
  ProjectArg,
  QueryClientArg,
  ThreadArg,
} from "../cache-effect-types";
import { removeEnvironmentScopedQueries } from "./environment-cache-effects";
import { invalidateQueryKeys } from "./cache-effect-utils";
import {
  getProjectListInvalidationQueryKeys,
  getProjectPromptHistoryInvalidationQueryKeys,
  getProjectSourceDependentInvalidationQueryKeys,
  getThreadDetailInvalidationQueryKeys,
  getThreadListInvalidationQueryKeys,
  getThreadPendingInteractionInvalidationQueryKeys,
  getThreadPromptHistoryInvalidationQueryKeys,
  getThreadQueueContentInvalidationQueryKeys,
  getThreadTimelineInvalidationQueryKeys,
} from "./cache-invalidation-groups";

interface ProjectSourceInvalidationArg extends QueryClientArg {
  projectId: string | undefined;
}

export function invalidateProjectListQueries({
  queryClient,
}: QueryClientArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: getProjectListInvalidationQueryKeys(),
  });
}

export function invalidateProjectUpdateQueries({
  projectId,
  queryClient,
}: ProjectArg): void {
  invalidateProjectListQueries({ queryClient });
  queryClient.invalidateQueries({
    queryKey: projectPathsQueryKeyPrefix(projectId),
  });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
}

export function invalidateProjectDeleteQueries({
  queryClient,
}: QueryClientArg): void {
  invalidateProjectListQueries({ queryClient });
  queryClient.invalidateQueries({ queryKey: threadsQueryKey() });
}

export function invalidateProjectSourceQueries({
  projectId,
  queryClient,
}: ProjectSourceInvalidationArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: getProjectSourceDependentInvalidationQueryKeys({ projectId }),
  });
}

export function refetchThreadListsAfterComposerThreadCreate({
  queryClient,
}: QueryClientArg): void {
  void queryClient.refetchQueries({
    queryKey: threadsQueryKey(),
    type: "active",
  });
  void queryClient.refetchQueries({
    queryKey: sidebarNavigationQueryKey(),
    type: "active",
  });
}

export function invalidateThreadListQueries({
  queryClient,
}: QueryClientArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: getThreadListInvalidationQueryKeys({
      projectId: undefined,
      queryClient,
    }),
  });
}

export function invalidateThreadListMembershipQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      ...getThreadDetailInvalidationQueryKeys({ threadId }),
      ...getThreadListInvalidationQueryKeys({
        projectId: undefined,
        queryClient,
      }),
    ],
  });
}

export function invalidateProjectPromptHistoryQueries({
  projectId,
  queryClient,
}: ProjectArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: getProjectPromptHistoryInvalidationQueryKeys({ projectId }),
  });
}

export function invalidateThreadDeleteQueries({
  queryClient,
}: QueryClientArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      ...getProjectListInvalidationQueryKeys(),
      ...getProjectPromptHistoryInvalidationQueryKeys({
        projectId: undefined,
      }),
      threadsQueryKey(),
    ],
  });
}

export function invalidateThreadQueueQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      ...getThreadDetailInvalidationQueryKeys({ threadId }),
      ...getThreadQueueContentInvalidationQueryKeys({ threadId }),
    ],
  });
}

export function invalidateThreadQueuedMessageSendQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  invalidateThreadQueueQueries({ queryClient, threadId });
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      ...getThreadTimelineInvalidationQueryKeys({ threadId }),
      ...getThreadListInvalidationQueryKeys({
        projectId: undefined,
        queryClient,
      }),
    ],
  });
}

export function invalidateThreadAcceptedMessageQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  queryClient.invalidateQueries({
    queryKey: threadDefaultExecutionOptionsQueryKey(threadId),
  });
  invalidateQueryKeys({
    queryClient,
    queryKeys: getThreadPromptHistoryInvalidationQueryKeys({ threadId }),
  });
}

export function invalidateThreadAcceptedMessageQueriesWithoutRealtime({
  queryClient,
  threadId,
}: ThreadArg): void {
  invalidateThreadAcceptedMessageQueries({ queryClient, threadId });
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      ...getThreadDetailInvalidationQueryKeys({ threadId }),
      ...getThreadTimelineInvalidationQueryKeys({ threadId }),
      ...getThreadListInvalidationQueryKeys({
        projectId: undefined,
        queryClient,
      }),
    ],
  });
}

export function invalidateThreadStopQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      ...getThreadDetailInvalidationQueryKeys({ threadId }),
      ...getThreadListInvalidationQueryKeys({
        projectId: undefined,
        queryClient,
      }),
    ],
  });
}

export function invalidateThreadPendingInteractionResolutionQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      ...getThreadPendingInteractionInvalidationQueryKeys({ threadId }),
      ...getThreadTimelineInvalidationQueryKeys({ threadId }),
      ...getThreadDetailInvalidationQueryKeys({ threadId }),
      ...getThreadListInvalidationQueryKeys({
        projectId: undefined,
        queryClient,
      }),
    ],
  });
}

export function removeThreadScopedQueries({
  queryClient,
  threadId,
}: ThreadArg): void {
  queryClient.removeQueries({ queryKey: threadQueryKey(threadId) });
  queryClient.removeQueries({
    queryKey: threadTimelineQueryKeyPrefix(threadId),
  });
  queryClient.removeQueries({
    queryKey: threadTimelineTurnSummaryDetailsQueryKeyPrefix(threadId),
  });
  queryClient.removeQueries({
    queryKey: threadDefaultExecutionOptionsQueryKey(threadId),
  });
  queryClient.removeQueries({
    queryKey: threadQueuedMessagesQueryKey(threadId),
  });
  queryClient.removeQueries({
    queryKey: threadPromptHistoryQueryKey(threadId),
  });
  queryClient.removeQueries({
    queryKey: threadStorageFilesForThreadQueryKeyPrefix(threadId),
  });
  queryClient.removeQueries({
    queryKey: threadStoragePathsForThreadQueryKeyPrefix(threadId),
  });
  queryClient.removeQueries({
    queryKey: threadStorageFilePreviewQueryKeyPrefix(threadId),
  });
}

export { removeEnvironmentScopedQueries };
