import { isRunningThreadRuntimeDisplayStatus } from "@bb/client-core";
import type { ThreadQueuedMessage } from "@bb/domain";
import { BbHttpError } from "@bb/sdk/browser";
import {
  Stack,
  useIsFocused,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { View } from "react-native";
import { useProfiles } from "@/app-shell";
import type { ComposerHandle } from "@/composer";
import {
  childThreadAttentionSource,
  useChildThreadPendingInteractions,
  type ChildThreadPendingAttentionSource,
} from "@/data/interactions";
import { registerThreadComposerHost } from "@/data/files";
import { useProjectDisplayName } from "@/data/sidebar";
import {
  getLatestPendingInteraction,
  useChildThreads,
  useChildThreadSummary,
  useThreadDetailBootstrap,
  useThreadPendingInteractions,
  useThreadQueuedMessages,
  useThreadTimelineController,
} from "@/data/thread-detail";
import { appendPendingStopRow } from "@/data/thread-runtime";
import {
  getThreadDisplayTitle,
  useMarkThreadRead,
  useThread,
  useThreadReadTracking,
} from "@/data/threads";
import {
  Button,
  EmptyStatePanel,
  COMPOSER_KEYBOARD_GAP,
  KeyboardPaddingView,
  OverlayBounds,
  Skeleton,
  Text,
  useSheet,
} from "@/ui";
import { ThreadWorkspacePanelProvider, usePanel } from "../panel";
import { Screen } from "../shell/Screen";
import {
  ThreadActionsSheet,
  useThreadActionsSheet,
  type ThreadMenuAction,
} from "./actions/ThreadActionsSheet";
import { ThreadGitActionSheet } from "./actions/ThreadGitActionSheet";
import { useMessageActionHandlers } from "./actions/use-message-action-handlers";
import { useThreadGitActions } from "./actions/use-thread-git-actions";
import { MergeBasePickerSheet } from "./banner/MergeBasePickerSheet";
import { useThreadContextBanner } from "./banner/use-thread-context-banner";
import { ThreadPromptArea } from "./prompt-area/ThreadPromptArea";
import { useFollowUpComposer } from "./prompt-area/use-follow-up-composer";
import { ThreadHeaderActions, ThreadHeaderTitle } from "./ThreadDetailHeader";
import {
  describeThreadEnvironment,
  describeThreadStatusPill,
} from "./thread-detail-header-model";
import {
  buildTimelineListEntries,
  renderTurnChildrenLoaders,
  TimelineList,
  TimelineRowHostProvider,
  useTimelineListItems,
  useTurnChildrenMap,
  WorkingIndicatorRow,
  type TimelineListHandle,
} from "./timeline";
import { useThreadUnreadDividerState } from "./use-thread-unread-divider-state";

/**
 * Id of the builtin side-chat plugin, which owns every side chat (a hidden
 * fork); mirrors apps/app/src/lib/side-chat-plugin.ts.
 */
const SIDE_CHAT_PLUGIN_ID = "side-chat";

const EMPTY_QUEUED_MESSAGES: ThreadQueuedMessage[] = [];
const EMPTY_CHILD_SOURCES: ChildThreadPendingAttentionSource[] = [];

function isNotFoundError(error: unknown): boolean {
  return error instanceof BbHttpError && error.status === 404;
}

function TimelineSkeleton() {
  return (
    <View className="gap-4 px-4 pt-4" testID="thread-timeline-loading">
      <Skeleton className="h-5 w-3/4" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-5 w-2/3" />
    </View>
  );
}

function ThreadDetailBody({ threadId }: { threadId: string }) {
  const router = useRouter();
  const bootstrap = useThreadDetailBootstrap(threadId);
  const threadQuery = useThread(threadId);
  const thread = threadQuery.data;
  const threadReady = thread !== undefined;
  const projectName = useProjectDisplayName(thread?.projectId);
  const isFocused = useIsFocused();
  const markRead = useMarkThreadRead();
  useThreadReadTracking({
    thread,
    isScreenFocused: isFocused,
    markThreadRead: markRead.mutate,
  });

  const {
    activeBackgroundCommands,
    activeThinking,
    activeWorkflows,
    contextWindowUsage,
    goal,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    modelFallback,
    pendingTodos,
    activePromptMode,
    refetchLatestTimeline,
    timelineError,
    timelineLoading,
    timelineRows: loadedTimelineRows,
  } = useThreadTimelineController({ threadId });
  const pendingInteractionsQuery = useThreadPendingInteractions(threadId, {
    enabled: threadReady,
  });
  const pendingInteraction = getLatestPendingInteraction(
    pendingInteractionsQuery.data,
  );
  const hasPendingInteraction = pendingInteraction !== null;
  const queuedMessagesQuery = useThreadQueuedMessages(threadId, {
    enabled: threadReady,
  });
  const queuedMessages = queuedMessagesQuery.data ?? EMPTY_QUEUED_MESSAGES;
  const childSummary = useChildThreadSummary(thread?.id, {
    enabled: threadReady,
  });
  // Children waiting on input surface above the parent's composer.
  const childThreadsQuery = useChildThreads(thread?.id, {
    enabled: threadReady,
  });
  const childAttentionSources = useMemo(
    () =>
      childThreadsQuery.data?.map((entry) =>
        childThreadAttentionSource(entry, getThreadDisplayTitle(entry)),
      ) ?? EMPTY_CHILD_SOURCES,
    [childThreadsQuery.data],
  );
  const childPendingInteractions = useChildThreadPendingInteractions(
    childAttentionSources,
  );

  const runtimeDisplayStatus = thread?.runtime.displayStatus ?? "idle";
  const scopeActive = isRunningThreadRuntimeDisplayStatus(runtimeDisplayStatus);
  // The client-only "Stop requested" row while the server has not yet
  // written its own interrupted row.
  const threadStopping = thread?.status === "stopping";
  const stoppingAnchorAt = thread?.updatedAt ?? 0;
  const timelineRows = useMemo(
    () =>
      appendPendingStopRow(loadedTimelineRows, {
        isStopping: threadStopping,
        stoppingAnchorAt,
        threadId,
      }),
    [loadedTimelineRows, stoppingAnchorAt, threadId, threadStopping],
  );

  const { turnChildren, onChange: onTurnChildrenChange } = useTurnChildrenMap();
  const { items, toggleRow } = useTimelineListItems({
    rows: timelineRows,
    scopeActive,
    turnChildren,
    resetKey: threadId,
  });
  const turnLoaders = renderTurnChildrenLoaders(
    items,
    threadId,
    onTurnChildrenChange,
  );

  const unreadDivider = useThreadUnreadDividerState(thread);
  const { entries, unreadDividerIndex } = useMemo(
    () => buildTimelineListEntries(items, unreadDivider.placement),
    [items, unreadDivider.placement],
  );

  const listRef = useRef<TimelineListHandle>(null);
  // The workspace panel (Info / Diff / Files / Terminal + synced file tabs):
  // the header button presents it.
  const panel = usePanel();
  const openPanel = panel.open;
  const onOpenPanel = useCallback(() => openPanel(), [openPanel]);

  // Context banner (git / PR / parent / children / archived) + the workspace
  // facts the header git sheet shares with it.
  // The banner's changed-files rows open the panel's Diff tab (focused on
  // the tapped file).
  const contextBanner = useThreadContextBanner({
    threadId,
    thread,
    openDiff: panel.openDiff,
  });
  const gitActions = useThreadGitActions({
    thread,
    environment: contextBanner.workspace.environment,
    workspaceStatus: contextBanner.workspace.status,
    mergeBaseBranch: contextBanner.workspace.mergeBaseBranch,
  });
  const gitSheet = useSheet();
  // Header "…" menu (rename, pin, read state, move, links, archive, delete).
  const threadActions = useThreadActionsSheet();
  const presentThreadMenu = threadActions.present;
  const openThreadMenu = useCallback(
    () => presentThreadMenu("menu"),
    [presentThreadMenu],
  );
  const openRename = useCallback(
    () => presentThreadMenu("rename"),
    [presentThreadMenu],
  );
  const handleDeleted = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);
  const environmentGoneStatus = contextBanner.workspace.environmentGoneStatus;
  // The follow-up composer: per-thread draft, submit mode, send / queue /
  // steer, stop, edit modes, quoting. Submissions scroll the list down.
  const scrollTimelineToEnd = useCallback(() => {
    listRef.current?.scrollToEnd();
  }, []);
  const composerRef = useRef<ComposerHandle | null>(null);
  const composer = useFollowUpComposer({
    threadId,
    thread,
    hasPendingInteraction,
    pendingInteractionsInitialLoading:
      pendingInteractionsQuery.isLoading && !pendingInteractionsQuery.data,
    queuedMessages,
    modelFallback,
    activeWorkflowCount: activeWorkflows.length,
    activeBackgroundCommandCount: activeBackgroundCommands.length,
    timelineRows: loadedTimelineRows,
    timelineLoading,
    environmentGone: environmentGoneStatus !== null,
    onSubmitted: scrollTimelineToEnd,
    composerRef,
  });
  // File previews pushed above this screen (and panel file tabs) reach the
  // composer for "Add to chat" through the per-thread composer host.
  useEffect(
    () =>
      registerThreadComposerHost(threadId, {
        quote: composer.quoteIntoComposer,
      }),
    [composer.quoteIntoComposer, threadId],
  );
  // Long-press message actions: copy (always), quote / edit (composer),
  // fork (provider permitting), send-to-main (side chats).
  const messageActions = useMessageActionHandlers({
    thread,
    quoteIntoComposer: composer.quoteIntoComposer,
    editMessage: composer.editSentMessage,
  });

  const title = thread ? getThreadDisplayTitle(thread) : "Thread";
  const statusPill = describeThreadStatusPill({
    runtimeDisplayStatus,
    threadStatus: thread?.status ?? "idle",
    hasPendingInteraction,
    archived: thread?.archivedAt != null,
  });
  const environmentParts = describeThreadEnvironment({
    environment: bootstrap.data?.environment ?? null,
    host: bootstrap.data?.host ?? null,
    projectName: projectName ?? null,
  });
  // The "…" menu's first rows: what the old second header row carried.
  const menuLeadingActions: ThreadMenuAction[] = [
    {
      key: "workspace",
      label: "Workspace",
      icon: "PanelBottom",
      onPress: () => {
        threadActions.dismiss();
        onOpenPanel();
      },
      testID: "thread-panel-menu-button",
    },
    ...(gitActions.primaryLabel !== null
      ? [
          {
            key: "git",
            label: gitActions.primaryLabel,
            icon: "GitBranch" as const,
            pending: gitActions.pending,
            onPress: () => {
              threadActions.dismiss();
              gitSheet.present();
            },
            testID: "thread-git-button",
          },
        ]
      : []),
  ];
  const menuDetail = [
    ...(childSummary.count > 0
      ? [
          `${childSummary.count} child thread${childSummary.count === 1 ? "" : "s"}${
            childSummary.activity.pending
              ? " · needs input"
              : childSummary.activity.working
                ? " · working"
                : ""
          }`,
        ]
      : []),
    ...environmentParts,
  ].join(" · ");
  const childPillLabel =
    thread?.parentThreadId == null
      ? null
      : thread.originKind === "fork" &&
          thread.originPluginId === SIDE_CHAT_PLUGIN_ID
        ? "side chat"
        : "child";

  const showWorkingIndicator =
    thread !== undefined &&
    thread.status !== "stopping" &&
    // A pending interaction renders its own row; the indicator would only
    // duplicate it.
    !hasPendingInteraction &&
    scopeActive &&
    !timelineLoading;
  const workingLabel =
    runtimeDisplayStatus === "host-reconnecting"
      ? "Waiting for reconnection"
      : activeThinking
        ? "Thinking…"
        : "Working…";

  const footer = showWorkingIndicator ? (
    <WorkingIndicatorRow
      label={workingLabel}
      activeThinking={
        runtimeDisplayStatus === "host-reconnecting" ? null : activeThinking
      }
      activeWorkflows={activeWorkflows}
    />
  ) : null;

  // Thread shell failed: not found vs. transport/server error.
  const threadError = threadQuery.error ?? bootstrap.error;
  if (!thread && threadError) {
    const notFound = isNotFoundError(threadError);
    return (
      <>
        <Stack.Screen options={{ title: notFound ? "Not found" : "Thread" }} />
        <View className="gap-3 p-4" testID="thread-detail-error">
          <EmptyStatePanel>
            <Text className="text-center text-sm text-muted-foreground">
              {notFound
                ? "This thread no longer exists."
                : "Could not load this thread."}
            </Text>
            {!notFound ? (
              <Text variant="caption" className="pt-1 text-center">
                {threadError.message}
              </Text>
            ) : null}
          </EmptyStatePanel>
          {!notFound ? (
            <Button
              variant="outline"
              icon="RotateCcw"
              onPress={() => {
                void threadQuery.refetch();
                void bootstrap.refetch();
                void refetchLatestTimeline();
              }}
            >
              Retry
            </Button>
          ) : null}
        </View>
      </>
    );
  }

  return (
    <TimelineRowHostProvider
      threadId={threadId}
      workspaceRootPath={bootstrap.data?.environment?.path ?? undefined}
      threadOriginKind={thread?.originKind ?? null}
      messageActions={messageActions}
    >
      <Stack.Screen
        options={{
          title,
          headerTitle: () => (
            <ThreadHeaderTitle
              title={title}
              statusPill={statusPill}
              childPillLabel={childPillLabel}
              onPressTitle={threadReady ? openRename : null}
            />
          ),
          headerRight: () => (
            <ThreadHeaderActions
              onOpenActions={threadReady ? openThreadMenu : null}
              onOpenPanel={threadReady ? onOpenPanel : null}
              panelActive={panel.visible}
            />
          ),
        }}
      />
      {turnLoaders}
      <KeyboardPaddingView
        style={{ flex: 1 }}
        keyboardGap={COMPOSER_KEYBOARD_GAP}
      >
        {/* The composer's typeahead floats up to the top of this region,
            never under the header. */}
        <OverlayBounds style={{ flex: 1 }}>
          {(timelineLoading && entries.length === 0) || !threadReady ? (
            <View className="flex-1">
              <TimelineSkeleton />
            </View>
          ) : timelineError && entries.length === 0 ? (
            <View className="flex-1 gap-3 p-4" testID="thread-timeline-error">
              <EmptyStatePanel>
                <Text className="text-center text-sm text-muted-foreground">
                  Failed to load the timeline.
                </Text>
                <Text variant="caption" className="pt-1 text-center">
                  {timelineError.message}
                </Text>
              </EmptyStatePanel>
              <Button
                variant="outline"
                icon="RotateCcw"
                onPress={() => void refetchLatestTimeline()}
              >
                Retry
              </Button>
            </View>
          ) : entries.length === 0 && !showWorkingIndicator ? (
            <View className="flex-1 px-4 pt-6" testID="thread-timeline-empty">
              <EmptyStatePanel>No messages yet.</EmptyStatePanel>
            </View>
          ) : (
            <TimelineList
              ref={listRef}
              entries={entries}
              unreadDividerIndex={unreadDividerIndex}
              unreadDividerAutoScroll={unreadDivider.autoScroll}
              onToggleRow={toggleRow}
              threadId={threadId}
              projectId={thread?.projectId ?? ""}
              hasOlderRows={hasOlderTimelineRows}
              isLoadingOlderRows={isLoadingOlderTimelineRows}
              onLoadOlderRows={loadOlderTimelineRows}
              footer={footer}
              bottomInset={8}
              testID="thread-timeline"
            />
          )}
          <ThreadPromptArea
            threadId={threadId}
            thread={thread}
            environmentId={bootstrap.data?.environment?.id ?? null}
            hostId={bootstrap.data?.host?.id ?? null}
            composer={composer}
            composerRef={composerRef}
            pendingInteraction={pendingInteraction}
            childPendingInteractions={childPendingInteractions}
            queuedMessages={queuedMessages}
            activeWorkflows={activeWorkflows}
            activeBackgroundCommands={activeBackgroundCommands}
            activePromptMode={activePromptMode}
            goal={goal}
            pendingTodos={pendingTodos}
            modelFallback={modelFallback}
            contextWindowUsage={contextWindowUsage}
            contextBanner={contextBanner.banner}
            onHandoffToNewThread={contextBanner.handoffToNewThread}
          />
        </OverlayBounds>
      </KeyboardPaddingView>
      {thread ? (
        <ThreadActionsSheet
          controller={threadActions}
          thread={thread}
          onDeleted={handleDeleted}
          onHandoffToNewThread={contextBanner.handoffToNewThread}
          onNewThreadInWorktree={contextBanner.newThreadInWorktree}
          leadingActions={menuLeadingActions}
          headerDetail={menuDetail.length > 0 ? menuDetail : null}
        />
      ) : null}
      <ThreadGitActionSheet
        controller={gitSheet}
        actions={gitActions.actions}
        branchName={contextBanner.workspace.branchName}
        gitStatus={contextBanner.workspace.gitStatus}
        changedFiles={contextBanner.workspace.changedFiles}
        mergeBaseBranch={
          contextBanner.workspace.showMergeBase
            ? (contextBanner.workspace.mergeBaseBranch ?? null)
            : null
        }
        onPickMergeBase={
          contextBanner.workspace.showMergeBase
            ? contextBanner.mergeBaseSheet.present
            : null
        }
        pending={gitActions.pending}
        onRun={gitActions.run}
      />
      <MergeBasePickerSheet {...contextBanner.mergeBasePicker} />
    </TimelineRowHostProvider>
  );
}

/**
 * `/threads/[id]`: header (title, status, environment), the virtualized
 * timeline, and the prompt area (pending interaction banner, prompt-stack
 * cards, context banner, queued messages, the follow-up composer), inside
 * the thread's workspace panel provider (the bottom sheet with Info / Diff /
 * Files / Terminal and the synced file tabs). Opening the thread marks it
 * read while visible (same policy as the web).
 */
export function ThreadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { connection } = useProfiles();
  if (!connection || !id) {
    return (
      <Screen testID="thread-detail-screen">
        <EmptyStatePanel>No active server.</EmptyStatePanel>
      </Screen>
    );
  }
  return (
    <Screen scroll={false} testID="thread-detail-screen">
      <ThreadWorkspacePanelProvider key={id} threadId={id}>
        <ThreadDetailBody threadId={id} />
      </ThreadWorkspacePanelProvider>
    </Screen>
  );
}
