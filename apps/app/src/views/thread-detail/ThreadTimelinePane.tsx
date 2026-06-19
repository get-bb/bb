import type { ReactNode } from "react";
import type { ThreadTimelineUnreadDividerPlacement } from "@/components/thread/timeline";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  ThreadTimelineSurface,
  type HostConnectionNotice,
  type ThreadTimelineSurfaceProps,
} from "@/components/thread/timeline/ThreadTimelineSurface";

interface ThreadTimelinePaneProps extends ThreadTimelineSurfaceProps {
  canSpawnChild: boolean;
  footer: ReactNode;
  hasOlderTimelineRows: boolean;
  header: ReactNode;
  isLoadingOlderTimelineRows: boolean;
  isStopping: boolean;
  onLoadOlderRows: () => void;
  resolveMentionLink: PromptMentionLinkResolver;
  stoppingAnchorAt: number;
  unreadDividerAutoScroll: boolean;
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null;
}

export type { HostConnectionNotice };

export function ThreadTimelinePane({
  activeThinking,
  canSpawnChild,
  threadChildOrigin,
  footer,
  hasOlderTimelineRows,
  header,
  hostConnectionNotice,
  isLoadingOlderTimelineRows,
  isThreadTimelinePending,
  timelineError,
  onForkMessage,
  onSideChatMessage,
  onSendToMainMessage,
  onSelectionAddToChat,
  onSelectionReplyInSideChat,
  onLoadOlderRows,
  onOpenLink,
  onOpenLocalFileLink,
  onTitleAction,
  projectId,
  resolveMentionLink,
  showOngoingIndicator,
  ongoingIndicatorLabel,
  isStopping,
  stoppingAnchorAt,
  timelineRows,
  threadId,
  threadRuntimeDisplayStatus,
  unreadDividerAutoScroll,
  unreadDividerPlacement,
  workspaceRootPath,
}: ThreadTimelinePaneProps) {
  return (
    <div
      data-thread-window=""
      className="flex h-full min-h-0 min-w-0 flex-col overflow-clip"
    >
      {header}
      <PageShell
        key={threadId}
        scrollBehavior="bottom-anchor"
        scrollAnchorThreadId={threadId}
        shellClassName="!mx-0 !mt-0 md:!mx-0 md:!mt-0"
        contentClassName="gap-2 pt-4"
        footerClassName="chat-prompt-box"
        footer={footer}
      >
        <ThreadTimelineSurface
          activeThinking={activeThinking}
          canSpawnChild={canSpawnChild}
          threadChildOrigin={threadChildOrigin}
          hasOlderTimelineRows={hasOlderTimelineRows}
          hostConnectionNotice={hostConnectionNotice}
          isLoadingOlderTimelineRows={isLoadingOlderTimelineRows}
          isThreadTimelinePending={isThreadTimelinePending}
          timelineError={timelineError}
          onForkMessage={onForkMessage}
          onSideChatMessage={onSideChatMessage}
          onSendToMainMessage={onSendToMainMessage}
          onSelectionAddToChat={onSelectionAddToChat}
          onSelectionReplyInSideChat={onSelectionReplyInSideChat}
          onLoadOlderRows={onLoadOlderRows}
          onOpenLink={onOpenLink}
          onOpenLocalFileLink={onOpenLocalFileLink}
          onTitleAction={onTitleAction}
          projectId={projectId}
          resolveMentionLink={resolveMentionLink}
          showOngoingIndicator={showOngoingIndicator}
          ongoingIndicatorLabel={ongoingIndicatorLabel}
          isStopping={isStopping}
          stoppingAnchorAt={stoppingAnchorAt}
          timelineRows={timelineRows}
          threadId={threadId}
          threadRuntimeDisplayStatus={threadRuntimeDisplayStatus}
          unreadDividerAutoScroll={unreadDividerAutoScroll}
          unreadDividerPlacement={unreadDividerPlacement}
          workspaceRootPath={workspaceRootPath}
        />
      </PageShell>
    </div>
  );
}
