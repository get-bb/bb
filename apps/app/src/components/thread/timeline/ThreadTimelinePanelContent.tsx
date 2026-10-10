import type { ReactNode } from "react";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { ThreadTimelinePanelLoadingSkeleton } from "./ThreadChatLoading";
import { resolveThreadOngoingIndicator } from "./thread-ongoing-indicator";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { ConversationTimeline } from "@/components/ui/conversation.js";
import { useThread } from "@/hooks/queries/thread-queries";
import { BbHttpError } from "@/lib/sdk";
import {
  ThreadTimelineSurface,
  type ThreadTimelineSurfaceProps,
} from "./ThreadTimelineSurface.js";
import {
  useThreadTimelineController,
  type UseThreadTimelineControllerResult,
} from "./useThreadTimelineController.js";

interface ThreadTimelinePanelContentProps {
  isTurnSubmitting?: boolean;
  leadingContent?: ReactNode;
  onMessageAddToChat?: ThreadTimelineSurfaceProps["onMessageAddToChat"];
  onSelectionAddToChat?: ThreadTimelineSurfaceProps["onSelectionAddToChat"];
  consumerMessageActions?: ThreadTimelineSurfaceProps["consumerMessageActions"];
  includePluginMessageActions?: ThreadTimelineSurfaceProps["includePluginMessageActions"];
  onOpenLink?: ThreadTimelineSurfaceProps["onOpenLink"];
  onOpenLocalFileLink?: ThreadTimelineSurfaceProps["onOpenLocalFileLink"];
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  surfaceKey?: string;
  threadId: string;
  timeline?: UseThreadTimelineControllerResult;
  workspaceRootPath?: string;
}

export function ThreadTimelinePanelContent({
  isTurnSubmitting = false,
  leadingContent,
  onMessageAddToChat,
  onSelectionAddToChat,
  consumerMessageActions,
  includePluginMessageActions,
  onOpenLink,
  onOpenLocalFileLink,
  projectId,
  resolveMentionLink,
  surfaceKey,
  threadId,
  timeline,
  workspaceRootPath,
}: ThreadTimelinePanelContentProps) {
  const threadQuery = useThread(threadId);
  const ownedTimeline = useThreadTimelineController({
    enabled: timeline === undefined,
    surfaceKey,
    threadId,
  });
  const resolvedTimeline = timeline ?? ownedTimeline;
  const displayStatus = threadQuery.data?.runtime.displayStatus ?? "idle";
  const ongoingIndicator = resolveThreadOngoingIndicator({
    displayStatus,
    activeBackgroundAgentCount:
      threadQuery.data?.activeBackgroundAgentCount ?? 0,
    activeBackgroundCommandCount:
      resolvedTimeline.activeBackgroundCommands.length,
    activeWorkflowCount: resolvedTimeline.activeWorkflows.length,
    isStopping: threadQuery.data?.status === "stopping",
    isTurnSubmitting,
    timelineLoading: resolvedTimeline.timelineLoading,
  });
  const showOngoingIndicator = ongoingIndicator.show;
  const timelineRows = resolvedTimeline.timelineRows;
  const isChildThreadMissing =
    threadQuery.error instanceof BbHttpError &&
    threadQuery.error.status === 404;

  if (isChildThreadMissing) {
    return (
      <ConversationTimeline className="flex-1">
        {leadingContent}
        <EmptyStatePanel className="mx-2 rounded-lg">
          This thread is no longer available.
        </EmptyStatePanel>
      </ConversationTimeline>
    );
  }

  return (
    <ThreadTimelineSurface
      activeThinking={resolvedTimeline.activeThinking}
      contextBoundarySeq={resolvedTimeline.contextBoundarySeq}
      hasOlderTimelineRows={resolvedTimeline.hasOlderTimelineRows}
      isCatchingUpTimeline={resolvedTimeline.isCatchingUpTimeline}
      isLoadingOlderTimelineRows={resolvedTimeline.isLoadingOlderTimelineRows}
      isThreadTimelinePending={
        resolvedTimeline.timelineLoading &&
        timelineRows.length === 0 &&
        !showOngoingIndicator
      }
      timelineError={
        Boolean(resolvedTimeline.timelineError) && timelineRows.length === 0
      }
      loadingContent={<ThreadTimelinePanelLoadingSkeleton />}
      leadingContent={leadingContent}
      onMessageAddToChat={onMessageAddToChat}
      onSelectionAddToChat={onSelectionAddToChat}
      consumerMessageActions={consumerMessageActions}
      includePluginMessageActions={includePluginMessageActions}
      onLoadOlderRows={resolvedTimeline.loadOlderTimelineRows}
      onOpenLink={onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      projectId={projectId}
      resolveMentionLink={resolveMentionLink}
      showOngoingIndicator={showOngoingIndicator}
      ongoingIndicatorLabel={ongoingIndicator.label}
      timelineErrorClassName="mx-2 mt-4 text-destructive"
      timelineRows={timelineRows}
      threadId={threadId}
      threadRuntimeDisplayStatus={displayStatus}
      workspaceRootPath={workspaceRootPath}
    />
  );
}
