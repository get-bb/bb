import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  ActiveThinking,
  ThreadChildOrigin,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { Button } from "@/components/ui/button.js";
import { ConversationTimeline } from "@/components/ui/conversation.js";
import { HeightTransition } from "@/components/ui/height-transition.js";
import { Icon } from "@/components/ui/icon.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { useBottomAnchoredScroll } from "@/components/ui/bottom-anchored-scroll-body.js";
import { usePreferredTheme } from "@/hooks/useTheme";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";
import { ThreadTimelineRows } from "./ThreadTimelineRows.js";
import { TimelineStatusIndicator } from "./TimelineStatusIndicator.js";
import type { TimelineTitleActionResolver } from "./TimelineTitleView.js";
import { TimelineWorkingIndicator } from "./TimelineWorkingIndicator.js";
import type {
  ThreadTimelineForkMessageHandler,
  ThreadTimelineSideChatMessageHandler,
  ThreadTimelineSendToMainMessageHandler,
  ThreadTimelineSelectionAddToChatHandler,
  ThreadTimelineSelectionReplyInSideChatHandler,
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
  ThreadTimelineUnreadDividerPlacement,
} from "./types.js";

export interface HostConnectionNotice {
  label: string;
  tone: "pending" | "error";
}

export interface ThreadTimelineSurfaceProps {
  activeThinking: ActiveThinking | null;
  canSpawnChild?: boolean;
  threadChildOrigin?: ThreadChildOrigin | null;
  hasOlderTimelineRows?: boolean;
  hostConnectionNotice?: HostConnectionNotice | null;
  isLoadingOlderTimelineRows?: boolean;
  isThreadTimelinePending: boolean;
  timelineError: boolean;
  loadingContent?: ReactNode;
  leadingContent?: ReactNode;
  onForkMessage?: ThreadTimelineForkMessageHandler;
  onSideChatMessage?: ThreadTimelineSideChatMessageHandler;
  onSendToMainMessage?: ThreadTimelineSendToMainMessageHandler;
  onSelectionAddToChat?: ThreadTimelineSelectionAddToChatHandler;
  onSelectionReplyInSideChat?: ThreadTimelineSelectionReplyInSideChatHandler;
  onLoadOlderRows?: () => Promise<void> | void;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onTitleAction?: TimelineTitleActionResolver;
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  showOngoingIndicator: boolean;
  ongoingIndicatorLabel?: string;
  isStopping?: boolean;
  stoppingAnchorAt?: number;
  timelineErrorLabel?: string;
  timelineErrorClassName?: string;
  timelineRows: TimelineRow[];
  threadId: string;
  threadRuntimeDisplayStatus: ThreadRuntimeDisplayStatus;
  unreadDividerAutoScroll?: boolean;
  unreadDividerPlacement?: ThreadTimelineUnreadDividerPlacement | null;
  workspaceRootPath: string | undefined;
}

interface BuildStopRequestedTimelineRowArgs {
  stoppingAnchorAt: number;
  threadId: string;
}

interface UseTimelineRowsWithPendingStopArgs {
  rows: TimelineRow[];
  isStopping: boolean;
  stoppingAnchorAt: number;
  threadId: string;
}

function buildStopRequestedTimelineRow({
  stoppingAnchorAt,
  threadId,
}: BuildStopRequestedTimelineRowArgs): TimelineRow {
  return {
    id: `${threadId}:pending-stop`,
    threadId,
    turnId: null,
    sourceSeqStart: 0,
    sourceSeqEnd: 0,
    startedAt: stoppingAnchorAt,
    createdAt: stoppingAnchorAt,
    kind: "system",
    systemKind: "operation",
    operationKind: "thread-interrupted",
    title: "Stop requested",
    detail: null,
    status: "pending",
    completedAt: null,
  };
}

function hasConfirmedStopRow(rows: readonly TimelineRow[]): boolean {
  return rows.some(
    (row) =>
      row.kind === "system" &&
      row.systemKind === "operation" &&
      row.operationKind === "thread-interrupted",
  );
}

function useTimelineRowsWithPendingStop({
  rows,
  isStopping,
  stoppingAnchorAt,
  threadId,
}: UseTimelineRowsWithPendingStopArgs): TimelineRow[] {
  return useMemo(() => {
    if (!isStopping || hasConfirmedStopRow(rows)) {
      return rows;
    }

    return [
      ...rows,
      buildStopRequestedTimelineRow({ stoppingAnchorAt, threadId }),
    ];
  }, [rows, isStopping, stoppingAnchorAt, threadId]);
}

export function ThreadTimelineSurface({
  activeThinking,
  canSpawnChild,
  threadChildOrigin = null,
  hasOlderTimelineRows = false,
  hostConnectionNotice,
  isLoadingOlderTimelineRows = false,
  isThreadTimelinePending,
  timelineError,
  loadingContent,
  leadingContent,
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
  isStopping = false,
  stoppingAnchorAt = 0,
  timelineErrorLabel = "Failed to load timeline",
  timelineErrorClassName = "mt-6 text-destructive",
  timelineRows,
  threadId,
  threadRuntimeDisplayStatus,
  unreadDividerAutoScroll,
  unreadDividerPlacement,
  workspaceRootPath,
}: ThreadTimelineSurfaceProps) {
  const preferredTheme = usePreferredTheme();
  const showActiveThinking =
    activeThinking !== null && ongoingIndicatorLabel === undefined;
  const activeThinkingText = activeThinking?.text.trim() ?? "";
  const activeThinkingDetails =
    showActiveThinking && activeThinkingText.length > 0
      ? activeThinking?.text
      : undefined;
  const ongoingIndicatorKey =
    showActiveThinking && activeThinking
      ? activeThinking.id
      : (ongoingIndicatorLabel ?? "working");
  const timelineRowsWithPendingStop = useTimelineRowsWithPendingStop({
    rows: timelineRows,
    isStopping,
    stoppingAnchorAt,
    threadId,
  });
  const showLoadOlderRows =
    hasOlderTimelineRows &&
    onLoadOlderRows !== undefined &&
    !isThreadTimelinePending &&
    !timelineError;

  return (
    <ConversationTimeline className="flex-1">
      {leadingContent}
      {showLoadOlderRows ? (
        <LoadOlderMessagesButton
          isLoadingOlderTimelineRows={isLoadingOlderTimelineRows}
          onLoadOlderRows={onLoadOlderRows}
        />
      ) : null}
      {isThreadTimelinePending ? (
        loadingContent ?? <DelayedThreadLoadingIndicator />
      ) : timelineError ? (
        <TimelineStatusIndicator
          label={timelineErrorLabel}
          className={timelineErrorClassName}
        />
      ) : timelineRowsWithPendingStop.length > 0 ? (
        <ThreadTimelineRows
          canSpawnChild={canSpawnChild}
          threadChildOrigin={threadChildOrigin}
          onForkMessage={onForkMessage}
          onSideChatMessage={onSideChatMessage}
          onSendToMainMessage={onSendToMainMessage}
          onSelectionAddToChat={onSelectionAddToChat}
          onSelectionReplyInSideChat={onSelectionReplyInSideChat}
          onOpenLink={onOpenLink}
          onOpenLocalFileLink={onOpenLocalFileLink}
          onTitleAction={onTitleAction}
          projectId={projectId}
          resolveMentionLink={resolveMentionLink}
          resolveUserAttachmentImageSrc={toUserAttachmentImageSrc}
          hasOlderTimelineRows={hasOlderTimelineRows}
          isLoadingOlderTimelineRows={isLoadingOlderTimelineRows}
          onLoadOlderRows={onLoadOlderRows}
          themeType={preferredTheme}
          timelineRows={timelineRowsWithPendingStop}
          threadId={threadId}
          threadRuntimeDisplayStatus={threadRuntimeDisplayStatus}
          unreadDividerAutoScroll={unreadDividerAutoScroll}
          unreadDividerPlacement={unreadDividerPlacement}
          workspaceRootPath={workspaceRootPath}
        />
      ) : null}
      {hostConnectionNotice ? (
        <TimelineStatusIndicator
          label={hostConnectionNotice.label}
          className={
            hostConnectionNotice.tone === "error"
              ? "mt-4 text-destructive"
              : "mt-4"
          }
        />
      ) : null}
      <HeightTransition visible={showOngoingIndicator}>
        <TimelineWorkingIndicator
          key={ongoingIndicatorKey}
          details={activeThinkingDetails}
          isThinking={showActiveThinking}
          label={ongoingIndicatorLabel}
        />
      </HeightTransition>
    </ConversationTimeline>
  );
}

function LoadOlderMessagesButton({
  isLoadingOlderTimelineRows,
  onLoadOlderRows,
}: {
  isLoadingOlderTimelineRows: boolean;
  onLoadOlderRows: () => Promise<void> | void;
}) {
  const bottomAnchor = useBottomAnchoredScroll();
  const handleClick = useCallback(() => {
    bottomAnchor?.captureScrollAnchor();
    void onLoadOlderRows();
  }, [bottomAnchor, onLoadOlderRows]);

  return (
    <div className="flex justify-center pt-2 mb-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleClick}
        disabled={isLoadingOlderTimelineRows}
      >
        <Icon name="ChevronUp" aria-hidden="true" />
        {isLoadingOlderTimelineRows
          ? "Loading older messages..."
          : "Load older messages"}
      </Button>
    </div>
  );
}

// Delay before revealing the loading indicator so fast loads don't flash.
export const LOADING_INDICATOR_REVEAL_DELAY_MS = 200;

function DelayedThreadLoadingIndicator() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(
      () => setVisible(true),
      LOADING_INDICATOR_REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(id);
  }, []);

  if (!visible) {
    return null;
  }

  return <ThreadTimelineLoadingSkeleton />;
}

// A lightweight placeholder that mirrors the timeline's real building blocks
// while the thread loads: a right-aligned user bubble, assistant prose, and a
// run of work rows (leading icon + title), then more prose.
function ThreadTimelineLoadingSkeleton() {
  return (
    <div className="mt-6 space-y-5" role="status" aria-label="Loading thread">
      {/* User message bubble (right-aligned, like ConversationMessageContent). */}
      <div className="flex justify-end px-2">
        <Skeleton className="h-12 w-3/5" />
      </div>
      {/* Assistant prose (text-sm lines). */}
      <div className="space-y-2 px-2">
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-3/4" />
      </div>
      {/* Work rows: leading icon + title, like tool-call / file-change rows. */}
      <div className="space-y-2.5 px-2">
        <div className="flex items-center gap-2">
          <Skeleton className="size-3.5 shrink-0 rounded" />
          <Skeleton className="h-3 w-2/5" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-3.5 shrink-0 rounded" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-3.5 shrink-0 rounded" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      {/* More assistant prose. */}
      <div className="space-y-2 px-2">
        <Skeleton className="h-3.5 w-5/6" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </div>
  );
}
