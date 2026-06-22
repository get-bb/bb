import type { ReactNode } from "react";
import type { ThreadChildOrigin } from "@bb/domain";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { ConversationTimeline } from "@/components/ui/conversation.js";
import { useThread } from "@/hooks/queries/thread-queries";
import { HttpError } from "@/lib/api";
import { isRunningThreadRuntimeDisplayStatus } from "./thread-runtime-status.js";
import {
  ThreadTimelineSurface,
  type ThreadTimelineSurfaceProps,
} from "./ThreadTimelineSurface.js";
import {
  useThreadTimelineController,
  type ThreadTimelineRowFilter,
  type UseThreadTimelineControllerResult,
} from "./useThreadTimelineController.js";

export interface ThreadTimelinePanelContentProps {
  canSpawnChild?: boolean;
  isTurnSubmitting?: boolean;
  leadingContent?: ReactNode;
  missingThreadLabel?: string;
  onForkMessage?: ThreadTimelineSurfaceProps["onForkMessage"];
  onSideChatMessage?: ThreadTimelineSurfaceProps["onSideChatMessage"];
  onSendToMainMessage?: ThreadTimelineSurfaceProps["onSendToMainMessage"];
  onSelectionAddToChat?: ThreadTimelineSurfaceProps["onSelectionAddToChat"];
  onSelectionReplyInSideChat?: ThreadTimelineSurfaceProps["onSelectionReplyInSideChat"];
  onOpenLink?: ThreadTimelineSurfaceProps["onOpenLink"];
  onOpenLocalFileLink?: ThreadTimelineSurfaceProps["onOpenLocalFileLink"];
  onTitleAction?: ThreadTimelineSurfaceProps["onTitleAction"];
  projectId?: string;
  provisioningLabel?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  rowFilter?: ThreadTimelineRowFilter;
  showLoadOlderRows?: boolean;
  surfaceKey?: string;
  threadChildOrigin?: ThreadChildOrigin | null;
  threadId: string;
  timeline?: UseThreadTimelineControllerResult;
  timelineErrorLabel?: string;
  workspaceRootPath?: string;
}

export function ThreadTimelinePanelContent({
  canSpawnChild,
  isTurnSubmitting = false,
  leadingContent,
  missingThreadLabel = "This thread is no longer available.",
  onForkMessage,
  onSideChatMessage,
  onSendToMainMessage,
  onSelectionAddToChat,
  onSelectionReplyInSideChat,
  onOpenLink,
  onOpenLocalFileLink,
  onTitleAction,
  projectId,
  provisioningLabel = "Provisioning thread...",
  resolveMentionLink,
  rowFilter,
  showLoadOlderRows = true,
  surfaceKey,
  threadChildOrigin = null,
  threadId,
  timeline,
  timelineErrorLabel = "Failed to load timeline",
  workspaceRootPath,
}: ThreadTimelinePanelContentProps) {
  const threadQuery = useThread(threadId);
  const ownedTimeline = useThreadTimelineController({
    enabled: timeline === undefined,
    rowFilter,
    surfaceKey,
    threadId,
  });
  const resolvedTimeline = timeline ?? ownedTimeline;
  const displayStatus = threadQuery.data?.runtime.displayStatus ?? "idle";
  const isProvisioningDisplayStatus =
    displayStatus === "provisioning" || displayStatus === "starting";
  const hasActiveBackgroundWork =
    resolvedTimeline.activeWorkflow !== null ||
    resolvedTimeline.activeBackgroundCommands.length > 0;
  const backgroundOnlyIndicatorLabel =
    displayStatus === "idle" && hasActiveBackgroundWork
      ? "Background work running"
      : undefined;
  const ongoingIndicatorLabel =
    displayStatus === "host-reconnecting"
      ? "Waiting for reconnection"
      : isProvisioningDisplayStatus
        ? provisioningLabel
        : backgroundOnlyIndicatorLabel;
  const showOngoingIndicator =
    threadQuery.data?.status !== "stopping" &&
    (isProvisioningDisplayStatus ||
      (!resolvedTimeline.timelineLoading &&
        (isTurnSubmitting ||
          isRunningThreadRuntimeDisplayStatus(displayStatus) ||
          backgroundOnlyIndicatorLabel !== undefined)));
  const timelineRows = resolvedTimeline.timelineRows;
  const isChildThreadMissing =
    threadQuery.error instanceof HttpError && threadQuery.error.status === 404;

  if (isChildThreadMissing) {
    return (
      <ConversationTimeline className="flex-1">
        {leadingContent}
        <EmptyStatePanel className="mx-2 rounded-lg">
          {missingThreadLabel}
        </EmptyStatePanel>
      </ConversationTimeline>
    );
  }

  return (
    <ThreadTimelineSurface
      activeThinking={resolvedTimeline.activeThinking}
      canSpawnChild={canSpawnChild}
      threadChildOrigin={threadChildOrigin}
      hasOlderTimelineRows={
        showLoadOlderRows ? resolvedTimeline.hasOlderTimelineRows : false
      }
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
      onForkMessage={onForkMessage}
      onSideChatMessage={onSideChatMessage}
      onSendToMainMessage={onSendToMainMessage}
      onSelectionAddToChat={onSelectionAddToChat}
      onSelectionReplyInSideChat={onSelectionReplyInSideChat}
      onLoadOlderRows={
        showLoadOlderRows ? resolvedTimeline.loadOlderTimelineRows : undefined
      }
      onOpenLink={onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      onTitleAction={onTitleAction}
      projectId={projectId}
      resolveMentionLink={resolveMentionLink}
      showOngoingIndicator={showOngoingIndicator}
      ongoingIndicatorLabel={ongoingIndicatorLabel}
      timelineErrorLabel={timelineErrorLabel}
      timelineErrorClassName="mx-2 mt-4 text-destructive"
      timelineRows={timelineRows}
      threadId={threadId}
      threadRuntimeDisplayStatus={displayStatus}
      workspaceRootPath={workspaceRootPath}
    />
  );
}

function ThreadTimelinePanelLoadingSkeleton() {
  return (
    <div className="space-y-2 px-2 pt-2">
      <Skeleton className="h-4 w-3/4 rounded-sm" />
      <Skeleton className="h-4 w-2/3 rounded-sm" />
      <Skeleton className="h-4 w-1/2 rounded-sm" />
    </div>
  );
}
