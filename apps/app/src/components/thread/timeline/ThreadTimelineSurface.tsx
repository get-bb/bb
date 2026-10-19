import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActiveThinking, ThreadRuntimeDisplayStatus } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { Button } from "@bb/shared-ui/button";
import { ConversationTimeline } from "@/components/ui/conversation.js";
import { HeightTransition } from "@/components/ui/height-transition.js";
import { Icon } from "@bb/shared-ui/icon";
import { isRouteLoadingSkeletonMounted } from "@/components/ui/route-loading-skeleton";
import { toUserAttachmentImageSrc } from "@/lib/user-attachment-images";
import {
  SHORT_LIVED_STATUS_DELAY_MS,
  useSustainedFlag,
} from "@/hooks/useSustainedFlag";
import { ThreadTimelineLoadingSkeleton } from "./ThreadTimelineLoadingSkeleton.js";
import { ThreadTimelineRows } from "./ThreadTimelineRows.js";
import { useAutoLoadOlderRows } from "./useAutoLoadOlderRows.js";
import { TimelineStatusIndicator } from "./TimelineStatusIndicator.js";
import type { TimelineTitleActionResolver } from "./TimelineTitleView.js";
import { TimelineReasoningExpansionProvider } from "./TimelineReasoningExpansion.js";
import { TimelineWorkingIndicator } from "./TimelineWorkingIndicator.js";
import type {
  ThreadTimelineForkMessageHandler,
  ThreadTimelineEditMessageHandler,
  ThreadTimelineInlineMessageEditor,
  ThreadTimelineAddToChatHandler,
  ThreadTimelineConsumerMessageAction,
  ThreadTimelineLinkHandler,
  ThreadTimelineLocalFileLinkHandler,
  ThreadTimelineOpenPluginPanelHandler,
  ThreadTimelineUnreadDividerPlacement,
} from "./types.js";

export interface HostConnectionNotice {
  label: string;
}

export interface ThreadTimelineSurfaceProps {
  activeThinking: ActiveThinking | null;
  canSpawnChild?: boolean;
  contextBoundarySeq: number | null;
  hasOlderTimelineRows?: boolean;
  hostConnectionNotice?: HostConnectionNotice | null;
  isCatchingUpTimeline?: boolean;
  isLoadingOlderTimelineRows?: boolean;
  isThreadTimelinePending: boolean;
  timelineError: boolean;
  loadingContent?: ReactNode;
  leadingContent?: ReactNode;
  onForkMessage?: ThreadTimelineForkMessageHandler;
  onEditMessage?: ThreadTimelineEditMessageHandler;
  inlineMessageEditor?: ThreadTimelineInlineMessageEditor;
  onMessageAddToChat?: ThreadTimelineAddToChatHandler;
  onSelectionAddToChat?: ThreadTimelineAddToChatHandler;
  consumerMessageActions?: readonly ThreadTimelineConsumerMessageAction[];
  includePluginMessageActions?: boolean;
  onLoadOlderRows?: () => Promise<void> | void;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onOpenPluginPanel?: ThreadTimelineOpenPluginPanelHandler;
  onTitleAction?: TimelineTitleActionResolver;
  projectId?: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  showOngoingIndicator: boolean;
  ongoingIndicatorLabel?: string;
  isStopping?: boolean;
  stoppingAnchorAt?: number;
  timelineErrorClassName?: string;
  timelineRows: TimelineRow[];
  timelineNavigationTargetRowId?: string | null;
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
  contextBoundarySeq,
  hasOlderTimelineRows = false,
  hostConnectionNotice,
  isCatchingUpTimeline = false,
  isLoadingOlderTimelineRows = false,
  isThreadTimelinePending,
  timelineError,
  loadingContent,
  leadingContent,
  onForkMessage,
  onEditMessage,
  inlineMessageEditor,
  onMessageAddToChat,
  onSelectionAddToChat,
  consumerMessageActions,
  includePluginMessageActions,
  onLoadOlderRows,
  onOpenLink,
  onOpenLocalFileLink,
  onOpenPluginPanel,
  onTitleAction,
  projectId,
  resolveMentionLink,
  showOngoingIndicator,
  ongoingIndicatorLabel,
  isStopping = false,
  stoppingAnchorAt = 0,
  timelineErrorClassName = "mt-6 text-destructive",
  timelineRows,
  timelineNavigationTargetRowId,
  threadId,
  threadRuntimeDisplayStatus,
  unreadDividerAutoScroll,
  unreadDividerPlacement,
  workspaceRootPath,
}: ThreadTimelineSurfaceProps) {
  const showCatchUpIndicator =
    isCatchingUpTimeline &&
    !isThreadTimelinePending &&
    !timelineError &&
    !showOngoingIndicator;
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
  const isOngoingIndicatorSustained = useSustainedFlag(
    showOngoingIndicator,
    SHORT_LIVED_STATUS_DELAY_MS,
  );
  const isOngoingIndicatorVisible =
    showOngoingIndicator &&
    (timelineRowsWithPendingStop.length > 0 || isOngoingIndicatorSustained);
  const showLoadOlderRows =
    hasOlderTimelineRows &&
    onLoadOlderRows !== undefined &&
    !isThreadTimelinePending &&
    !timelineError;

  return (
    <TimelineReasoningExpansionProvider key={threadId}>
      <ConversationTimeline className="flex-1">
        {leadingContent}
        {showLoadOlderRows ? (
          <LoadOlderMessages
            key={`context-boundary:${contextBoundarySeq}`}
            hasOlderTimelineRows={hasOlderTimelineRows}
            isLoadingOlderTimelineRows={isLoadingOlderTimelineRows}
            onLoadOlderRows={onLoadOlderRows}
          />
        ) : null}
        {isThreadTimelinePending ? (
          (loadingContent ?? <DelayedThreadLoadingIndicator />)
        ) : timelineError ? (
          <TimelineStatusIndicator
            label="Failed to load timeline"
            className={timelineErrorClassName}
          />
        ) : timelineRowsWithPendingStop.length > 0 ? (
          <ThreadTimelineRows
            canSpawnChild={canSpawnChild}
            onForkMessage={onForkMessage}
            onEditMessage={onEditMessage}
            inlineMessageEditor={inlineMessageEditor}
            onMessageAddToChat={onMessageAddToChat}
            onSelectionAddToChat={onSelectionAddToChat}
            consumerMessageActions={consumerMessageActions}
            includePluginMessageActions={includePluginMessageActions}
            onOpenLink={onOpenLink}
            onOpenLocalFileLink={onOpenLocalFileLink}
            onOpenPluginPanel={onOpenPluginPanel}
            onTitleAction={onTitleAction}
            projectId={projectId}
            resolveMentionLink={resolveMentionLink}
            resolveUserAttachmentImageSrc={toUserAttachmentImageSrc}
            hasOlderTimelineRows={hasOlderTimelineRows}
            isLoadingOlderTimelineRows={isLoadingOlderTimelineRows}
            onLoadOlderRows={onLoadOlderRows}
            timelineRows={timelineRowsWithPendingStop}
            timelineNavigationTargetRowId={timelineNavigationTargetRowId}
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
            className="mt-4 text-destructive"
          />
        ) : null}
        <HeightTransition visible={showCatchUpIndicator}>
          {showCatchUpIndicator ? <DelayedCatchUpIndicator /> : null}
        </HeightTransition>
        <HeightTransition visible={isOngoingIndicatorVisible}>
          <TimelineWorkingIndicator
            key={ongoingIndicatorKey}
            details={activeThinkingDetails}
            reasoningId={activeThinking?.id}
            isThinking={showActiveThinking}
            label={ongoingIndicatorLabel}
          />
        </HeightTransition>
      </ConversationTimeline>
    </TimelineReasoningExpansionProvider>
  );
}

function LoadOlderMessages({
  hasOlderTimelineRows,
  isLoadingOlderTimelineRows,
  onLoadOlderRows,
}: {
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  onLoadOlderRows: () => Promise<void> | void;
}) {
  const { sentinelRef, isAutoLoadEnabled, loadOlderRows } =
    useAutoLoadOlderRows({
      hasOlderTimelineRows,
      isLoadingOlderTimelineRows,
      onLoadOlderRows,
    });

  return (
    <div ref={sentinelRef} className="flex justify-center pt-2 mb-3">
      {isAutoLoadEnabled ? (
        <span
          className="text-muted-foreground text-xs"
          aria-live="polite"
          role="status"
        >
          {isLoadingOlderTimelineRows ? "Loading older messages…" : " "}
        </span>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={loadOlderRows}
          disabled={isLoadingOlderTimelineRows}
        >
          <Icon name="ChevronUp" aria-hidden="true" />
          {isLoadingOlderTimelineRows
            ? "Loading older messages..."
            : "Load older messages"}
        </Button>
      )}
    </div>
  );
}

const LOADING_INDICATOR_REVEAL_DELAY_MS = 200;
const CATCH_UP_INDICATOR_LABEL = "Loading latest messages…";

const CATCH_UP_INDICATOR_REVEAL_DELAY_MS = 1_000;

function DelayedCatchUpIndicator() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(
      () => setVisible(true),
      CATCH_UP_INDICATOR_REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(id);
  }, []);

  if (!visible) return null;

  return (
    <TimelineStatusIndicator
      label={
        <span role="status" className="animate-shine">
          {CATCH_UP_INDICATOR_LABEL}
        </span>
      }
      className="mt-4 flex min-h-7 items-center"
    />
  );
}

function DelayedThreadLoadingIndicator() {
  const [visible, setVisible] = useState(isRouteLoadingSkeletonMounted);
  useEffect(() => {
    if (visible) {
      return;
    }
    const id = window.setTimeout(
      () => setVisible(true),
      LOADING_INDICATOR_REVEAL_DELAY_MS,
    );
    return () => window.clearTimeout(id);
  }, [visible]);

  if (!visible) {
    return null;
  }

  return <ThreadTimelineLoadingSkeleton />;
}

