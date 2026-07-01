import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Environment,
  PromptInput,
  PromptTextMention,
  ThreadQueuedMessage,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type { Thread } from "@bb/domain";
import type {
  TimelineConversationAttachments,
  TimelineRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import {
  type AttachmentsConfig,
  type HistoryConfig,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import {
  FollowUpPromptBox,
  type FollowUpComposerProps,
} from "@/components/promptbox/FollowUpPromptBox";
import { withLoopPromptAction } from "@/components/promptbox/PromptBoxActionsMenu";
import {
  QueuedMessagesList,
  type QueuedMessageGroupBoundaryRequest,
  type QueuedMessageProcessingAction,
} from "@/components/promptbox/banner/QueuedMessagesList";
import type {
  ExecutionControlsProps,
  ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import { buildProviderPromptActionProps } from "@/components/promptbox/mentions/command-trigger";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { useCommandSuggestions } from "@/hooks/useCommandSuggestions";
import { usePromptMentions } from "@/hooks/usePromptMentions";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { promptDraftToInput } from "@/lib/prompt-draft";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { Icon } from "@/components/ui/icon.js";
import {
  messageBodyHasQuote,
  renderMessageBodyWithQuotes,
} from "@/components/thread/timeline/ConversationMessageMentions";
import { OverflowFade } from "@/components/ui/overflow-fade";
import {
  isRunningThreadRuntimeDisplayStatus,
  ThreadTimelinePanelContent,
  ThreadTimelineSurface,
  useThreadTimelineController,
  type ThreadTimelineRowFilter,
  type ThreadTimelineSendToMainMessageHandler,
  type ThreadTimelineSelectionAddToChatHandler,
  type UseThreadTimelineControllerResult,
} from "@/components/thread/timeline";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import {
  useThread,
  useThreadQueuedMessages,
} from "@/hooks/queries/thread-queries";
import { useThreadDefaultExecutionOptions } from "@/hooks/queries/thread-default-execution-options-query";
import {
  useCreateThreadQueuedMessage,
  useCreateThread,
  useDeleteThreadQueuedMessage,
  useReorderThreadQueuedMessage,
  useSendThreadQueuedMessage,
  useSendThreadMessage,
  useSetThreadQueuedMessageGroupBoundary,
  useStopThread,
} from "@/hooks/mutations/thread-runtime-mutations";
import { useMarkThreadRead } from "@/hooks/mutations/thread-state-mutations";
import { useThreadReadTracking } from "@/hooks/useThreadReadTracking";
import {
  SIDE_CHAT_PERMISSION_MODE,
  buildSideChatCreateRequest,
  buildSideChatMessageInput,
  resolveSideChatReplyReference,
} from "@/lib/side-chat-create-request";
import type { SideChatFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type { QueuedMessageReorderRequest } from "@/lib/queued-message-reorder";
import { appToast } from "@/components/ui/app-toast";
import { queuedInputToDraft } from "@/views/thread-detail/threadQueuedMessages";
import {
  buildSideChatSubmitMode,
  canSubmitFollowUpShortcut,
} from "@/views/thread-detail/threadDetailPromptSubmission";

const noop = () => {};

export interface SetSideChatThreadId {
  (args: { tabId: string; threadId: string }): void;
}

export interface SideChatTabContentProps {
  /** Only the active side-chat tab is visible; inactive tabs stay mounted. */
  isActive: boolean;
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
  resolveMentionLink: PromptMentionLinkResolver;
  onSetThreadId: SetSideChatThreadId;
}

interface SideChatConversationProps {
  isSideChatTurnSubmitting: boolean;
  leadingContent: ReactNode;
  timeline: UseThreadTimelineControllerResult;
  threadId: string;
  /**
   * Hand a side-chat agent message back to the main thread (the per-message
   * "send to main" action). Undefined only when there is no main-thread target.
   */
  onSendToMainMessage: ThreadTimelineSendToMainMessageHandler | undefined;
  onSelectionAddToChat: ThreadTimelineSelectionAddToChatHandler | undefined;
}

const isVisibleSideChatTimelineRow: ThreadTimelineRowFilter = (row) =>
  !(
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind === "thread-provisioning"
  );

interface OptimisticSideChatUserRowArgs {
  createdAt: number;
  input: readonly PromptInput[];
  tabId: string;
  threadId: string;
}

function emptyTimelineConversationAttachments(): TimelineConversationAttachments {
  return {
    webImages: 0,
    localImages: 0,
    localFiles: 0,
    imageUrls: [],
    localImagePaths: [],
    localFilePaths: [],
  };
}

function hasTimelineConversationAttachments(
  attachments: TimelineConversationAttachments,
): boolean {
  return (
    attachments.webImages > 0 ||
    attachments.localImages > 0 ||
    attachments.localFiles > 0
  );
}

function buildOptimisticSideChatUserRow({
  createdAt,
  input,
  tabId,
  threadId,
}: OptimisticSideChatUserRowArgs): TimelineUserConversationRow {
  const textSegments: string[] = [];
  const mentions: PromptTextMention[] = [];
  const attachments = emptyTimelineConversationAttachments();
  let textOffset = 0;

  for (const entry of input) {
    if (entry.type === "text") {
      if (entry.text.trim().length > 0) {
        if (textSegments.length > 0) {
          textOffset += 2;
        }
        for (const mention of entry.mentions) {
          mentions.push({
            ...mention,
            start: textOffset + mention.start,
            end: textOffset + mention.end,
          });
        }
        textSegments.push(entry.text);
        textOffset += entry.text.length;
      }
      continue;
    }

    if (entry.type === "image") {
      attachments.webImages += 1;
      attachments.imageUrls.push(entry.url);
      continue;
    }

    if (entry.type === "localImage") {
      attachments.localImages += 1;
      attachments.localImagePaths.push(entry.path);
      continue;
    }

    attachments.localFiles += 1;
    attachments.localFilePaths.push(entry.path);
  }

  return {
    id: `${tabId}:optimistic-first-user-message`,
    threadId,
    turnId: `${tabId}:optimistic-first-user-turn`,
    sourceSeqStart: 0,
    sourceSeqEnd: 0,
    startedAt: createdAt,
    createdAt,
    kind: "conversation",
    role: "user",
    initiator: "user",
    senderThreadId: null,
    systemMessageKind: "unlabeled",
    systemMessageSubject: null,
    text: textSegments.join("\n\n"),
    mentions,
    attachments: hasTimelineConversationAttachments(attachments)
      ? attachments
      : null,
    turnRequest: { kind: "message", status: "accepted" },
  };
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
  leadingContent,
  timeline,
  threadId,
  onSendToMainMessage,
  onSelectionAddToChat,
}: SideChatConversationProps) {
  return (
    <ThreadTimelinePanelContent
      isTurnSubmitting={isSideChatTurnSubmitting}
      leadingContent={leadingContent}
      missingThreadLabel="This side chat is no longer available."
      onSendToMainMessage={onSendToMainMessage}
      onSelectionAddToChat={onSelectionAddToChat}
      provisioningLabel="Provisioning side chat..."
      rowFilter={isVisibleSideChatTimelineRow}
      showLoadOlderRows={false}
      threadId={threadId}
      timeline={timeline}
      timelineErrorLabel="Failed to load side chat"
    />
  );
}

/**
 * Hosts a message-anchored side chat: the child thread's conversation above the
 * shared `FollowUpPromptBox` composer (the same component the main thread uses)
 * with its footer in read-only mode — the side chat inherits the parent's
 * provider/model and is always read-only. The child thread is created by the
 * user's first submit, so opening a side chat is just a draft surface until the
 * user sends. Once a thread exists, each side-chat agent reply carries a
 * per-message "send to main thread" action that posts that reply into the main
 * thread (rendered there as "Message from {side chat}") via the existing
 * cross-thread send transport (`senderThreadId`).
 */
export function SideChatTabContent({
  isActive,
  tab,
  sourceThread,
  sourceEnvironment,
  sourceTimelineRows,
  resolveMentionLink,
  onSetThreadId,
}: SideChatTabContentProps) {
  const childThreadId = tab.threadId;
  const createThread = useCreateThread();
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const deleteQueuedMessage = useDeleteThreadQueuedMessage();
  const markThreadRead = useMarkThreadRead();
  const reorderQueuedMessage = useReorderThreadQueuedMessage();
  const sendQueuedMessage = useSendThreadQueuedMessage();
  const setQueuedMessageGroupBoundary =
    useSetThreadQueuedMessageGroupBoundary();
  const sendThreadMessage = useSendThreadMessage();
  const stopThread = useStopThread();
  const { isLocalDaemonHost } = useHostDaemon();
  const executionOptionsQuery = useThreadDefaultExecutionOptions(
    sourceThread.id,
  );
  const childThreadQuery = useThread(childThreadId ?? "", {
    enabled: childThreadId !== null,
  });
  useThreadReadTracking({
    markThreadRead,
    thread: isActive ? childThreadQuery.data : undefined,
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
  // propagates. Keep the in-flight create promise here so repeated submit
  // attempts share one side-chat thread.
  const createThreadPromiseRef = useRef<Promise<string | null> | null>(null);
  const childThreadIdRef = useRef<string | null>(childThreadId);
  const childHasUserMessageRef = useRef(false);
  const createdInitialMessageThreadIdRef = useRef<string | null>(null);
  const observedChildThreadIdRef = useRef<string | null>(childThreadId);
  const isMountedRef = useRef(false);
  const queuedMessageCountRef = useRef(0);
  const promptDraft = usePromptDraftStorage({
    kind: "side-chat",
    parentThreadId: sourceThread.id,
    tabId: tab.id,
  });
  const promptContextEnvironmentId =
    childThreadQuery.data?.environmentId ?? sourceThread.environmentId ?? null;
  const promptContextThreadId = childThreadId ?? sourceThread.id;
  const promptMentions = usePromptMentions(sourceThread.projectId, {
    currentThreadId: promptContextThreadId,
    environmentId: promptContextEnvironmentId,
  });
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const providerPromptActions = useMemo(
    () =>
      buildProviderPromptActionProps(
        threadCreationOptions.selectedProviderComposerActions ?? [],
      ),
    [threadCreationOptions.selectedProviderComposerActions],
  );
  const promptActions = useMemo(
    () => withLoopPromptAction(providerPromptActions.promptActions),
    [providerPromptActions.promptActions],
  );
  const commandSuggestions = useCommandSuggestions({
    projectId: sourceThread.projectId,
    providerId: sourceThread.providerId,
    skillsTrigger: providerPromptActions.skillsTrigger,
    environmentId: promptContextEnvironmentId,
    query: commandQuery,
  });
  const uploadPromptAttachment = useUploadPromptAttachment();

  const [composerFocusNonce, setComposerFocusNonce] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [isSideChatTurnSubmitting, setIsSideChatTurnSubmitting] =
    useState(false);
  const [optimisticFirstUserRow, setOptimisticFirstUserRow] =
    useState<TimelineUserConversationRow | null>(null);
  const [processingQueuedMessage, setProcessingQueuedMessage] = useState<{
    action: QueuedMessageProcessingAction;
    id: string;
  } | null>(null);
  const handleChangeMessage = useCallback(
    (nextValue: string, nextMentions: PromptTextMention[]) => {
      promptDraft.setTextAndMentions(nextValue, nextMentions);
    },
    [promptDraft],
  );
  const currentPromptDraft = useMemo(
    () => ({
      text: promptDraft.text,
      mentions: promptDraft.mentions,
      attachments: promptDraft.attachments,
    }),
    [promptDraft.attachments, promptDraft.mentions, promptDraft.text],
  );
  const currentPromptDraftInput = useMemo(
    () => promptDraftToInput(currentPromptDraft),
    [currentPromptDraft],
  );
  const hasPromptDraftInput = currentPromptDraftInput.length > 0;

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
  const childTimeline = useThreadTimelineController({
    enabled: childThreadId !== null,
    rowFilter: isVisibleSideChatTimelineRow,
    surfaceKey: childThreadId !== null ? `side-chat:${childThreadId}` : tab.id,
    threadId: childThreadId ?? "",
  });
  const { data: queuedMessages = [] } = useThreadQueuedMessages(
    childThreadId ?? "",
    {
      enabled: childThreadId !== null,
    },
  );
  const childHasUserMessage = useMemo(
    () => timelineRowsContainUserMessage(childTimeline.timelineRows),
    [childTimeline.timelineRows],
  );
  const childTimelineRowsWithOptimisticFirstUserRow = useMemo(() => {
    if (optimisticFirstUserRow === null || childHasUserMessage) {
      return childTimeline.timelineRows;
    }
    return [optimisticFirstUserRow, ...childTimeline.timelineRows];
  }, [childHasUserMessage, childTimeline.timelineRows, optimisticFirstUserRow]);
  const displayedChildTimeline = useMemo(
    () =>
      childTimelineRowsWithOptimisticFirstUserRow === childTimeline.timelineRows
        ? childTimeline
        : {
            ...childTimeline,
            timelineRows: childTimelineRowsWithOptimisticFirstUserRow,
          },
    [childTimeline, childTimelineRowsWithOptimisticFirstUserRow],
  );
  const queuedMessagesById = useMemo(() => {
    const next = new Map<string, ThreadQueuedMessage>();
    for (const queuedMessage of queuedMessages) {
      next.set(queuedMessage.id, queuedMessage);
    }
    return next;
  }, [queuedMessages]);

  childThreadIdRef.current = childThreadId;
  if (observedChildThreadIdRef.current !== childThreadId) {
    observedChildThreadIdRef.current = childThreadId;
    childHasUserMessageRef.current =
      childThreadId !== null &&
      (createdInitialMessageThreadIdRef.current === childThreadId ||
        childHasUserMessage);
  } else if (childHasUserMessage) {
    childHasUserMessageRef.current = true;
  }
  queuedMessageCountRef.current = queuedMessages.length;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (childHasUserMessage) {
      setOptimisticFirstUserRow(null);
    }
  }, [childHasUserMessage]);

  const createSideChatThread = useCallback(
    async (
      input: ReturnType<typeof buildSideChatMessageInput>,
    ): Promise<string | null> => {
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
      const request = buildSideChatCreateRequest({
        input,
        projectId: sourceThread.projectId,
        sourceThreadId: sourceThread.id,
        sourceEnvironment,
        providerId: sourceThread.providerId,
        model: executionOptions.model,
        reasoningLevel: executionOptions.reasoningLevel,
        serviceTier: executionOptions.serviceTier,
        sourceSeqEnd: tab.sourceSeqEnd ?? undefined,
        title: tab.title,
      });
      const promise = createThread
        .mutateAsync(request)
        .then((thread) => {
          childThreadIdRef.current = thread.id;
          childHasUserMessageRef.current = true;
          createdInitialMessageThreadIdRef.current = thread.id;
          onSetThreadId({ tabId: tab.id, threadId: thread.id });
          return thread.id;
        })
        .finally(() => {
          createThreadPromiseRef.current = null;
        });
      createThreadPromiseRef.current = promise;
      return promise;
    },
    [
      canCreateSideChatThread,
      createThread,
      defaultExecutionOptions,
      onSetThreadId,
      sourceEnvironment,
      sourceThread.id,
      sourceThread.projectId,
      sourceThread.providerId,
      tab.id,
      tab.sourceSeqEnd,
      tab.title,
    ],
  );

  const sendOrQueueSideChatInput = useCallback(
    async (visibleInput: ReturnType<typeof buildSideChatMessageInput>) => {
      const input = buildSideChatMessageInput({
        includeReplyReference:
          !childHasUserMessageRef.current &&
          queuedMessageCountRef.current === 0,
        replyReference,
        visibleInput,
      });
      const existingThreadId = childThreadIdRef.current;
      if (existingThreadId === null) {
        const createdThreadId = await createSideChatThread(input);
        if (createdThreadId === null) {
          throw new Error("Side chat is not ready to create yet.");
        }
        return;
      }
      const displayStatus =
        childThreadQuery.data?.runtime.displayStatus ?? "idle";
      if (shouldQueueSideChatMessage(displayStatus)) {
        await createQueuedMessage.mutateAsync({
          id: existingThreadId,
          input,
          ...sideChatExecutionRequestFields,
        });
      } else {
        await sendThreadMessage.mutateAsync({
          id: existingThreadId,
          input,
          mode: "queue-if-active",
          ...sideChatExecutionRequestFields,
        });
      }
    },
    [
      childThreadQuery.data?.runtime.displayStatus,
      createSideChatThread,
      createQueuedMessage,
      replyReference,
      sendThreadMessage,
      sideChatExecutionRequestFields,
    ],
  );

  // A side chat hands results back to the main thread per agent message (the
  // "send to main thread" action under each reply) via the cross-thread
  // `senderThreadId` transport. Keep the action visible and guard the handler
  // against double-sends while the mutation is in flight.
  const sendMessageToMain = useCallback<ThreadTimelineSendToMainMessageHandler>(
    (target) => {
      if (childThreadId === null || sendThreadMessage.isPending) {
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
  const handleSelectionAddToChat =
    useCallback<ThreadTimelineSelectionAddToChatHandler>(
      (text, attachments) => {
        promptDraft.addQuote(text, attachments);
        setComposerFocusNonce((nonce) => nonce + 1);
      },
      [promptDraft],
    );

  const sideChatRuntimeDisplayStatus =
    childThreadQuery.data?.runtime.displayStatus ?? "idle";
  const canSendMessageToMain = !isRunningThreadRuntimeDisplayStatus(
    sideChatRuntimeDisplayStatus,
  );
  const isDefaultExecutionOptionsLoading =
    defaultExecutionOptions === undefined && executionOptionsQuery.isLoading;
  const isSideChatStopRequested =
    childThreadId !== null &&
    (childThreadQuery.data?.status === "stopping" ||
      (stopThread.isPending && stopThread.variables === childThreadId));
  const handleStopSideChatThread = useCallback(() => {
    if (childThreadId === null) {
      return;
    }
    stopThread.mutate(childThreadId);
  }, [childThreadId, stopThread]);
  const sideChatSubmitMode = useMemo<FollowUpComposerProps["submitMode"]>(
    () =>
      buildSideChatSubmitMode({
        childThreadId,
        isDefaultExecutionOptionsLoading,
        isStopRequested: isSideChatStopRequested,
        onStop: handleStopSideChatThread,
        runtimeDisplayStatus: sideChatRuntimeDisplayStatus,
      }),
    [
      childThreadId,
      handleStopSideChatThread,
      isDefaultExecutionOptionsLoading,
      isSideChatStopRequested,
      sideChatRuntimeDisplayStatus,
    ],
  );
  const isSideChatProvisioning =
    sideChatRuntimeDisplayStatus === "provisioning" ||
    sideChatRuntimeDisplayStatus === "starting";
  const composerPlaceholder = isSideChatStopRequested
    ? "Stopping side chat..."
    : isSideChatProvisioning
      ? "Provisioning side chat..."
      : "Reply in the side chat…";
  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      setAttachmentError(null);
      const failedFiles: string[] = [];
      for (const file of files) {
        try {
          const uploaded = await uploadPromptAttachment.mutateAsync({
            projectId: sourceThread.projectId,
            file,
          });
          promptDraft.addAttachment(uploaded);
        } catch {
          failedFiles.push(file.name);
        }
      }
      if (failedFiles.length > 0) {
        setAttachmentError(`Failed to attach: ${failedFiles.join(", ")}`);
      }
    },
    [promptDraft, sourceThread.projectId, uploadPromptAttachment],
  );
  const handleSubmit = useCallback(() => {
    const submittedDraft = currentPromptDraft;
    const submittedInput = currentPromptDraftInput;
    if (submittedInput.length === 0 || isSideChatTurnSubmitting) {
      return;
    }
    const shouldShowOptimisticFirstMessage =
      childThreadIdRef.current === null &&
      !childHasUserMessageRef.current &&
      queuedMessageCountRef.current === 0;
    if (shouldShowOptimisticFirstMessage) {
      setOptimisticFirstUserRow(
        buildOptimisticSideChatUserRow({
          createdAt: Date.now(),
          input: submittedInput,
          tabId: tab.id,
          threadId: childThreadIdRef.current ?? tab.id,
        }),
      );
    }
    promptDraft.clearIfCurrentMatches(submittedDraft);
    setAttachmentError(null);
    setIsSideChatTurnSubmitting(true);
    void sendOrQueueSideChatInput(submittedInput)
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }
        setOptimisticFirstUserRow(null);
        promptDraft.restoreIfEmpty(submittedDraft);
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
        if (isMountedRef.current) {
          setIsSideChatTurnSubmitting(false);
        }
      });
  }, [
    currentPromptDraft,
    currentPromptDraftInput,
    isSideChatTurnSubmitting,
    promptDraft,
    sendOrQueueSideChatInput,
    sideChatRuntimeDisplayStatus,
    tab.id,
  ]);

  const queuedMessageActionPending =
    deleteQueuedMessage.isPending ||
    reorderQueuedMessage.isPending ||
    setQueuedMessageGroupBoundary.isPending ||
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
  const isQueueMutationPending =
    queuedMessageActionPending || createQueuedMessage.isPending;
  const canSubmitModifierShortcut = canSubmitFollowUpShortcut({
    hasPromptDraftInput,
    isFollowUpSubmitting: isSideChatTurnSubmitting,
    isQueueMutationPending,
    queuedMessageCount: queuedMessages.length,
    runtimeDisplayStatus: sideChatRuntimeDisplayStatus,
    submitModeKind: sideChatSubmitMode.kind,
  });
  const handleModifierSubmit = useCallback(() => {
    if (!canSubmitModifierShortcut || childThreadId === null) {
      return;
    }

    const submittedDraft = currentPromptDraft;
    const submittedInput = currentPromptDraftInput;
    if (submittedInput.length === 0) {
      const nextQueuedMessage = queuedMessages[0];
      if (nextQueuedMessage) {
        handleSendQueuedImmediately(nextQueuedMessage.id);
      }
      return;
    }

    const input = buildSideChatMessageInput({
      includeReplyReference: false,
      replyReference: null,
      visibleInput: submittedInput,
    });

    promptDraft.clearIfCurrentMatches(submittedDraft);
    setAttachmentError(null);
    setIsSideChatTurnSubmitting(true);
    void sendThreadMessage
      .mutateAsync({
        id: childThreadId,
        input,
        mode: "steer-if-active",
      })
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }
        promptDraft.restoreIfEmpty(submittedDraft);
        appToast.error(
          getMutationErrorMessage({
            error,
            fallbackMessage: "Failed to send side chat message",
            lifecycleOperation: "send_message",
          }),
        );
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsSideChatTurnSubmitting(false);
        }
      });
  }, [
    canSubmitModifierShortcut,
    childThreadId,
    currentPromptDraft,
    currentPromptDraftInput,
    handleSendQueuedImmediately,
    promptDraft,
    queuedMessages,
    sendThreadMessage,
  ]);

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
          promptDraft.setDraft(restoredDraft);
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
    [childThreadId, deleteQueuedMessage, promptDraft, queuedMessagesById],
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

  const handleSetQueuedMessageGroupBoundary = useCallback(
    (request: QueuedMessageGroupBoundaryRequest) => {
      if (childThreadId === null) {
        return;
      }
      void setQueuedMessageGroupBoundary
        .mutateAsync({
          id: childThreadId,
          ...request,
        })
        .catch((error) => {
          appToast.error(
            getMutationErrorMessage({
              error,
              fallbackMessage: "Failed to group queued messages",
              lifecycleOperation: "set_queued_message_group_boundary",
            }),
          );
        });
    },
    [childThreadId, setQueuedMessageGroupBoundary],
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
          onSetGroupBoundary={handleSetQueuedMessageGroupBoundary}
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
      handleSetQueuedMessageGroupBoundary,
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
          text: promptDraft.text,
          mentions: promptDraft.mentions,
          attachments: promptDraft.attachments,
        },
        entries: [],
        onSelectEntry: noop,
      } satisfies HistoryConfig,
      isFollowUpSubmitting: isSideChatTurnSubmitting,
      message: promptDraft.text,
      mentionRanges: promptDraft.mentions,
      onChangeMessage: handleChangeMessage,
      onModifierSubmit: handleModifierSubmit,
      onSubmit: handleSubmit,
      promptPlaceholder: composerPlaceholder,
      canModifierSubmit: canSubmitModifierShortcut,
      submitMode: sideChatSubmitMode,
      threadRuntimeDisplayStatus: sideChatRuntimeDisplayStatus,
    }),
    [
      canSubmitModifierShortcut,
      composerPlaceholder,
      handleChangeMessage,
      handleModifierSubmit,
      handleSubmit,
      isSideChatTurnSubmitting,
      promptDraft.attachments,
      promptDraft.mentions,
      promptDraft.text,
      sideChatRuntimeDisplayStatus,
      sideChatSubmitMode,
    ],
  );

  const attachmentsConfig = useMemo<AttachmentsConfig>(
    () => ({
      items: promptDraft.attachments,
      projectId: sourceThread.projectId,
      isAttaching: uploadPromptAttachment.isPending,
      error: attachmentError,
      onAttachFiles: handleAttachFiles,
      onRemove: promptDraft.removeAttachment,
    }),
    [
      attachmentError,
      handleAttachFiles,
      promptDraft.attachments,
      promptDraft.removeAttachment,
      sourceThread.projectId,
      uploadPromptAttachment.isPending,
    ],
  );

  const typeaheadConfig = useMemo<TypeaheadConfig>(
    () => ({
      mention: {
        suggestions: promptMentions.suggestions,
        isLoading: promptMentions.isLoading,
        isError: promptMentions.isError,
        onQueryChange: promptMentions.setQuery,
        resolveLink: resolveMentionLink,
      },
      command: {
        trigger: commandSuggestions.trigger,
        suggestions: commandSuggestions.suggestions,
        isLoading: commandSuggestions.isLoading,
        isError: commandSuggestions.isError,
        hasMore: commandSuggestions.hasMore,
        isLoadingMore: commandSuggestions.isLoadingMore,
        loadMore: commandSuggestions.loadMore,
        onQueryChange: setCommandQuery,
      },
    }),
    [
      commandSuggestions.hasMore,
      commandSuggestions.isError,
      commandSuggestions.isLoading,
      commandSuggestions.isLoadingMore,
      commandSuggestions.loadMore,
      commandSuggestions.suggestions,
      commandSuggestions.trigger,
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.setQuery,
      promptMentions.suggestions,
      resolveMentionLink,
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
    moreModelOptions,
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
        moreOptions: moreModelOptions,
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
      moreModelOptions,
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

  const sideChatFooter = (
    <div className="relative bg-background">
      <OverflowFade placement="above" tone="background" />
      <div className="px-4 pb-4 pt-2">
        <FollowUpPromptBox
          attachments={attachmentsConfig}
          stack={queuedMessagesStack ?? <></>}
          composer={composerConfig}
          environmentSummary={environmentSummary}
          contextWindowUsage={null}
          execution={executionConfig}
          permission={permissionConfig}
          readOnly
          typeahead={typeaheadConfig}
          promptActions={promptActions}
          zenModeResetKey={childThreadId ?? tab.id}
          focusEndKey={composerFocusNonce}
        />
      </div>
    </div>
  );
  const sideChatLeadingContent = hasTriggerMessage ? (
    // The agent message this side chat replies to, rendered like a steer
    // message — a "Replying to" header above a left-aligned bubble — so
    // it's clear which message is in focus and the styling matches the
    // main timeline.
    <div className="mx-1 mb-2 flex flex-col items-start gap-1">
      <span className="text-xs leading-none text-muted-foreground">
        <Icon
          name="CornerDownRight"
          className="mr-1 inline-block size-3 align-middle"
        />
        Replying to
      </span>
      <div className="max-w-full rounded-md bg-surface-recessed p-1.5 text-xs leading-5 text-foreground">
        {messageBodyHasQuote(triggerMessageText) ? (
          <div className="max-h-20 overflow-hidden break-words">
            {renderMessageBodyWithQuotes({
              mentions: [],
              text: triggerMessageText,
            })}
          </div>
        ) : (
          <p className="line-clamp-2 whitespace-pre-wrap break-words">
            {triggerMessageText}
          </p>
        )}
      </div>
    </div>
  ) : null;

  return (
    <div data-thread-window="" className="flex min-h-0 flex-1 flex-col">
      <BottomAnchoredScrollBody
        key={childThreadId ?? tab.id}
        scrollAreaClassName="bg-background"
        contentClassName="!px-2 !pb-3 !pt-3"
        maxWidthClassName="max-w-none"
        footer={sideChatFooter}
        scrollAnchorThreadId={childThreadId ?? undefined}
      >
        {childThreadId !== null ? (
          <SideChatConversation
            isSideChatTurnSubmitting={isSideChatTurnSubmitting}
            leadingContent={sideChatLeadingContent}
            timeline={displayedChildTimeline}
            threadId={childThreadId}
            onSendToMainMessage={
              canSendMessageToMain ? sendMessageToMain : undefined
            }
            onSelectionAddToChat={handleSelectionAddToChat}
          />
        ) : (
          <ThreadTimelineSurface
            activeThinking={null}
            leadingContent={sideChatLeadingContent}
            isThreadTimelinePending={false}
            timelineError={false}
            showOngoingIndicator={isSideChatTurnSubmitting}
            ongoingIndicatorLabel="Starting side chat..."
            timelineRows={
              optimisticFirstUserRow === null ? [] : [optimisticFirstUserRow]
            }
            threadId={tab.id}
            threadRuntimeDisplayStatus="starting"
            workspaceRootPath={undefined}
          />
        )}
      </BottomAnchoredScrollBody>
    </div>
  );
}
