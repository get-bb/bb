import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Environment,
  PromptTextMention,
  ThreadQueuedMessage,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type { Thread } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  type AttachmentsConfig,
  type HistoryConfig,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import {
  FollowUpPromptBox,
  type FollowUpComposerProps,
} from "@/components/promptbox/FollowUpPromptBox";
import {
  QueuedMessagesList,
  type QueuedMessageProcessingAction,
} from "@/components/promptbox/banner/QueuedMessagesList";
import type {
  ExecutionControlsProps,
  ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { HeightTransition } from "@/components/ui/height-transition.js";
import { Icon } from "@/components/ui/icon.js";
import {
  messageBodyHasQuote,
  renderMessageBodyWithQuotes,
} from "@/components/thread/timeline/ConversationMessageMentions";
import { Skeleton } from "@/components/ui/skeleton.js";
import {
  isRunningThreadRuntimeDisplayStatus,
  TimelineStatusIndicator,
  TimelineWorkingIndicator,
  ThreadTimelineRows,
  type ThreadTimelineSendToMainMessageHandler,
} from "@/components/thread/timeline";
import { usePreferredTheme } from "@/hooks/useTheme";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import {
  useThread,
  useThreadDefaultExecutionOptions,
  useThreadQueuedMessages,
  useThreadTimeline,
} from "@/hooks/queries/thread-queries";
import {
  useCreateThreadQueuedMessage,
  useCreateThread,
  useDeleteThreadQueuedMessage,
  useReorderThreadQueuedMessage,
  useSendThreadQueuedMessage,
  useSendThreadMessage,
} from "@/hooks/mutations/thread-runtime-mutations";
import { useDeleteThread } from "@/hooks/mutations/thread-state-mutations";
import {
  SIDE_CHAT_PERMISSION_MODE,
  buildSideChatMessageInput,
  buildSideChatPreloadRequest,
  resolveSideChatReplyReference,
} from "@/lib/side-chat-create-request";
import { HttpError } from "@/lib/api";
import type { SideChatFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type { QueuedMessageReorderRequest } from "@/lib/queued-message-reorder";
import { appToast } from "@/components/ui/app-toast";
import { queuedInputToDraft } from "@/views/thread-detail/threadQueuedMessages";

const noop = () => {};

// Side chats are conversation-only in v1 (no @-mentions / file reach, no command
// typeahead), so the composer is wired with an inert typeahead config rather
// than the thread mention-search stack. Keeping it explicit (not dead config)
// documents the intentional v1 scope.
const SIDE_CHAT_TYPEAHEAD: TypeaheadConfig = {
  mention: {
    suggestions: [],
    isLoading: false,
    isError: false,
    onQueryChange: noop,
  },
  command: INERT_TYPEAHEAD_COMMAND_CONFIG,
};

// Side chats are conversation-only: no @-mentions, no file attachments. The
// composer requires an attachments config, so wire an inert one (no items, no
// upload affordance) — mirroring SIDE_CHAT_TYPEAHEAD's intentional v1 scope.
const SIDE_CHAT_ATTACHMENTS: AttachmentsConfig = {
  items: [],
  isAttaching: false,
  error: null,
};

const SIDE_CHAT_READY_SUBMIT_MODE = {
  kind: "ready",
} satisfies FollowUpComposerProps["submitMode"];

export interface SetSideChatThreadId {
  (args: { tabId: string; threadId: string }): void;
}

export interface SideChatTabContentProps {
  tab: SideChatFixedPanelTab;
  /** The main thread the side chat is anchored to (lineage + provider source). */
  sourceThread: Thread;
  /**
   * The main thread's environment (host + branch), or null when not yet loaded
   * / for a personal-project source. Resolves the side chat's own workspace.
   */
  sourceEnvironment: Environment | null;
  /**
   * The main thread's timeline rows. Used to resolve the anchored-message reply
   * reference (whether the anchor is the parent's last conversation message).
   */
  sourceTimelineRows: readonly TimelineRow[];
  onSetThreadId: SetSideChatThreadId;
}

interface SideChatConversationProps {
  isSideChatTurnSubmitting: boolean;
  threadId: string;
  /**
   * Hand a side-chat agent message back to the main thread (the per-message
   * "send to main" action). Undefined while the side chat is mid-turn, which
   * keeps the action out of the bar until the reply is final.
   */
  onSendToMainMessage: ThreadTimelineSendToMainMessageHandler | undefined;
}

function timelineRowsContainUserMessage(rows: readonly TimelineRow[]): boolean {
  const visit = (row: TimelineRow): boolean => {
    if (row.kind === "conversation") {
      return row.role === "user";
    }
    return row.kind === "turn" && row.children !== null
      ? row.children.some(visit)
      : false;
  };
  return rows.some(visit);
}

function shouldQueueSideChatMessage(
  displayStatus: ThreadRuntimeDisplayStatus,
): boolean {
  return (
    displayStatus === "active" ||
    displayStatus === "host-reconnecting" ||
    displayStatus === "provisioning" ||
    displayStatus === "starting" ||
    displayStatus === "waiting-for-host"
  );
}

/**
 * The created side chat's own conversation. Reuses the canonical
 * `ThreadTimelineRows` renderer (no fork/side-chat actions — a side chat does
 * not spawn further children in v1); each agent reply gets a "send to main
 * thread" action via `onSendToMainMessage`. Live updates flow through the global
 * thread realtime subscription into the timeline query cache.
 */
function SideChatConversation({
  isSideChatTurnSubmitting,
  threadId,
  onSendToMainMessage,
}: SideChatConversationProps) {
  const preferredTheme = usePreferredTheme();
  const threadQuery = useThread(threadId);
  const timelineQuery = useThreadTimeline(threadId);
  // Hide the worktree-provisioning transcript from the side-chat timeline — it's
  // setup noise in a focused reply view. The main thread still shows it.
  const rows = (timelineQuery.data?.rows ?? []).filter(
    (row) =>
      !(
        row.kind === "system" &&
        row.systemKind === "operation" &&
        row.operationKind === "thread-provisioning"
      ),
  );
  const activeThinking = timelineQuery.data?.activeThinking ?? null;
  const displayStatus = threadQuery.data?.runtime.displayStatus ?? "idle";
  const isProvisioningDisplayStatus =
    displayStatus === "provisioning" || displayStatus === "starting";
  const ongoingIndicatorLabel =
    displayStatus === "host-reconnecting"
      ? "Waiting for reconnection"
      : isProvisioningDisplayStatus
        ? "Provisioning side chat..."
        : undefined;
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
  const showOngoingIndicator =
    threadQuery.data?.status !== "stopping" &&
    (isProvisioningDisplayStatus ||
      (!timelineQuery.isPending &&
        (isSideChatTurnSubmitting ||
          isRunningThreadRuntimeDisplayStatus(displayStatus))));
  const displayedRows = rows;

  // A persisted side-chat tab can outlive its child thread (the thread was
  // deleted). The thread query then 404s — show an explicit terminal empty
  // state instead of the indefinite "Waiting…" placeholder below.
  const isChildThreadMissing =
    threadQuery.error instanceof HttpError && threadQuery.error.status === 404;
  if (isChildThreadMissing) {
    return (
      <EmptyStatePanel className="mx-2 rounded-lg">
        This side chat is no longer available.
      </EmptyStatePanel>
    );
  }

  if (
    timelineQuery.isPending &&
    displayedRows.length === 0 &&
    !showOngoingIndicator
  ) {
    return (
      <div className="space-y-2 px-2 pt-2">
        <Skeleton className="h-4 w-3/4 rounded-sm" />
        <Skeleton className="h-4 w-2/3 rounded-sm" />
        <Skeleton className="h-4 w-1/2 rounded-sm" />
      </div>
    );
  }

  if (timelineQuery.isError && displayedRows.length === 0) {
    return (
      <TimelineStatusIndicator
        label="Failed to load side chat"
        className="mx-2 mt-4 text-destructive"
      />
    );
  }

  if (displayedRows.length === 0 && !showOngoingIndicator) {
    return (
      <EmptyStatePanel className="mx-2 rounded-lg">
        Waiting for the side chat to respond…
      </EmptyStatePanel>
    );
  }

  return (
    <>
      {displayedRows.length > 0 ? (
        <ThreadTimelineRows
          themeType={preferredTheme}
          timelineRows={[...displayedRows]}
          threadId={threadId}
          threadRuntimeDisplayStatus={displayStatus}
          onSendToMainMessage={onSendToMainMessage}
          workspaceRootPath={undefined}
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
    </>
  );
}

/**
 * Hosts a message-anchored side chat: the child thread's conversation above the
 * shared `FollowUpPromptBox` composer (the same component the main thread uses)
 * with its footer in read-only mode — the side chat inherits the parent's
 * provider/model and is always read-only. The child thread is provisioned as
 * soon as the tab has enough source context (`tab.threadId === null`), so the
 * user's first submit is a normal follow-up turn. Once a thread exists, each
 * side-chat agent reply carries a
 * per-message "send to main thread" action that posts that reply into the main
 * thread (rendered there as "Message from {side chat}") via the existing
 * cross-thread send transport (`senderThreadId`).
 */
export function SideChatTabContent({
  tab,
  sourceThread,
  sourceEnvironment,
  sourceTimelineRows,
  onSetThreadId,
}: SideChatTabContentProps) {
  const childThreadId = tab.threadId;
  const createThread = useCreateThread();
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const deleteQueuedMessage = useDeleteThreadQueuedMessage();
  const deleteThread = useDeleteThread();
  const reorderQueuedMessage = useReorderThreadQueuedMessage();
  const sendQueuedMessage = useSendThreadQueuedMessage();
  const sendThreadMessage = useSendThreadMessage();
  const { isLocalDaemonHost } = useHostDaemon();
  const executionOptionsQuery = useThreadDefaultExecutionOptions(
    sourceThread.id,
  );
  const childThreadQuery = useThread(childThreadId ?? "", {
    enabled: childThreadId !== null,
  });
  // Build the SAME execution + permission configs the main thread builds (see
  // ThreadDetailPromptArea), seeded from the parent thread's resolved options
  // and its environment's provider/model catalog. The side chat renders these
  // through the identical pickers, just disabled (read-only) — so the model and
  // permission labels match the main thread exactly. Permission is pinned to
  // "readonly": a side chat never writes to the workspace.
  const defaultExecutionOptions = executionOptionsQuery.data;
  const threadCreationOptions = useThreadCreationOptions({
    scope: "component-local",
    environmentId: sourceThread.environmentId ?? undefined,
    resetKey: sourceThread.id,
    initialProviderId: sourceThread.providerId,
    initialModel: defaultExecutionOptions?.model,
    initialServiceTier: defaultExecutionOptions?.serviceTier,
    initialReasoningLevel: defaultExecutionOptions?.reasoningLevel,
    initialPermissionMode: "readonly",
  });
  // `tab.threadId` only flips after async create resolves and panel state
  // propagates. Keep the in-flight create promise here so proactive preload and
  // an immediate Enter key share one side-chat thread.
  const createThreadPromiseRef = useRef<Promise<string | null> | null>(null);
  const childThreadIdRef = useRef<string | null>(childThreadId);
  const childHasUserMessageRef = useRef(false);
  const deleteThreadMutateRef = useRef(deleteThread.mutate);
  const hasAcceptedUserMessageRef = useRef(false);
  const isMountedRef = useRef(false);
  const pendingSubmitCountRef = useRef(0);
  const queuedMessageCountRef = useRef(0);

  const [message, setMessage] = useState("");
  const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>([]);
  const [isSideChatTurnSubmitting, setIsSideChatTurnSubmitting] =
    useState(false);
  const [sideChatPreloadFailed, setSideChatPreloadFailed] = useState(false);
  const [processingQueuedMessage, setProcessingQueuedMessage] = useState<{
    action: QueuedMessageProcessingAction;
    id: string;
  } | null>(null);
  const handleChangeMessage = useCallback(
    (nextValue: string, nextMentions: PromptTextMention[]) => {
      setMessage(nextValue);
      setMentionRanges(nextMentions);
    },
    [],
  );

  // The anchored-message reply reference: present only when the anchor is NOT
  // the parent's last conversation message (the most recent exchange needs no
  // explicit pointer). When present it both renders as a "Replying to" quote
  // above the conversation and is carried into the first turn as agent-only
  // context. Captured at the parent's current timeline because the side-chat
  // anchor is fixed at open time.
  // What the agent receives as explicit context on the first turn: the anchor
  // text, omitted when it is already the parent's last message (it lives in the
  // forked history). Display is decoupled below — the "Replying to" bubble
  // always shows the trigger message regardless of this optimization.
  const replyReference = useMemo(
    () =>
      resolveSideChatReplyReference({
        anchorMessageText: tab.sourceMessageText,
        sourceTimelineRows,
      }),
    [sourceTimelineRows, tab.sourceMessageText],
  );
  // The agent message this side chat was triggered from. Empty for side chats
  // opened from the new-tab page (those fork from the thread tip).
  const triggerMessageText = tab.sourceMessageText.trim();
  const hasTriggerMessage = triggerMessageText.length > 0;

  const sourceEnvironmentReady =
    sourceThread.environmentId === null || sourceEnvironment !== null;
  const canCreateSideChatThread =
    childThreadId === null &&
    defaultExecutionOptions !== undefined &&
    sourceEnvironmentReady;
  const sideChatExecutionRequestFields = useMemo(
    () => ({
      ...(defaultExecutionOptions
        ? {
            model: defaultExecutionOptions.model,
            reasoningLevel: defaultExecutionOptions.reasoningLevel,
            ...(defaultExecutionOptions.serviceTier
              ? { serviceTier: defaultExecutionOptions.serviceTier }
              : {}),
          }
        : {}),
      permissionMode: SIDE_CHAT_PERMISSION_MODE,
    }),
    [defaultExecutionOptions],
  );
  const childTimelineQuery = useThreadTimeline(childThreadId ?? "", {
    enabled: childThreadId !== null,
  });
  const { data: queuedMessages = [] } = useThreadQueuedMessages(
    childThreadId ?? "",
    {
      enabled: childThreadId !== null,
    },
  );
  const childHasUserMessage = useMemo(
    () => timelineRowsContainUserMessage(childTimelineQuery.data?.rows ?? []),
    [childTimelineQuery.data?.rows],
  );
  const queuedMessagesById = useMemo(() => {
    const next = new Map<string, ThreadQueuedMessage>();
    for (const queuedMessage of queuedMessages) {
      next.set(queuedMessage.id, queuedMessage);
    }
    return next;
  }, [queuedMessages]);

  childThreadIdRef.current = childThreadId;
  childHasUserMessageRef.current = childHasUserMessage;
  deleteThreadMutateRef.current = deleteThread.mutate;
  queuedMessageCountRef.current = queuedMessages.length;

  const deleteSideChatIfUnused = useCallback((threadId: string | null) => {
    if (
      threadId === null ||
      hasAcceptedUserMessageRef.current ||
      pendingSubmitCountRef.current > 0 ||
      childHasUserMessageRef.current ||
      queuedMessageCountRef.current > 0
    ) {
      return;
    }
    deleteThreadMutateRef.current({
      id: threadId,
      childThreadsConfirmed: true,
    });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      deleteSideChatIfUnused(childThreadIdRef.current);
    };
  }, [deleteSideChatIfUnused]);

  const ensureSideChatThread = useCallback(async (): Promise<string | null> => {
    const existingThreadId = childThreadIdRef.current;
    if (existingThreadId !== null) {
      return existingThreadId;
    }
    if (createThreadPromiseRef.current !== null) {
      return createThreadPromiseRef.current;
    }
    const executionOptions = defaultExecutionOptions;
    if (!canCreateSideChatThread || !executionOptions) {
      return null;
    }
    const request = buildSideChatPreloadRequest({
      projectId: sourceThread.projectId,
      sourceThreadId: sourceThread.id,
      sourceEnvironment,
      providerId: sourceThread.providerId,
      model: executionOptions.model,
      reasoningLevel: executionOptions.reasoningLevel,
      serviceTier: executionOptions.serviceTier,
      title: tab.title,
    });
    const promise = createThread
      .mutateAsync(request)
      .then((thread) => {
        childThreadIdRef.current = thread.id;
        if (isMountedRef.current) {
          setSideChatPreloadFailed(false);
          onSetThreadId({ tabId: tab.id, threadId: thread.id });
        } else {
          deleteSideChatIfUnused(thread.id);
        }
        return thread.id;
      })
      .catch((error) => {
        if (isMountedRef.current) {
          setSideChatPreloadFailed(true);
        }
        throw error;
      })
      .finally(() => {
        createThreadPromiseRef.current = null;
      });
    createThreadPromiseRef.current = promise;
    return promise;
  }, [
    canCreateSideChatThread,
    createThread,
    defaultExecutionOptions,
    deleteSideChatIfUnused,
    onSetThreadId,
    sourceEnvironment,
    sourceThread.id,
    sourceThread.projectId,
    sourceThread.providerId,
    tab.id,
    tab.title,
  ]);

  useEffect(() => {
    if (childThreadId !== null || sideChatPreloadFailed) {
      return;
    }
    void ensureSideChatThread().catch(() => undefined);
  }, [childThreadId, ensureSideChatThread, sideChatPreloadFailed]);

  const sendOrQueueSideChatText = useCallback(
    async (text: string) => {
      const targetThreadId = await ensureSideChatThread();
      if (targetThreadId === null) {
        throw new Error("Side chat is not ready to create yet.");
      }
      const input = buildSideChatMessageInput({
        includeReplyReference:
          !childHasUserMessageRef.current &&
          queuedMessageCountRef.current === 0,
        question: text,
        replyReference,
      });
      const displayStatus =
        childThreadIdRef.current === targetThreadId
          ? (childThreadQuery.data?.runtime.displayStatus ?? "provisioning")
          : "provisioning";
      if (shouldQueueSideChatMessage(displayStatus)) {
        await createQueuedMessage.mutateAsync({
          id: targetThreadId,
          input,
          ...sideChatExecutionRequestFields,
        });
      } else {
        await sendThreadMessage.mutateAsync({
          id: targetThreadId,
          input,
          mode: "queue-if-active",
          ...sideChatExecutionRequestFields,
        });
      }
      hasAcceptedUserMessageRef.current = true;
    },
    [
      childThreadQuery.data?.runtime.displayStatus,
      createQueuedMessage,
      ensureSideChatThread,
      replyReference,
      sendThreadMessage,
      sideChatExecutionRequestFields,
    ],
  );

  // A side chat hands results back to the main thread per agent message (the
  // "send to main thread" action under each reply) via the cross-thread
  // `senderThreadId` transport. Gate on idle so a mid-stream partial can't be
  // posted while a turn is in flight, and on the mutation so a click can't
  // double-send.
  const childIsIdle = childThreadQuery.data?.runtime.displayStatus === "idle";
  const canSendToMain = childIsIdle && !sendThreadMessage.isPending;
  const sendMessageToMain = useCallback<ThreadTimelineSendToMainMessageHandler>(
    (target) => {
      if (childThreadId === null) {
        return;
      }
      sendThreadMessage.mutate({
        id: sourceThread.id,
        input: [{ type: "text", text: target.messageText, mentions: [] }],
        mode: "auto",
        senderThreadId: childThreadId,
      });
    },
    [childThreadId, sendThreadMessage, sourceThread.id],
  );

  const sideChatRuntimeDisplayStatus =
    childThreadQuery.data?.runtime.displayStatus ??
    (childThreadId === null ? "provisioning" : "idle");
  const isSideChatProvisioning =
    childThreadId === null ||
    sideChatRuntimeDisplayStatus === "provisioning" ||
    sideChatRuntimeDisplayStatus === "starting";
  const sideChatSubmitMode = SIDE_CHAT_READY_SUBMIT_MODE;
  const composerPlaceholder = sideChatPreloadFailed
    ? "Retry side chat..."
    : isSideChatProvisioning
      ? "Provisioning side chat..."
      : "Reply in the side chat…";
  const handleSubmit = useCallback(() => {
    const trimmed = message.trim();
    if (trimmed.length === 0 || isSideChatTurnSubmitting) {
      return;
    }
    const submittedMessage = message;
    const submittedMentionRanges = mentionRanges;
    setMessage("");
    setMentionRanges([]);
    setIsSideChatTurnSubmitting(true);
    pendingSubmitCountRef.current += 1;
    void sendOrQueueSideChatText(trimmed)
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }
        setMessage((current) =>
          current.length === 0 ? submittedMessage : current,
        );
        setMentionRanges((current) =>
          current.length === 0 ? submittedMentionRanges : current,
        );
        appToast.error(
          getMutationErrorMessage({
            error,
            fallbackMessage: "Failed to send side chat message",
            lifecycleOperation: shouldQueueSideChatMessage(
              sideChatRuntimeDisplayStatus,
            )
              ? "queue_message"
              : "send_message",
          }),
        );
      })
      .finally(() => {
        pendingSubmitCountRef.current = Math.max(
          0,
          pendingSubmitCountRef.current - 1,
        );
        if (isMountedRef.current) {
          setIsSideChatTurnSubmitting(false);
        } else {
          deleteSideChatIfUnused(childThreadIdRef.current);
        }
      });
  }, [
    deleteSideChatIfUnused,
    isSideChatTurnSubmitting,
    mentionRanges,
    message,
    sendOrQueueSideChatText,
    sideChatRuntimeDisplayStatus,
  ]);

  const queuedMessageActionPending =
    deleteQueuedMessage.isPending ||
    reorderQueuedMessage.isPending ||
    sendQueuedMessage.isPending;

  const handleSendQueuedImmediately = useCallback(
    (queuedMessageId: string) => {
      if (childThreadId === null || isSideChatProvisioning) {
        return;
      }
      setProcessingQueuedMessage({ id: queuedMessageId, action: "send" });
      void sendQueuedMessage
        .mutateAsync({
          id: childThreadId,
          mode: "auto",
          queuedMessageId,
        })
        .catch((error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to send queued message",
              lifecycleOperation: "send_queued_message",
            }),
          );
        })
        .finally(() => {
          setProcessingQueuedMessage((current) =>
            current?.id === queuedMessageId ? null : current,
          );
        });
    },
    [childThreadId, isSideChatProvisioning, sendQueuedMessage],
  );

  const handleEditQueuedMessage = useCallback(
    (queuedMessageId: string) => {
      if (childThreadId === null) {
        return;
      }
      const queuedMessage = queuedMessagesById.get(queuedMessageId);
      if (!queuedMessage) {
        return;
      }
      setProcessingQueuedMessage({ id: queuedMessageId, action: "edit" });
      void deleteQueuedMessage
        .mutateAsync({
          id: childThreadId,
          queuedMessageId,
        })
        .then(() => {
          const restoredDraft = queuedInputToDraft(queuedMessage.content);
          setMessage(restoredDraft.text);
          setMentionRanges(restoredDraft.mentions);
        })
        .catch((error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to edit queued message",
              lifecycleOperation: "queue_message",
            }),
          );
        })
        .finally(() => {
          setProcessingQueuedMessage((current) =>
            current?.id === queuedMessageId ? null : current,
          );
        });
    },
    [childThreadId, deleteQueuedMessage, queuedMessagesById],
  );

  const handleDeleteQueuedMessage = useCallback(
    (queuedMessageId: string) => {
      if (childThreadId === null) {
        return;
      }
      setProcessingQueuedMessage({ id: queuedMessageId, action: "delete" });
      void deleteQueuedMessage
        .mutateAsync({
          id: childThreadId,
          queuedMessageId,
        })
        .catch((error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to delete queued message",
              lifecycleOperation: "queue_message",
            }),
          );
        })
        .finally(() => {
          setProcessingQueuedMessage((current) =>
            current?.id === queuedMessageId ? null : current,
          );
        });
    },
    [childThreadId, deleteQueuedMessage],
  );

  const handleReorderQueuedMessage = useCallback(
    (request: QueuedMessageReorderRequest) => {
      if (childThreadId === null) {
        return;
      }
      void reorderQueuedMessage
        .mutateAsync({
          ...request,
          id: childThreadId,
        })
        .catch((error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to reorder queued message",
              lifecycleOperation: "reorder_queued_message",
            }),
          );
        });
    },
    [childThreadId, reorderQueuedMessage],
  );

  const queuedMessagesStack = useMemo(
    () =>
      queuedMessages.length > 0 ? (
        <QueuedMessagesList
          queuedMessages={queuedMessages}
          sendDisabled={
            childThreadId === null ||
            isSideChatProvisioning ||
            queuedMessageActionPending
          }
          actionDisabled={queuedMessageActionPending}
          processingMessageId={processingQueuedMessage?.id ?? null}
          processingAction={processingQueuedMessage?.action ?? null}
          onSendImmediately={handleSendQueuedImmediately}
          onReorder={handleReorderQueuedMessage}
          onEdit={handleEditQueuedMessage}
          onDelete={handleDeleteQueuedMessage}
        />
      ) : null,
    [
      childThreadId,
      handleDeleteQueuedMessage,
      handleEditQueuedMessage,
      handleReorderQueuedMessage,
      handleSendQueuedImmediately,
      isSideChatProvisioning,
      processingQueuedMessage?.action,
      processingQueuedMessage?.id,
      queuedMessageActionPending,
      queuedMessages,
    ],
  );

  const composerConfig = useMemo<FollowUpComposerProps>(
    () => ({
      // Side chats have no prompt-history surface in v1. A draft-only history
      // config (current draft, no entries, no-op select) satisfies the required
      // shape without inventing a feature the composer never exercises.
      history: {
        currentDraft: {
          text: message,
          mentions: mentionRanges,
          attachments: [],
        },
        entries: [],
        onSelectEntry: noop,
      } satisfies HistoryConfig,
      isFollowUpSubmitting: isSideChatTurnSubmitting,
      message,
      mentionRanges,
      onChangeMessage: handleChangeMessage,
      onModifierSubmit: noop,
      onSubmit: handleSubmit,
      promptPlaceholder: composerPlaceholder,
      canModifierSubmit: false,
      submitMode: sideChatSubmitMode,
      threadRuntimeDisplayStatus: sideChatRuntimeDisplayStatus,
    }),
    [
      composerPlaceholder,
      handleChangeMessage,
      handleSubmit,
      isSideChatTurnSubmitting,
      mentionRanges,
      message,
      sideChatRuntimeDisplayStatus,
      sideChatSubmitMode,
    ],
  );

  // Built the same shape as the main thread's executionConfig (see
  // ThreadDetailPromptArea), but the side chat is read-only: the footer pickers
  // render disabled via the FollowUpPromptBox `readOnly` flag, so the controls
  // are display-only and their `onChange` is a no-op. The hook supplies the
  // inherited display values (provider / model / reasoning / permission options).
  const {
    selectedProviderId,
    providerOptions,
    hasMultipleProviders,
    selectedProviderDisplayName,
    selectedModel,
    serviceTier,
    reasoningLevel,
    activeModel,
    modelOptions,
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
    isLoadingModels,
  } = threadCreationOptions;

  const executionConfig = useMemo<ExecutionControlsProps>(
    () => ({
      provider: {
        options: providerOptions,
        selectedId: selectedProviderId,
        hasMultiple: hasMultipleProviders,
        displayName: selectedProviderDisplayName,
      },
      model: {
        active: activeModel,
        selected: selectedModel,
        options: modelOptions,
        loadError: modelLoadError,
        isLoading: isLoadingModels,
        loadFailed: modelLoadError !== null,
        onChange: noop,
      },
      serviceTier: {
        value: serviceTier,
        onChange: noop,
        supported: supportsServiceTier,
        supportByProvider: serviceTierSupportByProvider,
      },
      reasoning: {
        value: reasoningLevel,
        options: reasoningOptions,
        onChange: noop,
      },
    }),
    [
      activeModel,
      hasMultipleProviders,
      isLoadingModels,
      modelLoadError,
      modelOptions,
      providerOptions,
      reasoningLevel,
      reasoningOptions,
      selectedModel,
      selectedProviderDisplayName,
      selectedProviderId,
      serviceTier,
      serviceTierSupportByProvider,
      supportsServiceTier,
    ],
  );

  const permissionConfig = useMemo<ExecutionPermissionConfig>(
    () => ({
      // Pinned to the same constant the create request uses, so the displayed
      // label can't drift from the side chat's actual (always read-only) reach.
      value: SIDE_CHAT_PERMISSION_MODE,
      options: permissionModeOptions,
      onChange: noop,
      supported: supportsPermissionModeSelection,
    }),
    [permissionModeOptions, supportsPermissionModeSelection],
  );

  const environmentSummary = useMemo(() => {
    if (sourceEnvironment === null) {
      // Personal-project side chats inherit the parent's local workspace with no
      // discrete environment row; the main thread renders "Working locally".
      return (
        <ThreadEnvironmentSummary
          environmentLabel="Working locally"
          environmentCompactLabel="Local"
        />
      );
    }
    const host: EnvironmentDisplayHostContext = {
      locality: isLocalDaemonHost(sourceEnvironment.hostId)
        ? "local"
        : "remote",
    };
    const display = formatEnvironmentDisplay({
      environment: sourceEnvironment,
      host,
    });
    return (
      <ThreadEnvironmentSummary
        environmentLabel={display.modeLabel}
        environmentCompactLabel={display.compactModeLabel}
        environmentIcon={getEnvironmentWorkspaceLabelIconName(
          display.workspaceDisplayKind,
        )}
        environmentCheckout={
          sourceEnvironment.branchName
            ? formatWorkspaceCheckoutDisplay({
                checkout: {
                  kind: "branch",
                  branchName: sourceEnvironment.branchName,
                  headSha: null,
                },
              })
            : undefined
        }
      />
    );
  }, [isLocalDaemonHost, sourceEnvironment]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3">
        {hasTriggerMessage ? (
          // The agent message this side chat replies to, rendered like a steer
          // message — a "Replying to" header above a left-aligned bubble — so
          // it's clear which message is in focus and the styling matches the
          // main timeline.
          <div className="mx-1 mb-3 flex flex-col items-start gap-1">
            <span className="text-xs leading-none text-muted-foreground">
              <Icon
                name="CornerDownRight"
                className="mr-1 inline-block size-3 align-middle"
              />
              Replying to
            </span>
            <div className="max-w-full rounded-md bg-surface-recessed p-2 text-sm leading-relaxed text-foreground">
              {messageBodyHasQuote(triggerMessageText) ? (
                <div className="max-h-32 overflow-hidden break-words">
                  {renderMessageBodyWithQuotes({
                    mentions: [],
                    text: triggerMessageText,
                  })}
                </div>
              ) : (
                <p className="line-clamp-3 whitespace-pre-wrap break-words">
                  {triggerMessageText}
                </p>
              )}
            </div>
          </div>
        ) : null}
        {childThreadId !== null ? (
          <SideChatConversation
            isSideChatTurnSubmitting={isSideChatTurnSubmitting}
            threadId={childThreadId}
            onSendToMainMessage={canSendToMain ? sendMessageToMain : undefined}
          />
        ) : sideChatPreloadFailed ? (
          <TimelineStatusIndicator
            label="Failed to provision side chat"
            className="mx-2 mt-4 text-destructive"
          />
        ) : (
          <div className="px-1">
            <TimelineWorkingIndicator label="Provisioning side chat..." />
          </div>
        )}
      </div>
      <div className="px-4 pb-4 pt-2">
        <FollowUpPromptBox
          attachments={SIDE_CHAT_ATTACHMENTS}
          stack={queuedMessagesStack}
          composer={composerConfig}
          environmentSummary={environmentSummary}
          contextWindowUsage={null}
          execution={executionConfig}
          permission={permissionConfig}
          readOnly
          typeahead={SIDE_CHAT_TYPEAHEAD}
          zenModeResetKey={childThreadId ?? tab.id}
        />
      </div>
    </div>
  );
}
