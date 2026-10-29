import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { nanoid } from "nanoid";
import { defaultAppSettings, type Environment } from "@bb/domain";
import type { ThreadResponse, TimelineRow } from "@bb/server-contract";
import {
  appendQuoteAndAttachmentsToDraft,
  promptInputToDraft,
  type PromptDraftAttachment,
  type PromptDraftState,
  type PromptMentionLinkResolver,
} from "@bb/client-core";
import { cn } from "@bb/shared-ui/lib/utils";
import { OverflowFade } from "@bb/shared-ui/overflow-fade";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  isRunningThreadRuntimeDisplayStatus,
  ThreadTimelineSurface,
  type ThreadTimelineAddToChatHandler,
  type ThreadTimelineConsumerMessageAction,
  type ThreadTimelineEditMessageHandler,
  type ThreadTimelineEditMessageTarget,
  type ThreadTimelineForkMessageHandler,
  type ThreadTimelineInlineMessageEditor,
  type ThreadTimelineLinkHandler,
  type ThreadTimelineLocalFileLinkHandler,
  type ThreadTimelineUnreadDividerPlacement,
  type TimelineTitleActionResolver,
  type UseThreadTimelineControllerResult,
} from "@/components/thread/timeline";
import type { HostConnectionNotice } from "@/components/thread/timeline/ThreadTimelineSurface";
import { ThreadTimelinePanelLoadingSkeleton } from "@/components/thread/timeline/ThreadChatLoading";
import { ThreadTableOfContents } from "@/components/thread/toc/ThreadTableOfContents";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { PageShell } from "@/components/ui/page-shell.js";
import { appToast } from "@/components/ui/app-toast";
import { SelectionAddToChatContext } from "@/components/thread/SelectionAddToChatContext";
import {
  isThreadDisplayStatusBannerActive,
  type ThreadPromptChildThreadsSection,
  type ThreadPromptParentThreadSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import type { EnvironmentSummaryChrome } from "@/lib/environment-workspace-display";
import type { MachineRemovalStatus } from "@/lib/machine-removal-display";
import type { WorkspaceCheckoutDisplay } from "@bb/shared-ui/lib/workspace-checkout-display";
import { createCoreComposerActions } from "@/lib/plugin-composer-handle";
import {
  requestComposerFocus,
  subscribeComposerFocusRequests,
} from "@/lib/composer-focus-requests";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/route-paths";
import { showMutationErrorToast } from "@/lib/mutation-errors";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  useChildThreads,
  useThread,
  useThreadPendingInteractions,
} from "@/hooks/queries/thread-queries";
import {
  useChildThreadPendingAttention,
  type ChildThreadPendingAttentionSource,
} from "@/hooks/queries/child-thread-pending-interactions";
import {
  useEditThreadMessage,
  useSendThreadMessage,
} from "@/hooks/mutations/thread-runtime-mutations";
import {
  ThreadDetailPromptArea,
  type ThreadComposerPermissionPolicy,
  type ThreadDetailSentMessageEdit,
} from "./ThreadDetailPromptArea";

const THREAD_DETAIL_COMPOSER_ID = "thread-detail-follow-up-composer";
const EMPTY_CHILD_THREAD_ITEMS: readonly ChildThreadPendingAttentionSource[] =
  [];

export type ThreadScreenPresentation =
  | { kind: "page" }
  | {
      kind: "panel";
      layout: "contained" | "document";
      measure: "page" | "panel";
      tone: "background" | "sidebar";
    }
  | { kind: "transcript"; layout: "contained" | "document" };

export interface ThreadScreenTimelineHost {
  consumerMessageActions?: readonly ThreadTimelineConsumerMessageAction[];
  environmentHostName: string | null;
  includePluginMessageActions: boolean;
  leadingContent?: ReactNode;
  onForkMessage?: ThreadTimelineForkMessageHandler;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onTitleAction?: TimelineTitleActionResolver;
  unreadDividerAutoScroll: boolean;
  unreadDividerPlacement: ThreadTimelineUnreadDividerPlacement | null;
}

export interface ThreadScreenComposerHost {
  environmentCheckout: WorkspaceCheckoutDisplay | undefined;
  environmentChrome: EnvironmentSummaryChrome | undefined;
  contextEnvironmentId: string | null;
  focusRequest?: number;
  onCreateNewThreadInEnvironment?: () => void;
  onOpenThreadInfo?: () => void;
  permissionPolicy: ThreadComposerPermissionPolicy;
}

interface ThreadScreenProps {
  composer: ThreadScreenComposerHost | null;
  environment: Environment | null;
  presentation: ThreadScreenPresentation;
  projectId: string;
  resolveMentionLink: PromptMentionLinkResolver;
  thread: ThreadResponse;
  timeline: UseThreadTimelineControllerResult;
  timelineHost: ThreadScreenTimelineHost;
  workspaceRootPath: string | undefined;
}

interface SentMessageEditSession {
  draft: PromptDraftState;
  operationId: string;
  target: ThreadTimelineEditMessageTarget;
  threadId: string;
}

function hasTimelineRowId(
  rows: readonly TimelineRow[],
  rowId: string,
): boolean {
  return rows.some(
    (row) =>
      row.id === rowId ||
      (row.kind === "turn" &&
        row.children !== null &&
        hasTimelineRowId(row.children, rowId)),
  );
}

function buildHostConnectionNotice(
  thread: ThreadResponse,
  hostName: string | null,
): HostConnectionNotice | null {
  if (thread.runtime.displayStatus !== "waiting-for-host") {
    return null;
  }
  return { label: `${hostName ?? "Host"} disconnected` };
}

function resolveEnvironmentGoneStatus(
  environment: Environment | null,
): MachineRemovalStatus | "destroyed" | null {
  if (environment === null) return null;
  if (environment.hostLifecycle !== "active") return environment.hostLifecycle;
  return environment.status === "destroyed" ? "destroyed" : null;
}

export function useThreadComposerAddToChat(thread: {
  id: string;
  projectId: string;
}): ThreadTimelineAddToChatHandler {
  const isCompactViewport = useIsCompactViewport();
  const promptDraft = useMemo(
    () =>
      getPromptDraftAccessor({
        kind: "thread",
        projectId: thread.projectId,
        threadId: thread.id,
      }),
    [thread.id, thread.projectId],
  );
  return useCallback(
    (text: string, attachments?: readonly PromptDraftAttachment[]) => {
      if (isCompactViewport && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      const composerActions = createCoreComposerActions({
        ...promptDraft,
        focus: () => requestComposerFocus(promptDraft.storageKey),
      });
      composerActions.replace((current) =>
        appendQuoteAndAttachmentsToDraft(current, text, attachments ?? []),
      );
      composerActions.focus();
    },
    [isCompactViewport, promptDraft],
  );
}

function useParentThreadSection(
  thread: ThreadResponse,
  enabled: boolean,
): ThreadPromptParentThreadSection | null {
  const threadOriginKind = thread.originKind;
  const threadSourceThreadId =
    thread.sourceThreadId ?? (threadOriginKind ? thread.parentThreadId : null);
  const { data: parentThread } = useThread(
    enabled ? (thread.parentThreadId ?? "") : "",
  );
  const { data: sourceThread } = useThread(
    enabled ? (threadSourceThreadId ?? "") : "",
  );
  return useMemo(() => {
    const relatedThreadId =
      threadOriginKind !== null ? threadSourceThreadId : thread.parentThreadId;
    if (!enabled || !relatedThreadId) return null;
    const relationship = threadOriginKind === "fork" ? "fork" : "parent";
    const relatedThread =
      relationship === "parent" ? parentThread : sourceThread;
    const href = getThreadRoutePath({
      projectId: relatedThread?.projectId ?? thread.projectId,
      threadId: relatedThreadId,
    });
    if (relatedThread === undefined) {
      return {
        parentThreadTitle: relatedThreadId.slice(0, 8),
        href,
        relationship,
      };
    }
    if (
      relatedThread.archivedAt !== null ||
      relatedThread.deletedAt !== null ||
      (relationship !== "parent" &&
        relatedThread.projectId !== thread.projectId)
    ) {
      return null;
    }
    return {
      parentThreadTitle: getThreadDisplayTitle(relatedThread),
      href,
      relationship,
    };
  }, [
    enabled,
    parentThread,
    sourceThread,
    thread.parentThreadId,
    thread.projectId,
    threadOriginKind,
    threadSourceThreadId,
  ]);
}

function useChildThreadsSection(
  threadId: string,
  enabled: boolean,
): ThreadPromptChildThreadsSection | null {
  const childThreadSubsetQuery = useChildThreads({
    enabled,
    parentThreadId: threadId,
  });
  const childThreadsSection = useMemo(() => {
    const list = enabled ? (childThreadSubsetQuery.data ?? []) : [];
    const activeItems = list
      .filter(
        (entry) =>
          entry.originKind === null &&
          (isThreadDisplayStatusBannerActive(entry.runtime.displayStatus) ||
            entry.hasPendingInteraction),
      )
      .sort((left, right) =>
        left.hasPendingInteraction === right.hasPendingInteraction
          ? right.latestAttentionAt - left.latestAttentionAt
          : left.hasPendingInteraction
            ? -1
            : 1,
      )
      .map((entry) => ({
        id: entry.id,
        title: getThreadDisplayTitle(entry),
        href: getThreadRoutePath({
          projectId: entry.projectId,
          threadId: entry.id,
        }),
        hasPendingInteraction: entry.hasPendingInteraction,
      }));
    if (activeItems.length === 0) return null;
    return { items: activeItems };
  }, [childThreadSubsetQuery.data, enabled]);
  const childPendingInteractions = useChildThreadPendingAttention(
    childThreadsSection?.items ?? EMPTY_CHILD_THREAD_ITEMS,
  );
  return useMemo((): ThreadPromptChildThreadsSection | null => {
    if (!childThreadsSection) return null;
    const pendingInteractions = childPendingInteractions
      .flatMap((child) =>
        child.interactions.map((interaction) => ({
          childThreadId: child.childThreadId,
          childTitle: child.childTitle,
          href: child.href,
          interaction,
        })),
      )
      .sort(
        (left, right) =>
          right.interaction.createdAt - left.interaction.createdAt,
      );
    return { ...childThreadsSection, pendingInteractions };
  }, [childThreadsSection, childPendingInteractions]);
}

interface UseSentMessageEditingArgs {
  canStartEdit: boolean;
  threadId: string;
  timelineLoading: boolean;
  timelineRows: readonly TimelineRow[];
}

function useSentMessageEditing({
  canStartEdit,
  threadId,
  timelineLoading,
  timelineRows,
}: UseSentMessageEditingArgs) {
  const editMessage = useEditThreadMessage();
  const [sentMessageEditSession, setSentMessageEditSession] =
    useState<SentMessageEditSession | null>(null);
  const [sentMessageEditHostElement, setSentMessageEditHostElement] =
    useState<HTMLDivElement | null>(null);
  const activeSentMessageEditSession =
    sentMessageEditSession?.threadId === threadId
      ? sentMessageEditSession
      : null;
  const canEditSentMessages =
    canStartEdit && sentMessageEditSession === null && !editMessage.isPending;
  const handleEditSentMessage = useCallback<ThreadTimelineEditMessageHandler>(
    (target: ThreadTimelineEditMessageTarget) => {
      if (!canEditSentMessages) {
        return;
      }
      setSentMessageEditHostElement(null);
      setSentMessageEditSession({
        draft: promptInputToDraft(target.input),
        operationId: nanoid(),
        target,
        threadId,
      });
    },
    [canEditSentMessages, threadId],
  );
  const sentMessageEditThreadId = sentMessageEditSession?.threadId ?? null;
  const sentMessageEditTargetMessageId =
    sentMessageEditSession?.target.messageId ?? null;
  const sentMessageEditTargetStillPresent =
    sentMessageEditThreadId === threadId &&
    sentMessageEditTargetMessageId !== null
      ? hasTimelineRowId(timelineRows, sentMessageEditTargetMessageId)
      : true;
  const shouldDiscardMissingSentMessageEdit =
    sentMessageEditThreadId !== null &&
    sentMessageEditThreadId === threadId &&
    !timelineLoading &&
    !sentMessageEditTargetStillPresent;
  useEffect(() => {
    if (!shouldDiscardMissingSentMessageEdit) {
      return;
    }
    setSentMessageEditHostElement(null);
    setSentMessageEditSession(null);
    appToast.warning("The message being edited is no longer available.");
  }, [shouldDiscardMissingSentMessageEdit]);
  const activeSentMessageEditOperationId =
    activeSentMessageEditSession?.operationId ?? null;
  const updateSentMessageEditDraft = useCallback(
    (update: (current: PromptDraftState) => PromptDraftState) => {
      setSentMessageEditSession((current) =>
        current?.operationId === activeSentMessageEditOperationId
          ? { ...current, draft: update(current.draft) }
          : current,
      );
    },
    [activeSentMessageEditOperationId],
  );
  const closeSentMessageEdit = useCallback((operationId: string) => {
    setSentMessageEditSession((current) =>
      current?.operationId === operationId ? null : current,
    );
  }, []);
  const cancelSentMessageEdit = useCallback(() => {
    if (!activeSentMessageEditSession) {
      return;
    }
    closeSentMessageEdit(activeSentMessageEditSession.operationId);
  }, [activeSentMessageEditSession, closeSentMessageEdit]);
  const submitSentMessageEdit = useCallback<
    ThreadDetailSentMessageEdit["onSubmit"]
  >(
    (target) => {
      if (!activeSentMessageEditSession) {
        return;
      }
      const session = activeSentMessageEditSession;
      const execution = target.execution;
      void editMessage
        .mutateAsync({
          id: session.threadId,
          operationId: session.operationId,
          expectedRequestSequence: session.target.expectedRequestSequence,
          input: target.input,
          ...(execution
            ? {
                model: execution.model,
                permissionMode: execution.permissionMode,
                reasoningLevel: execution.reasoningLevel,
                executionInputSources: execution.executionInputSources,
                ...(execution.supportsServiceTier && execution.serviceTier
                  ? { serviceTier: execution.serviceTier }
                  : {}),
              }
            : {}),
        })
        .then(() => {
          closeSentMessageEdit(session.operationId);
        })
        .catch((error) => {
          showMutationErrorToast({
            error,
            fallbackMessage: "Failed to edit the message",
            lifecycleOperation: "edit_message",
          });
        });
    },
    [activeSentMessageEditSession, closeSentMessageEdit, editMessage],
  );
  const activeSentMessageEditTargetMessageId =
    activeSentMessageEditSession?.target.messageId ?? null;
  const inlineMessageEditor = useMemo<
    ThreadTimelineInlineMessageEditor | undefined
  >(
    () =>
      activeSentMessageEditTargetMessageId !== null
        ? {
            messageId: activeSentMessageEditTargetMessageId,
            onHostElementChange: setSentMessageEditHostElement,
          }
        : undefined,
    [activeSentMessageEditTargetMessageId],
  );
  const sentMessageEdit = useMemo<ThreadDetailSentMessageEdit | undefined>(
    () =>
      activeSentMessageEditSession
        ? {
            draft: activeSentMessageEditSession.draft,
            hostElement: sentMessageEditHostElement,
            isSubmitting: editMessage.isPending,
            operationId: activeSentMessageEditSession.operationId,
            onCancel: cancelSentMessageEdit,
            onSubmit: submitSentMessageEdit,
            updateDraft: updateSentMessageEditDraft,
          }
        : undefined,
    [
      activeSentMessageEditSession,
      cancelSentMessageEdit,
      editMessage.isPending,
      sentMessageEditHostElement,
      submitSentMessageEdit,
      updateSentMessageEditDraft,
    ],
  );
  return {
    handleEditSentMessage: canEditSentMessages
      ? handleEditSentMessage
      : undefined,
    inlineMessageEditor,
    sentMessageEdit,
  };
}

function useComposerFocusRequestKey(
  storageKey: string,
  focusRequest: number | undefined,
): string | number {
  const [nonce, setNonce] = useState(0);
  useEffect(
    () =>
      subscribeComposerFocusRequests(storageKey, () =>
        setNonce((current) => current + 1),
      ),
    [storageKey],
  );
  return focusRequest === undefined ? nonce : `${nonce}:${focusRequest}`;
}

export function ThreadScreen({
  composer,
  environment,
  presentation,
  projectId,
  resolveMentionLink,
  thread,
  timeline,
  timelineHost,
  workspaceRootPath,
}: ThreadScreenProps) {
  const systemConfigQuery = useSystemConfig();
  const pendingInteractionsQuery = useThreadPendingInteractions(thread.id);
  const pendingInteractions = pendingInteractionsQuery.data ?? [];
  const hasPendingInteraction = pendingInteractions.length > 0;
  const sendMessage = useSendThreadMessage();
  const parentThreadSection = useParentThreadSection(thread, composer !== null);
  const childThreadsSection = useChildThreadsSection(
    thread.id,
    composer !== null,
  );
  const instanceId = useId();
  const handleAddToChat = useThreadComposerAddToChat(thread);
  const draftStorageKey = useMemo(
    () =>
      getPromptDraftAccessor({
        kind: "thread",
        projectId: thread.projectId,
        threadId: thread.id,
      }).storageKey,
    [thread.id, thread.projectId],
  );
  const composerFocusRequestKey = useComposerFocusRequestKey(
    draftStorageKey,
    composer?.focusRequest,
  );
  const [timelineNavigationTargetRowId, setTimelineNavigationTargetRowId] =
    useState<string | null>(null);
  const { timelineLoading, timelineRows } = timeline;
  const isThreadTimelinePending = timelineLoading && timelineRows.length === 0;

  const { handleEditSentMessage, inlineMessageEditor, sentMessageEdit } =
    useSentMessageEditing({
      canStartEdit:
        composer !== null &&
        thread.canEditMessages &&
        !hasPendingInteraction &&
        !sendMessage.isPending &&
        !isThreadTimelinePending,
      threadId: thread.id,
      timelineLoading,
      timelineRows,
    });

  const isPanelPresentation = presentation.kind !== "page";
  const selectionAddToChat = composer ? handleAddToChat : undefined;
  const surface = (
    <SelectionAddToChatContext.Provider value={selectionAddToChat}>
      <ThreadTimelineSurface
        activeThinking={timeline.activeThinking}
        canSpawnChild={thread.canSpawnChild}
        contextBoundarySeq={timeline.contextBoundarySeq}
        hasOlderTimelineRows={timeline.hasOlderTimelineRows}
        hostConnectionNotice={buildHostConnectionNotice(
          thread,
          timelineHost.environmentHostName,
        )}
        isCatchingUpTimeline={timeline.isCatchingUpTimeline}
        isLoadingOlderTimelineRows={timeline.isLoadingOlderTimelineRows}
        isThreadTimelinePending={isThreadTimelinePending}
        timelineError={Boolean(timeline.timelineError)}
        loadingContent={
          isPanelPresentation ? <ThreadTimelinePanelLoadingSkeleton /> : undefined
        }
        timelineErrorClassName={
          isPanelPresentation ? "mx-2 mt-4 text-destructive" : undefined
        }
        leadingContent={timelineHost.leadingContent}
        consumerMessageActions={timelineHost.consumerMessageActions}
        includePluginMessageActions={timelineHost.includePluginMessageActions}
        onForkMessage={timelineHost.onForkMessage}
        onEditMessage={handleEditSentMessage}
        inlineMessageEditor={inlineMessageEditor}
        onMessageAddToChat={selectionAddToChat}
        onSelectionAddToChat={selectionAddToChat}
        onLoadOlderRows={timeline.loadOlderTimelineRows}
        onOpenLink={timelineHost.onOpenLink}
        onOpenLocalFileLink={timelineHost.onOpenLocalFileLink}
        onTitleAction={timelineHost.onTitleAction}
        projectId={projectId}
        resolveMentionLink={resolveMentionLink}
        showOngoingIndicator={
          thread.status !== "stopping" &&
          !hasPendingInteraction &&
          isRunningThreadRuntimeDisplayStatus(thread.runtime.displayStatus) &&
          !isThreadTimelinePending
        }
        timelineRows={timelineRows}
        timelineNavigationTargetRowId={timelineNavigationTargetRowId}
        isStopping={thread.status === "stopping"}
        stoppingAnchorAt={thread.updatedAt}
        threadId={thread.id}
        threadRuntimeDisplayStatus={thread.runtime.displayStatus}
        unreadDividerAutoScroll={timelineHost.unreadDividerAutoScroll}
        unreadDividerPlacement={timelineHost.unreadDividerPlacement}
        workspaceRootPath={workspaceRootPath}
      />
    </SelectionAddToChatContext.Provider>
  );

  const chrome = composer?.environmentChrome;
  const promptArea = composer ? (
    <ThreadDetailPromptArea
      composerId={
        presentation.kind === "page"
          ? THREAD_DETAIL_COMPOSER_ID
          : `${THREAD_DETAIL_COMPOSER_ID}-${instanceId}`
      }
      isPrimaryComposer={presentation.kind === "page"}
      permissionPolicy={composer.permissionPolicy}
      contextWindowUsage={timeline.contextWindowUsage}
      environmentCheckout={composer.environmentCheckout}
      environmentCompactLabel={chrome?.environmentCompactLabel}
      environmentHost={chrome?.environmentHost}
      environmentIcon={chrome?.environmentIcon}
      environmentLabel={chrome?.environmentLabel}
      environmentMachineProvider={chrome?.environmentMachineProvider}
      environmentProviderName={chrome?.environmentProviderName}
      canRestoreEnvironment={thread.canRestoreEnvironment}
      environmentGoneStatus={resolveEnvironmentGoneStatus(environment)}
      environmentHostId={environment?.hostId}
      onCreateNewThreadInEnvironment={composer.onCreateNewThreadInEnvironment}
      onOpenThreadInfo={composer.onOpenThreadInfo}
      projectId={projectId}
      resolveMentionLink={resolveMentionLink}
      composerFocusRequestKey={composerFocusRequestKey}
      sendMessage={sendMessage}
      sentMessageEdit={sentMessageEdit}
      steerActiveThreadOnEnter={
        systemConfigQuery.data?.generalSettings.steerActiveThreadOnEnter ??
        defaultAppSettings.steerActiveThreadOnEnter
      }
      pendingInteractions={pendingInteractions}
      queuedMessageCount={thread.queuedMessageCount}
      pendingTodos={timeline.pendingTodos}
      activePromptMode={timeline.activePromptMode}
      goal={timeline.goal}
      providerCommands={timeline.providerCommands}
      sessionOptions={timeline.sessionOptions}
      modelFallback={timeline.modelFallback}
      activeWorkflows={timeline.activeWorkflows}
      activeBackgroundCommands={timeline.activeBackgroundCommands}
      parentThreadSection={parentThreadSection}
      childThreadsSection={childThreadsSection}
      contextEnvironmentId={composer.contextEnvironmentId}
      thread={thread}
    />
  ) : null;

  switch (presentation.kind) {
    case "page":
      return (
        <div
          data-thread-window=""
          className="flex h-full min-h-0 min-w-0 flex-col overflow-clip"
        >
          <PageShell
            key={thread.id}
            scrollBehavior="bottom-anchor"
            scrollAnchorThreadId={thread.id}
            shellClassName="!mx-0 !mt-0 md:!mx-0 md:!mt-0"
            scrollAreaClassName="scroll-pt-4"
            contentClassName="gap-2 pt-4"
            footerClassName="chat-prompt-box"
            footer={promptArea}
            scrollOverlay={
              <ThreadTableOfContents
                contextBoundarySeq={timeline.contextBoundarySeq}
                threadId={thread.id}
                timelineRows={timelineRows}
                hasOlderTimelineRows={timeline.hasOlderTimelineRows}
                loadOlderTimelineRows={timeline.loadOlderTimelineRows}
                onNavigateToRow={setTimelineNavigationTargetRowId}
              />
            }
          >
            {surface}
          </PageShell>
        </div>
      );
    case "panel":
      return (
        <ThreadScreenPanelShell
          presentation={presentation}
          promptArea={promptArea}
          surface={surface}
          threadId={thread.id}
        />
      );
    case "transcript":
      return presentation.layout === "contained" ? (
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-2 pb-3 pt-3">
          {surface}
        </div>
      ) : (
        <div className="bg-background px-2 pb-3 pt-3">{surface}</div>
      );
  }
}


function ThreadScreenPanelShell({
  presentation,
  promptArea,
  surface,
  threadId,
}: {
  presentation: Extract<ThreadScreenPresentation, { kind: "panel" }>;
  promptArea: ReactNode;
  surface: ReactNode;
  threadId: string;
}) {
  const { layout, measure, tone } = presentation;
  const surfaceClassName = tone === "sidebar" ? "bg-sidebar" : "bg-background";
  const maxWidthClassName = measure === "page" ? "max-w-[760px]" : "max-w-none";
  const footer = (
    <div className={cn("relative", surfaceClassName)}>
      <OverflowFade placement="above" tone={tone} />
      <div className="px-4 pb-4 pt-2">{promptArea}</div>
    </div>
  );
  if (layout === "document") {
    return (
      <div
        key={threadId}
        data-thread-window=""
        data-surface-tone={tone}
        className={cn("flex min-w-0 flex-col", surfaceClassName)}
      >
        <div
          className={cn(
            "mx-auto flex w-full min-w-0 flex-col",
            measure === "page" ? "px-4 pb-3 pt-3" : "px-2 pb-3 pt-3",
            maxWidthClassName,
          )}
        >
          {surface}
        </div>
        <div className="sticky bottom-0 z-20">{footer}</div>
      </div>
    );
  }
  return (
    <div
      data-thread-window=""
      data-surface-tone={tone}
      className="flex min-h-0 flex-1 flex-col"
    >
      <BottomAnchoredScrollBody
        key={threadId}
        scrollAreaClassName={cn(surfaceClassName, "scroll-pt-4")}
        contentClassName={
          measure === "page" ? "!pb-3 !pt-4" : "!px-2 !pb-3 !pt-4"
        }
        maxWidthClassName={maxWidthClassName}
        footer={footer}
        scrollAnchorThreadId={threadId}
      >
        {surface}
      </BottomAnchoredScrollBody>
    </div>
  );
}
