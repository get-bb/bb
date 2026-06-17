import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IconName } from "@/components/ui/icon.js";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { getFollowUpPromptPlaceholder } from "@/components/promptbox/follow-up-placeholder";
import type {
  EnvironmentStatus,
  PendingInteraction,
  ThreadQueuedMessage,
  ThreadTimelineGoal,
  ThreadTimelinePendingTodos,
  ThreadWithRuntime,
} from "@bb/domain";
import type {
  ThreadTimelineResponse,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import {
  ThreadPromptContextBanner,
  type ContextBannerMergeBaseConfig,
  type ThreadPromptContextBannerExpandedSection,
  type ThreadPromptParentThreadSection,
  type ThreadPromptChildThreadsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { ThreadGoalCard } from "@/components/promptbox/banner/ThreadGoalCard";
import { ThreadWorkflowCard } from "@/components/promptbox/banner/ThreadWorkflowCard";
import type {
  WorkspaceChangedFileSelection,
  WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import {
  QueuedMessagesList,
  type QueuedMessageProcessingAction,
} from "@/components/promptbox/banner/QueuedMessagesList";
import type { QueuedMessageReorderRequest } from "@/lib/queued-message-reorder";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import type { WorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { useEscapeToHide } from "@/hooks/useEscapeToHide";
import { usePromptMentions } from "@/hooks/usePromptMentions";
import { useCommandSuggestions } from "@/hooks/useCommandSuggestions";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { useUploadPromptAttachment } from "@/hooks/mutations/project-mutations";
import {
  useCreateThreadQueuedMessage,
  useDeleteThreadQueuedMessage,
  useReorderThreadQueuedMessage,
  useSendThreadQueuedMessage,
  useStopThread,
} from "@/hooks/mutations/thread-runtime-mutations";
import {
  getLatestPendingInteraction,
  useThreadQueuedMessages,
  useThreadPromptHistory,
} from "@/hooks/queries/thread-queries";
import { useThreadDefaultExecutionOptions } from "@/hooks/queries/thread-default-execution-options-query";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { promptHistoryEntriesToDrafts } from "@/lib/prompt-history";
import { promptDraftToInput } from "@/lib/prompt-draft";
import { appToast } from "@/components/ui/app-toast";
import {
  FollowUpPromptBox,
  type FollowUpSubmitMode,
} from "@/components/promptbox/FollowUpPromptBox";
import { queuedInputToDraft } from "./threadQueuedMessages";
import type { SendMessageMutationLike } from "./threadDetailMutationTypes";
import {
  buildAutoFollowUpRequest,
  buildCreateQueuedFollowUpRequest,
  buildFollowUpSubmitMode,
  buildFollowUpShortcutRequest,
  buildSendQueuedMessageByIdRequest,
  canSubmitFollowUpShortcut,
  resolveDefaultExecutionOptionsState,
  shouldQueueFollowUpMessage,
  type FollowUpExecutionSelection,
} from "./threadDetailPromptSubmission";

const ignorePromptBannerFileClick = () => {};

export const THREAD_DETAIL_COMPOSER_TEXTAREA_ID =
  "thread-detail-follow-up-composer";

interface ThreadDetailPromptAreaProps {
  canUseGitUi: boolean;
  composerQueriesEnabled: boolean;
  composerQueriesStaleTime?: number;
  contextWindowUsage?: ThreadTimelineResponse["contextWindowUsage"];
  environmentCheckout?: WorkspaceCheckoutDisplay;
  environmentCompactLabel?: string;
  /**
   * Set when the thread's environment is gone (`destroying` or `destroyed`).
   * Collapses the composer and shows a read-only context-banner row — the
   * thread can no longer run work (Decision B*).
   */
  environmentGoneStatus: Extract<
    EnvironmentStatus,
    "destroying" | "destroyed"
  > | null;
  environmentIcon?: IconName;
  environmentLabel?: string;
  onCreateNewThreadInWorktree?: () => void;
  onEscapeEmptyPrompt?: () => void;
  isEnvironmentActionPending: boolean;
  pendingInteractions: readonly PendingInteraction[];
  onChangedFileClick: (selection: WorkspaceChangedFileSelection) => void;
  openThreadDiffPanel: () => void;
  projectId: string;
  /** Click handler for inserted mention pills (navigate to threads, open file previews). */
  resolveMentionLink: PromptMentionLinkResolver;
  /**
   * Resolved changed-files section for the thread's workspace. Null hides the
   * banner. Production passes null when git UI is unavailable
   * (canUseGitUi === false) or the workspace has no changes; otherwise the
   * value is selectWorkspaceChangedFilesSection(workspaceStatus).
   */
  workspaceChangedFilesSection: WorkspaceChangedFilesSection | null;
  /**
   * True while the workspace status query is in flight on initial load.
   * Suppresses the prompt context banner until the result settles so the
   * banner's first paint is its final form.
   */
  workspaceStatusPending: boolean;
  /**
   * Merge-base picker config for the prompt context banner. Null hides the
   * picker (e.g. thread is on default branch — no merge base to compare).
   */
  contextBannerMergeBase: ContextBannerMergeBaseConfig | null;
  /** Latest TODO snapshot from the timeline projection. Null on older pages or when no candidate observed. */
  pendingTodos: ThreadTimelinePendingTodos | null;
  /** Current provider goal from the timeline projection. Null when no goal is active. */
  goal: ThreadTimelineGoal | null;
  /** Running workflow row from the timeline. Null when no workflow is active. */
  activeWorkflow: TimelineWorkflowWorkRow | null;
  /** Parent reference for child threads. Null for root threads. */
  parentThreadSection: ThreadPromptParentThreadSection | null;
  /** Active child threads for parent threads. Null otherwise. */
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  sendMessage: SendMessageMutationLike;
  /**
   * Bumped by the timeline host each time a quote is appended to the shared
   * draft via "Add to chat", so the composer can focus its caret at the end —
   * ready for the reply beneath the freshly inserted blockquote.
   */
  composerFocusRequestNonce: number;
  thread: ThreadWithRuntime;
}

type QueuedMessageSendGuard = "exists" | "current-head";

interface SendQueuedMessageByIdArgs {
  guard: QueuedMessageSendGuard;
  messageId: string;
}

export function ThreadDetailPromptArea({
  canUseGitUi,
  composerQueriesEnabled,
  composerQueriesStaleTime,
  contextWindowUsage,
  environmentCheckout,
  environmentCompactLabel,
  environmentGoneStatus,
  environmentIcon,
  environmentLabel,
  onCreateNewThreadInWorktree,
  onEscapeEmptyPrompt,
  isEnvironmentActionPending,
  pendingInteractions,
  onChangedFileClick,
  openThreadDiffPanel,
  projectId,
  resolveMentionLink,
  workspaceChangedFilesSection,
  workspaceStatusPending,
  contextBannerMergeBase,
  pendingTodos,
  goal,
  activeWorkflow,
  parentThreadSection,
  childThreadsSection,
  sendMessage,
  composerFocusRequestNonce,
  thread,
}: ThreadDetailPromptAreaProps) {
  const composerQueryThreadId = composerQueriesEnabled ? thread.id : "";
  const defaultExecutionOptionsQuery = useThreadDefaultExecutionOptions(
    composerQueryThreadId,
    {
      enabled: composerQueriesEnabled,
      staleTime: composerQueriesStaleTime,
    },
  );
  const defaultExecutionOptions = defaultExecutionOptionsQuery.data;
  const hasResolvedDefaultExecutionOptions =
    defaultExecutionOptions !== undefined;
  const hasConcreteDefaultExecutionOptions =
    defaultExecutionOptions !== undefined && defaultExecutionOptions !== null;
  const defaultExecutionOptionsState = resolveDefaultExecutionOptionsState({
    hasConcreteDefaultExecutionOptions,
    hasResolvedDefaultExecutionOptions,
    isError: defaultExecutionOptionsQuery.isError,
  });
  const isDefaultExecutionOptionsLoading =
    defaultExecutionOptionsState === "loading";
  const { data: queuedMessages = [] } = useThreadQueuedMessages(
    composerQueryThreadId,
    {
      enabled: composerQueriesEnabled,
      staleTime: composerQueriesStaleTime,
    },
  );
  // Ref-backed lookup keeps queued-message action handlers stable across
  // queue refetches so memoized rows do not rerender on unrelated queue updates.
  const queuedMessagesByIdRef = useRef<
    ReadonlyMap<string, ThreadQueuedMessage>
  >(new Map());
  queuedMessagesByIdRef.current = useMemo(() => {
    const next = new Map<string, ThreadQueuedMessage>();
    for (const message of queuedMessages) {
      next.set(message.id, message);
    }
    return next;
  }, [queuedMessages]);
  const queuedMessagesRef = useRef<readonly ThreadQueuedMessage[]>([]);
  queuedMessagesRef.current = queuedMessages;
  const [processingQueuedMessage, setProcessingQueuedMessage] = useState<{
    id: string;
    action: QueuedMessageProcessingAction;
  } | null>(null);

  // A steered ("send now") queued message keeps its "Sending..." label until it
  // leaves the queue — i.e. the steer has been accepted and surfaces in the
  // timeline — rather than clearing the moment the send request resolves, which
  // would briefly flash the row back to its normal state. So the send handler
  // does not clear on success; instead we drop the displayed processing state
  // once its message is gone from the queue (derived, no effect — also keeps a
  // stale state from disabling reordering on the remaining rows).
  const displayedProcessingQueuedMessage = useMemo(
    () =>
      processingQueuedMessage &&
      queuedMessages.some(
        (message) => message.id === processingQueuedMessage.id,
      )
        ? processingQueuedMessage
        : null,
    [processingQueuedMessage, queuedMessages],
  );
  const { data: promptHistoryEntries = [] } = useThreadPromptHistory(
    composerQueryThreadId,
    {
      enabled: composerQueriesEnabled,
      staleTime: composerQueriesStaleTime,
    },
  );
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const sendQueuedMessage = useSendThreadQueuedMessage();
  const deleteQueuedMessage = useDeleteThreadQueuedMessage();
  const reorderQueuedMessage = useReorderThreadQueuedMessage();
  const stopThread = useStopThread();
  const uploadPromptAttachment = useUploadPromptAttachment();
  const promptDraft = usePromptDraftStorage({
    kind: "thread",
    projectId,
    threadId: thread.id,
  });
  const promptMentions = usePromptMentions(projectId, {
    currentThreadId: thread.id,
    environmentId: thread.environmentId ?? null,
  });
  // Mirrors the @-mention query plumbing above: the composer feeds the text
  // typed after the command trigger into `commandQuery`, which drives the hook.
  // Called unconditionally (hooks rules); inert when the provider has no
  // command trigger.
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const commandSuggestions = useCommandSuggestions({
    projectId: thread.projectId,
    providerId: thread.providerId,
    environmentId: thread.environmentId,
    query: commandQuery,
  });
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [expandedBannerSection, setExpandedBannerSection] =
    useState<ThreadPromptContextBannerExpandedSection | null>(null);
  const [isGoalExpanded, setIsGoalExpanded] = useState(false);
  const [isWorkflowExpanded, setIsWorkflowExpanded] = useState(false);
  const [isFollowUpShortcutSending, setIsFollowUpShortcutSending] =
    useState(false);
  const promptHistoryDrafts = useMemo(
    () => promptHistoryEntriesToDrafts(promptHistoryEntries),
    [promptHistoryEntries],
  );
  const {
    selectedProviderId,
    providerOptions,
    hasMultipleProviders,
    selectedProviderDisplayName,
    selectedModel,
    setSelectedModel,
    serviceTier,
    setServiceTier,
    reasoningLevel,
    setReasoningLevel,
    permissionMode,
    setPermissionMode,
    activeModel,
    modelOptions,
    isLoadingModels,
    modelLoadFailed,
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
    executionInputSources,
  } = useThreadCreationOptions({
    enabled: composerQueriesEnabled,
    environmentId: thread.environmentId ?? undefined,
    scope: "component-local",
    resetKey: thread.id,
    initialProviderId: thread.providerId,
    initialModel: defaultExecutionOptions?.model,
    initialServiceTier: defaultExecutionOptions?.serviceTier,
    initialReasoningLevel: defaultExecutionOptions?.reasoningLevel,
    initialPermissionMode: defaultExecutionOptions?.permissionMode,
    initialEnvironmentSelectionValue: thread.environmentId ?? undefined,
  });
  const runtimeDisplayStatus = thread.runtime.displayStatus;
  const isStopRequested =
    thread.status === "stopping" ||
    (stopThread.isPending && stopThread.variables === thread.id);
  const activePendingInteraction =
    getLatestPendingInteraction(pendingInteractions);
  const hasPendingInteraction = activePendingInteraction !== null;
  const shouldHideComposer =
    environmentGoneStatus !== null || thread.archivedAt !== null;
  const isQueueMutationPending =
    createQueuedMessage.isPending ||
    sendQueuedMessage.isPending ||
    deleteQueuedMessage.isPending ||
    reorderQueuedMessage.isPending ||
    isFollowUpShortcutSending;
  const isFollowUpSubmitting =
    sendMessage.isPending ||
    isEnvironmentActionPending ||
    createQueuedMessage.isPending ||
    isFollowUpShortcutSending;
  const handleStopThread = useCallback(() => {
    stopThread.mutate(thread.id);
  }, [stopThread, thread.id]);
  const submitMode: FollowUpSubmitMode = useMemo(() => {
    return buildFollowUpSubmitMode({
      hasPendingInteraction,
      isDefaultExecutionOptionsLoading,
      isStopRequested,
      onStop: handleStopThread,
      runtimeDisplayStatus,
    });
  }, [
    handleStopThread,
    hasPendingInteraction,
    isDefaultExecutionOptionsLoading,
    isStopRequested,
    runtimeDisplayStatus,
  ]);
  const promptPlaceholder = isStopRequested
    ? "Stopping thread..."
    : getFollowUpPromptPlaceholder(runtimeDisplayStatus);
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
  const isPromptEmpty = useCallback(
    () => !hasPromptDraftInput,
    [hasPromptDraftInput],
  );
  const hideEmptyPrompt = useCallback(() => {
    onEscapeEmptyPrompt?.();
  }, [onEscapeEmptyPrompt]);
  useEscapeToHide({
    enabled: onEscapeEmptyPrompt !== undefined,
    isEmpty: isPromptEmpty,
    onHide: hideEmptyPrompt,
  });
  const canSubmitModifierShortcut = canSubmitFollowUpShortcut({
    hasPromptDraftInput,
    isFollowUpSubmitting,
    isQueueMutationPending,
    queuedMessageCount: queuedMessages.length,
    runtimeDisplayStatus,
    submitModeKind: submitMode.kind,
  });
  const followUpExecutionSelection = useMemo<FollowUpExecutionSelection>(() => {
    if (!hasConcreteDefaultExecutionOptions) {
      return null;
    }
    return {
      model: activeModel?.model ?? selectedModel,
      supportsServiceTier,
      serviceTier,
      reasoningLevel,
      permissionMode,
      executionInputSources,
    };
  }, [
    activeModel?.model,
    executionInputSources,
    hasConcreteDefaultExecutionOptions,
    permissionMode,
    reasoningLevel,
    selectedModel,
    serviceTier,
    supportsServiceTier,
  ]);

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
            projectId,
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
    [projectId, promptDraft, uploadPromptAttachment],
  );

  const handleSend = useCallback(async () => {
    const submittedDraft = currentPromptDraft;
    const submittedInput = currentPromptDraftInput;
    const isQueuingMessage = shouldQueueFollowUpMessage(runtimeDisplayStatus);
    if (
      submittedInput.length === 0 ||
      (!isQueuingMessage && isDefaultExecutionOptionsLoading)
    ) {
      return;
    }

    promptDraft.clearIfCurrentMatches(submittedDraft);
    setAttachmentError(null);

    try {
      if (isQueuingMessage) {
        const request = buildCreateQueuedFollowUpRequest({
          threadId: thread.id,
          input: submittedInput,
          execution: followUpExecutionSelection,
        });
        if (request) {
          await createQueuedMessage.mutateAsync(request);
        }
      } else {
        const request = buildAutoFollowUpRequest({
          threadId: thread.id,
          input: submittedInput,
          execution: followUpExecutionSelection,
        });
        if (request) {
          await sendMessage.mutateAsync(request);
        }
      }
    } catch (nextError) {
      promptDraft.restoreIfEmpty(submittedDraft);
      appToast.error(
        getMutationErrorMessage({
          error: nextError,
          fallbackMessage: isQueuingMessage
            ? "Failed to queue message"
            : "Failed to send message",
          lifecycleOperation: isQueuingMessage
            ? "queue_message"
            : "send_message",
        }),
      );
    }
  }, [
    createQueuedMessage,
    currentPromptDraft,
    currentPromptDraftInput,
    followUpExecutionSelection,
    isDefaultExecutionOptionsLoading,
    promptDraft,
    sendMessage,
    thread.id,
    runtimeDisplayStatus,
  ]);

  const sendQueuedMessageById = useCallback(
    async ({ guard, messageId }: SendQueuedMessageByIdArgs) => {
      if (!queuedMessagesByIdRef.current.has(messageId)) {
        return;
      }
      if (
        guard === "current-head" &&
        queuedMessagesRef.current[0]?.id !== messageId
      ) {
        return;
      }

      setProcessingQueuedMessage({ id: messageId, action: "send" });
      try {
        await sendQueuedMessage.mutateAsync(
          buildSendQueuedMessageByIdRequest({
            queuedMessageId: messageId,
            threadId: thread.id,
          }),
        );
        setAttachmentError(null);
        // Keep the "Sending..." label until the message actually leaves the
        // queue (steered into the timeline) — handled by the effect below —
        // instead of clearing the moment the request resolves, which would
        // flash the row back to its normal state before the realtime queue
        // update removes it.
      } catch (nextError) {
        appToast.error(
          getMutationErrorMessage({
            error: nextError,
            fallbackMessage: "Failed to send queued message",
            lifecycleOperation: "send_queued_message",
          }),
        );
        setProcessingQueuedMessage((current) =>
          current?.id === messageId ? null : current,
        );
      }
    },
    [sendQueuedMessage, thread.id],
  );

  const handleModifierSubmit = useCallback(async () => {
    if (!canSubmitModifierShortcut) {
      return;
    }

    const submittedDraft = currentPromptDraft;
    const submittedInput = currentPromptDraftInput;
    const shortcutRequest = buildFollowUpShortcutRequest({
      input: submittedInput,
      queuedMessages: queuedMessagesRef.current,
      threadId: thread.id,
    });
    if (!shortcutRequest) {
      return;
    }

    if (shortcutRequest.kind === "draft") {
      setIsFollowUpShortcutSending(true);
      promptDraft.clearIfCurrentMatches(submittedDraft);
      setAttachmentError(null);

      try {
        await sendMessage.mutateAsync(shortcutRequest.request);
      } catch (nextError) {
        promptDraft.restoreIfEmpty(submittedDraft);
        appToast.error(
          getMutationErrorMessage({
            error: nextError,
            fallbackMessage: "Failed to send message",
            lifecycleOperation: "send_message",
          }),
        );
      } finally {
        setIsFollowUpShortcutSending(false);
      }
      return;
    }

    const queuedMessageId = shortcutRequest.request.queuedMessageId;
    if (queuedMessagesRef.current[0]?.id !== queuedMessageId) {
      return;
    }

    setIsFollowUpShortcutSending(true);
    try {
      await sendQueuedMessageById({
        guard: "current-head",
        messageId: queuedMessageId,
      });
    } finally {
      setIsFollowUpShortcutSending(false);
    }
  }, [
    canSubmitModifierShortcut,
    currentPromptDraft,
    currentPromptDraftInput,
    promptDraft,
    sendMessage,
    sendQueuedMessageById,
    thread.id,
  ]);

  const handleSendQueuedImmediately = useCallback(
    (messageId: string) => {
      void sendQueuedMessageById({
        guard: "exists",
        messageId,
      });
    },
    [sendQueuedMessageById],
  );

  const [editFocusNonce, setEditFocusNonce] = useState(0);

  // Focus the composer caret at the end whenever the timeline host appends a
  // quote ("Add to chat"), so the user can immediately type the reply beneath
  // the freshly inserted blockquote. Skips the initial mount (nonce starts 0).
  const previousFocusRequestNonceRef = useRef(composerFocusRequestNonce);
  useEffect(() => {
    if (composerFocusRequestNonce !== previousFocusRequestNonceRef.current) {
      previousFocusRequestNonceRef.current = composerFocusRequestNonce;
      setEditFocusNonce((nonce) => nonce + 1);
    }
  }, [composerFocusRequestNonce]);

  const handleEditQueuedMessage = useCallback(
    (messageId: string) => {
      const queuedMessage = queuedMessagesByIdRef.current.get(messageId);
      if (!queuedMessage) {
        return;
      }

      setProcessingQueuedMessage({ id: messageId, action: "edit" });
      void deleteQueuedMessage
        .mutateAsync({
          id: thread.id,
          queuedMessageId: messageId,
        })
        .then(() => {
          const restoredDraft = queuedInputToDraft(queuedMessage.content);
          promptDraft.setDraft(restoredDraft);
          setAttachmentError(null);
          // Focus the composer caret at the end so the restored draft is ready
          // to keep typing (FollowUpPromptBox `focusEndKey`).
          setEditFocusNonce((nonce) => nonce + 1);
        })
        .catch((nextError) => {
          appToast.error(
            getMutationErrorMessage({
              error: nextError,
              fallbackMessage: "Failed to edit queued message",
            }),
          );
        })
        .finally(() => {
          setProcessingQueuedMessage((current) =>
            current?.id === messageId ? null : current,
          );
        });
    },
    [deleteQueuedMessage, promptDraft, thread.id],
  );

  const handleDeleteQueuedMessage = useCallback(
    (messageId: string) => {
      setProcessingQueuedMessage({ id: messageId, action: "delete" });
      void deleteQueuedMessage
        .mutateAsync({
          id: thread.id,
          queuedMessageId: messageId,
        })
        .catch((nextError) => {
          appToast.error(
            getMutationErrorMessage({
              error: nextError,
              fallbackMessage: "Failed to delete queued message",
            }),
          );
        })
        .finally(() => {
          setProcessingQueuedMessage((current) =>
            current?.id === messageId ? null : current,
          );
        });
    },
    [deleteQueuedMessage, thread.id],
  );

  const handleReorderQueuedMessage = useCallback(
    (request: QueuedMessageReorderRequest) => {
      void reorderQueuedMessage
        .mutateAsync({
          id: thread.id,
          ...request,
        })
        .catch((nextError) => {
          appToast.error(
            getMutationErrorMessage({
              error: nextError,
              fallbackMessage: "Failed to reorder queued message",
              lifecycleOperation: "reorder_queued_message",
            }),
          );
        });
    },
    [reorderQueuedMessage, thread.id],
  );

  const handlePromptBannerFileClick = useCallback(
    (selection: WorkspaceChangedFileSelection) => {
      onChangedFileClick(selection);
    },
    [onChangedFileClick],
  );

  const handleToggleBannerSection = useCallback(
    (section: ThreadPromptContextBannerExpandedSection | null) => {
      setExpandedBannerSection((previous) =>
        previous === section ? null : section,
      );
    },
    [],
  );

  const attachmentsConfig = useMemo(
    () => ({
      items: promptDraft.attachments,
      projectId,
      isAttaching: uploadPromptAttachment.isPending,
      error: attachmentError,
      onAttachFiles: handleAttachFiles,
      onRemove: promptDraft.removeAttachment,
    }),
    [
      attachmentError,
      handleAttachFiles,
      projectId,
      promptDraft.attachments,
      promptDraft.removeAttachment,
      uploadPromptAttachment.isPending,
    ],
  );

  const composerConfig = useMemo(
    () => ({
      history: {
        currentDraft: currentPromptDraft,
        entries: promptHistoryDrafts,
        onSelectEntry: promptDraft.setDraft,
        resetKey: thread.id,
      },
      isFollowUpSubmitting,
      message: promptDraft.text,
      mentionRanges: promptDraft.mentions,
      onChangeMessage: promptDraft.setTextAndMentions,
      onModifierSubmit: handleModifierSubmit,
      onSubmit: handleSend,
      promptPlaceholder,
      canModifierSubmit: canSubmitModifierShortcut,
      submitMode,
      threadRuntimeDisplayStatus: runtimeDisplayStatus,
    }),
    [
      canSubmitModifierShortcut,
      currentPromptDraft,
      handleSend,
      handleModifierSubmit,
      isFollowUpSubmitting,
      promptDraft.setDraft,
      promptDraft.setTextAndMentions,
      promptDraft.mentions,
      promptDraft.text,
      promptHistoryDrafts,
      promptPlaceholder,
      runtimeDisplayStatus,
      submitMode,
      thread.id,
    ],
  );

  const executionConfig = useMemo(
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
        isLoading: isLoadingModels,
        loadFailed: modelLoadFailed,
        loadError: modelLoadError,
        onChange: setSelectedModel,
      },
      serviceTier: {
        value: serviceTier,
        onChange: setServiceTier,
        supported: supportsServiceTier,
        supportByProvider: serviceTierSupportByProvider,
      },
      reasoning: {
        value: reasoningLevel,
        options: reasoningOptions,
        onChange: setReasoningLevel,
      },
    }),
    [
      activeModel,
      hasMultipleProviders,
      isLoadingModels,
      modelLoadFailed,
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
      setReasoningLevel,
      setSelectedModel,
      setServiceTier,
      supportsServiceTier,
    ],
  );

  const permissionConfig = useMemo(
    () => ({
      value: hasConcreteDefaultExecutionOptions ? permissionMode : undefined,
      options: hasConcreteDefaultExecutionOptions ? permissionModeOptions : [],
      onChange: setPermissionMode,
      supported:
        hasConcreteDefaultExecutionOptions && supportsPermissionModeSelection,
    }),
    [
      hasConcreteDefaultExecutionOptions,
      permissionMode,
      permissionModeOptions,
      setPermissionMode,
      supportsPermissionModeSelection,
    ],
  );

  const typeaheadConfig = useMemo(
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
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.setQuery,
      promptMentions.suggestions,
      resolveMentionLink,
      commandSuggestions.isError,
      commandSuggestions.hasMore,
      commandSuggestions.isLoading,
      commandSuggestions.isLoadingMore,
      commandSuggestions.loadMore,
      commandSuggestions.suggestions,
      commandSuggestions.trigger,
    ],
  );

  const environmentSummary = useMemo(
    () =>
      environmentLabel ? (
        <ThreadEnvironmentSummary
          environmentLabel={environmentLabel}
          environmentCompactLabel={environmentCompactLabel}
          environmentIcon={environmentIcon}
          environmentCheckout={environmentCheckout}
          onCreateNewThreadInWorktree={onCreateNewThreadInWorktree}
        />
      ) : null,
    [
      environmentCheckout,
      environmentCompactLabel,
      environmentIcon,
      environmentLabel,
      onCreateNewThreadInWorktree,
    ],
  );
  const promptStack = useMemo(
    () => (
      <>
        <ThreadWorkflowCard
          workflow={activeWorkflow}
          isExpanded={isWorkflowExpanded}
          onToggle={() => setIsWorkflowExpanded((value) => !value)}
        />
        <ThreadGoalCard
          goal={goal}
          isExpanded={isGoalExpanded}
          onToggle={() => setIsGoalExpanded((value) => !value)}
        />
        <ThreadPromptContextBanner
          todoSection={!pendingTodos ? null : { pendingTodos }}
          archivedSection={
            thread.archivedAt !== null
              ? { archivedAt: thread.archivedAt }
              : null
          }
          environmentGoneSection={
            environmentGoneStatus === null
              ? null
              : { status: environmentGoneStatus }
          }
          parentThreadSection={parentThreadSection}
          childThreadsSection={childThreadsSection}
          gitSection={
            workspaceChangedFilesSection
              ? {
                  changedFiles: workspaceChangedFilesSection,
                  mergeBase: contextBannerMergeBase,
                  onPromptBannerFileClick: canUseGitUi
                    ? handlePromptBannerFileClick
                    : ignorePromptBannerFileClick,
                }
              : null
          }
          gitSectionPending={workspaceStatusPending}
          expandedSection={expandedBannerSection}
          onToggleSection={handleToggleBannerSection}
        />
        {shouldHideComposer ? null : (
          <QueuedMessagesList
            queuedMessages={queuedMessages}
            sendDisabled={
              !(submitMode.kind === "ready" || submitMode.kind === "queue") ||
              runtimeDisplayStatus === "provisioning" ||
              runtimeDisplayStatus === "starting" ||
              runtimeDisplayStatus === "waiting-for-host" ||
              isFollowUpSubmitting ||
              isQueueMutationPending
            }
            actionDisabled={isQueueMutationPending}
            processingMessageId={displayedProcessingQueuedMessage?.id ?? null}
            processingAction={displayedProcessingQueuedMessage?.action ?? null}
            onSendImmediately={handleSendQueuedImmediately}
            onReorder={handleReorderQueuedMessage}
            onEdit={handleEditQueuedMessage}
            onDelete={handleDeleteQueuedMessage}
          />
        )}
      </>
    ),
    [
      canUseGitUi,
      contextBannerMergeBase,
      expandedBannerSection,
      handleDeleteQueuedMessage,
      handleEditQueuedMessage,
      handlePromptBannerFileClick,
      handleReorderQueuedMessage,
      handleSendQueuedImmediately,
      handleToggleBannerSection,
      environmentGoneStatus,
      isFollowUpSubmitting,
      isQueueMutationPending,
      goal,
      isGoalExpanded,
      activeWorkflow,
      isWorkflowExpanded,
      parentThreadSection,
      childThreadsSection,
      pendingTodos,
      displayedProcessingQueuedMessage,
      queuedMessages,
      runtimeDisplayStatus,
      shouldHideComposer,
      submitMode.kind,
      thread.archivedAt,
      workspaceChangedFilesSection,
      workspaceStatusPending,
    ],
  );

  if (activePendingInteraction && !shouldHideComposer) {
    return (
      <ThreadPendingInteractionBanner
        interaction={activePendingInteraction}
        threadId={thread.id}
      />
    );
  }

  return (
    <FollowUpPromptBox
      id={THREAD_DETAIL_COMPOSER_TEXTAREA_ID}
      attachments={attachmentsConfig}
      stack={promptStack}
      composer={shouldHideComposer ? null : composerConfig}
      zenModeResetKey={thread.id}
      focusEndKey={editFocusNonce}
      environmentSummary={environmentSummary}
      contextWindowUsage={contextWindowUsage ?? null}
      execution={executionConfig}
      permission={permissionConfig}
      typeahead={typeaheadConfig}
    />
  );
}
