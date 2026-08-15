import type { ReactNode } from "react";
import type { ThreadOriginKind } from "@bb/domain";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Skeleton } from "@bb/shared-ui/skeleton";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { ConversationTimeline } from "@/components/ui/conversation.js";
import { useThread } from "@/hooks/queries/thread-queries";
import { BbHttpError } from "@/lib/sdk";
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
  onMessageAddToChat?: ThreadTimelineSurfaceProps["onMessageAddToChat"];
  onSendToMainMessage?: ThreadTimelineSurfaceProps["onSendToMainMessage"];
  onSelectionAddToChat?: ThreadTimelineSurfaceProps["onSelectionAddToChat"];
  consumerMessageActions?: ThreadTimelineSurfaceProps["consumerMessageActions"];
  includePluginMessageActions?: ThreadTimelineSurfaceProps["includePluginMessageActions"];
  onOpenLink?: ThreadTimelineSurfaceProps["onOpenLink"];
  onOpenLocalFileLink?: ThreadTimelineSurfaceProps["onOpenLocalFileLink"];
  onOpenPluginPanel?: ThreadTimelineSurfaceProps["onOpenPluginPanel"];
  onTitleAction?: ThreadTimelineSurfaceProps["onTitleAction"];
  projectId?: string;
  provisioningLabel?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  rowFilter?: ThreadTimelineRowFilter;
  showLoadOlderRows?: boolean;
  surfaceKey?: string;
  threadOriginKind?: ThreadOriginKind | null;
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
  onMessageAddToChat,
  onSendToMainMessage,
  onSelectionAddToChat,
  consumerMessageActions,
  includePluginMessageActions,
  onOpenLink,
  onOpenLocalFileLink,
  onOpenPluginPanel,
  onTitleAction,
  projectId,
  provisioningLabel = "Provisioning thread...",
  resolveMentionLink,
  rowFilter,
  showLoadOlderRows = true,
  surfaceKey,
  threadOriginKind = null,
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
    resolvedTimeline.activeWorkflows.length > 0 ||
    resolvedTimeline.activeBackgroundCommands.length > 0 ||
    (threadQuery.data?.activeBackgroundAgentCount ?? 0) > 0;
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
    threadQuery.error instanceof BbHttpError &&
    threadQuery.error.status === 404;

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
      threadOriginKind={threadOriginKind}
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
      onMessageAddToChat={onMessageAddToChat}
      onSendToMainMessage={onSendToMainMessage}
      onSelectionAddToChat={onSelectionAddToChat}
      consumerMessageActions={consumerMessageActions}
      includePluginMessageActions={includePluginMessageActions}
      onLoadOlderRows={
        showLoadOlderRows ? resolvedTimeline.loadOlderTimelineRows : undefined
      }
      onOpenLink={onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      onOpenPluginPanel={onOpenPluginPanel}
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
