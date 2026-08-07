import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { IconName } from "@bb/shared-ui/icon";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  getFollowUpPromptPlaceholder,
  getCompactFollowUpPromptPlaceholder,
} from "@/components/promptbox/follow-up-placeholder";
import {
  isPluginPendingInteraction,
  isStandaloneBuiltinCompactCommand,
  PERSONAL_PROJECT_ID,
} from "@bb/domain";
import type {
  EnvironmentStatus,
  PendingInteraction,
  ThreadQueuedMessage,
  ThreadPullRequest,
  ThreadTimelineActivePromptMode,
  ThreadTimelineGoal,
  ThreadTimelineModelFallback,
  ThreadTimelinePendingTodos,
  ThreadWithRuntime,
} from "@bb/domain";
import type {
  PullRequestMergeMethod,
  ThreadTimelineResponse,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import { PluginPendingInteractionComposer } from "@/components/plugin/PluginPendingInteractionComposer";
import { PluginComposerBanners } from "@/components/plugin/PluginComposerBanners";
import {
  PluginComposerHostProvider,
  type PluginComposerHost,
  usePublishPluginComposerHost,
} from "@/components/plugin/plugin-composer-host";
import {
  ThreadPromptContextBanner,
  type ContextBannerMergeBaseConfig,
  type ThreadPromptContextBannerExpandedSection,
  type ThreadPromptParentThreadSection,
  type ThreadPromptChildThreadsSection,
  type ThreadPromptPullRequestSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { ThreadGoalCard } from "@/components/promptbox/banner/ThreadGoalCard";
import { ThreadTodoCard } from "@/components/promptbox/banner/ThreadTodoCard";
import { ThreadPromptModeCard } from "@/components/promptbox/banner/ThreadPromptModeCard";
import { ThreadWorkflowCard } from "@/components/promptbox/banner/ThreadWorkflowCard";
import { ThreadBackgroundCommandsCard } from "@/components/promptbox/banner/ThreadBackgroundCommandsCard";
import { ThreadModelFallbackCard } from "@/components/promptbox/banner/ThreadModelFallbackCard";
import type {
  WorkspaceChangedFileSelection,
  WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";
import {
  QueuedMessagesList,
  type QueuedMessageInlineEditor,
} from "@/components/promptbox/banner/QueuedMessagesList";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import type { WorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { useComposerTextEffects } from "@/lib/composer-text-effects";
import { useEscapeToHide } from "@/hooks/useEscapeToHide";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { useProjectDisplayName } from "@/hooks/queries/sidebar-navigation-query";
import {
  useActiveComposerDraft,
  useComposerAttachmentUploads,
  useComposerTypeahead,
  useInlineQueuedMessageEditing,
  useQueuedMessageActions,
  type InlineQueuedMessageEditState,
} from "@/components/thread/embedded-chat";
import {
  useCreateThreadQueuedMessage,
  useCancelThreadPlan,
  useClearThreadGoal,
  useCompactThread,
  useStopThread,
} from "@/hooks/mutations/thread-runtime-mutations";
import { useUnarchiveThread } from "@/hooks/mutations/thread-state-mutations";
import {
  getLatestPendingInteraction,
  useThreadQueuedMessages,
  useThreadPromptHistory,
} from "@/hooks/queries/thread-queries";
import { useThreadDefaultExecutionOptions } from "@/hooks/queries/thread-default-execution-options-query";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { promptHistoryEntriesToDrafts } from "@/lib/prompt-history";
import { getProjectComposeRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { buildThreadHandoffLocationState } from "@/lib/thread-handoff-request";
import { appToast } from "@/components/ui/app-toast";
import {
  FollowUpPromptBox,
  type FollowUpComposerProps,
  type FollowUpSubmitMode,
} from "@/components/promptbox/FollowUpPromptBox";
import type { SendMessageMutationLike } from "./threadDetailMutationTypes";
import {
  buildAutoFollowUpRequest,
  buildCreateQueuedFollowUpRequest,
  buildFollowUpSubmitMode,
  buildFollowUpShortcutRequest,
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
  onPullRequestDraft?: () => void;
  onPullRequestMerge?: (method: PullRequestMergeMethod) => void;
  onPullRequestReady?: () => void;
  pullRequestMergeMethod: PullRequestMergeMethod;
  isEnvironmentActionPending: boolean;
  pendingInteractions: readonly PendingInteraction[];
  pendingInteractionsInitialLoading: boolean;
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
  /** Latest task/todo snapshot from the timeline projection. Null on older pages or when no candidate observed. */
  pendingTodos: ThreadTimelinePendingTodos | null;
  /** Active provider prompt mode from the latest timeline projection. Null when no prompt mode is active. */
  activePromptMode: ThreadTimelineActivePromptMode | null;
  /** Current provider goal from the timeline projection. Null when no goal is active. */
  goal: ThreadTimelineGoal | null;
  /** Active provider fallback; controls the next model selection until another turn is requested. */
  modelFallback: ThreadTimelineModelFallback | null;
  /**
   * Running workflow rows from the timeline, most recently started first. A
   * thread can run several workflows at once, so each gets its own card. Empty
   * when none are running.
   */
  activeWorkflows: TimelineWorkflowWorkRow[];
  /** Running backgrounded shell command rows, most recent first. Empty when none. */
  activeBackgroundCommands: TimelineWorkflowWorkRow[];
  /** Parent reference for child threads. Null for root threads. */
  parentThreadSection: ThreadPromptParentThreadSection | null;
  /** Active child threads for parent threads. Null otherwise. */
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  /** Pull request summary for the active thread branch. Null when there is no PR. */
  pullRequest: ThreadPullRequest | null;
  sendMessage: SendMessageMutationLike;
  steerActiveThreadOnEnter: boolean;
  /**
   * Bumped by the timeline host each time a quote is appended to the shared
   * draft via "Add to chat", so the composer can focus its caret at the end —
   * ready for the reply beneath the freshly inserted blockquote.
   */
  composerFocusRequestNonce: number;
  thread: ThreadWithRuntime;
}

export function ThreadDetailPromptArea({
  canUseGitUi,
  contextWindowUsage,
  environmentCheckout,
  environmentCompactLabel,
  environmentGoneStatus,
  environmentIcon,
  environmentLabel,
  onCreateNewThreadInWorktree,
  onEscapeEmptyPrompt,
  onPullRequestDraft,
  onPullRequestMerge,
  onPullRequestReady,
  pullRequestMergeMethod,
  isEnvironmentActionPending,
  pendingInteractions,
  pendingInteractionsInitialLoading,
  onChangedFileClick,
  openThreadDiffPanel,
  projectId,
  resolveMentionLink,
  workspaceChangedFilesSection,
  workspaceStatusPending,
  contextBannerMergeBase,
  pendingTodos,
  activePromptMode,
  goal,
  modelFallback,
  activeWorkflows,
  activeBackgroundCommands,
  parentThreadSection,
  childThreadsSection,
  pullRequest,
  sendMessage,
  steerActiveThreadOnEnter,
  composerFocusRequestNonce,
  thread,
}: ThreadDetailPromptAreaProps) {
  const navigate = useNavigate();
  const defaultExecutionOptionsQuery = useThreadDefaultExecutionOptions(
    thread.id,
    {
      enabled: true,
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
  const { data: queuedMessages = [] } = useThreadQueuedMessages(thread.id, {
    enabled: true,
  });
  const queuedMessagesRef = useRef<readonly ThreadQueuedMessage[]>([]);
  queuedMessagesRef.current = queuedMessages;
  const [bottomPluginFocusNonce, setBottomPluginFocusNonce] = useState(0);
  const [editFocusNonce, setEditFocusNonce] = useState(0);
  const focusBottomPluginComposer = useCallback(() => {
    setBottomPluginFocusNonce((nonce) => nonce + 1);
  }, []);
  const focusQueuedPluginComposer = useCallback(() => {
    setEditFocusNonce((nonce) => nonce + 1);
  }, []);
  const clearInlineAttachmentErrorRef = useRef<() => void>(() => {});
  const {
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
    dismissInlineQueuedMessageEditor,
    beginEditQueuedMessage,
  } = useInlineQueuedMessageEditing({
    ownerThreadId: thread.id,
    queuedMessages,
    onBeginEdit: () => {
      clearInlineAttachmentErrorRef.current();
      // Focus the composer caret at the end so the restored draft is ready to
      // keep typing (FollowUpPromptBox `focusEndKey`).
      setEditFocusNonce((nonce) => nonce + 1);
    },
  });
  const { data: promptHistoryEntries = [] } = useThreadPromptHistory(
    thread.id,
    {
      enabled: true,
    },
  );
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const stopThread = useStopThread();
  const cancelThreadPlan = useCancelThreadPlan();
  const clearThreadGoal = useClearThreadGoal();
  const unarchiveThread = useUnarchiveThread();
  // The personal project isn't a meaningful label in the footer, so skip it.
  const projectName = useProjectDisplayName(
    thread.projectId === PERSONAL_PROJECT_ID ? undefined : thread.projectId,
  );
  const {
    promptDraft,
    currentPromptDraft,
    currentPromptDraftInput,
    activeComposerDraft,
    activeComposerDraftInput,
    setActiveComposerDraft,
    handleChangeMessage: handleComposerMessageChange,
    removeActiveComposerAttachment,
  } = useActiveComposerDraft({
    draftScope: {
      kind: "thread",
      projectId,
      threadId: thread.id,
    },
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
  });
  const {
    bottomAttachmentError,
    setBottomAttachmentError,
    handleAttachBottomFiles,
    isAttachingBottomFiles,
    inlineAttachmentError,
    setInlineAttachmentError,
    handleAttachInlineFiles,
    isAttachingInlineFiles,
  } = useComposerAttachmentUploads({
    projectId,
    addDraftAttachment: promptDraft.addAttachment,
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
  });
  clearInlineAttachmentErrorRef.current = () => setInlineAttachmentError(null);
  const promptTextEffects = useComposerTextEffects(promptDraft.storageKey);
  const queuedComposerTextEffectKey = inlineEditingQueuedMessage
    ? `queued-message:${thread.id}:${inlineEditingQueuedMessage.queuedMessageId}:${inlineEditingQueuedMessage.editSessionId}`
    : null;
  const queuedComposerTextEffects = useComposerTextEffects(
    queuedComposerTextEffectKey,
  );
  const [expandedBannerSection, setExpandedBannerSection] =
    useState<ThreadPromptContextBannerExpandedSection | null>(null);
  const pullRequestSection =
    useMemo<ThreadPromptPullRequestSection | null>(() => {
      if (!pullRequest) {
        return null;
      }
      const actions =
        onPullRequestReady ||
        onPullRequestMerge ||
        onPullRequestDraft ||
        isEnvironmentActionPending
          ? {
              isPending: isEnvironmentActionPending,
              ...(onPullRequestReady
                ? { onMarkReady: onPullRequestReady }
                : {}),
              ...(onPullRequestMerge ? { onMerge: onPullRequestMerge } : {}),
              ...(onPullRequestDraft
                ? { onConvertToDraft: onPullRequestDraft }
                : {}),
              ...(onPullRequestMerge
                ? { selectedMergeMethod: pullRequestMergeMethod }
                : {}),
            }
          : undefined;
      return actions ? { pullRequest, actions } : { pullRequest };
    }, [
      isEnvironmentActionPending,
      onPullRequestDraft,
      onPullRequestMerge,
      onPullRequestReady,
      pullRequest,
      pullRequestMergeMethod,
    ]);
  const [isGoalExpanded, setIsGoalExpanded] = useState(false);
  const [isTodoExpanded, setIsTodoExpanded] = useState(false);
  const [isPromptModeExpanded, setIsPromptModeExpanded] = useState(false);
  // Expansion is tracked per workflow id so concurrent workflows expand and
  // collapse independently.
  const [expandedWorkflowIds, setExpandedWorkflowIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const toggleWorkflowExpanded = useCallback((workflowId: string) => {
    setExpandedWorkflowIds((current) => {
      const next = new Set(current);
      if (!next.delete(workflowId)) {
        next.add(workflowId);
      }
      return next;
    });
  }, []);
  const [isBackgroundCommandsExpanded, setIsBackgroundCommandsExpanded] =
    useState(false);
  const [isFollowUpShortcutSending, setIsFollowUpShortcutSending] =
    useState(false);
  const promptHistoryDrafts = useMemo(
    () => promptHistoryEntriesToDrafts(promptHistoryEntries),
    [promptHistoryEntries],
  );
  const {
    executionOptionsRouting,
    selectedProviderId,
    providerOptions,
    hasMultipleProviders,
    selectedProviderDisplayName,
    selectedProviderComposerActions,
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
    moreModelOptions,
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
    enabled: thread.archivedAt === null,
    environmentId: thread.environmentId ?? undefined,
    scope: "component-local",
    resetKey: thread.id,
    initialProviderId: thread.providerId,
    initialModel:
      modelFallback?.fallbackModel ?? defaultExecutionOptions?.model,
    initialServiceTier: defaultExecutionOptions?.serviceTier,
    initialReasoningLevel: defaultExecutionOptions?.reasoningLevel,
    initialPermissionMode: defaultExecutionOptions?.permissionMode,
    initialEnvironmentSelectionValue: thread.environmentId ?? undefined,
  });
  const fallbackIdentity = modelFallback
    ? `${thread.id}:${modelFallback.sourceSeq}`
    : null;
  const [overriddenFallbackIdentity, setOverriddenFallbackIdentity] = useState<
    string | null
  >(null);
  const isFallbackModelActive =
    modelFallback !== null && overriddenFallbackIdentity !== fallbackIdentity;
  const effectiveSelectedModel = isFallbackModelActive
    ? modelFallback.fallbackModel
    : (activeModel?.model ?? selectedModel);
  const handleModelChange = useCallback(
    (model: string) => {
      if (fallbackIdentity !== null) {
        setOverriddenFallbackIdentity(fallbackIdentity);
      }
      setSelectedModel(model);
    },
    [fallbackIdentity, setSelectedModel],
  );
  const { typeaheadConfig, promptActions } = useComposerTypeahead({
    projectId: thread.projectId,
    mentionsProjectId: projectId,
    providerId: thread.providerId,
    environmentId: thread.environmentId,
    commandScope: "thread",
    currentThreadId: thread.id,
    selectedProviderComposerActions,
    resolveMentionLink,
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
  const {
    processingQueuedMessage: displayedProcessingQueuedMessage,
    queuedMessageActionPending,
    isUpdateQueuedMessagePending,
    sendQueuedMessageById,
    handleSaveInlineQueuedMessage,
    handleDeleteQueuedMessage,
    handleReorderQueuedMessage,
    handleSetQueuedMessageGroupBoundary,
  } = useQueuedMessageActions({
    threadId: thread.id,
    queuedMessages,
    // A steered ("send now") queued message keeps its "Sending..." label until
    // it leaves the queue — i.e. the steer has been accepted and surfaces in
    // the timeline — rather than clearing the moment the send request resolves.
    sendProcessingPersistence: "until-left-queue",
    onSendSuccess: () => setInlineAttachmentError(null),
    onSaveSuccess: () => setInlineAttachmentError(null),
    inlineEditingQueuedMessage,
    dismissInlineQueuedMessageEditor,
    activeComposerDraftInput,
  });
  const isQueueMutationPending =
    createQueuedMessage.isPending ||
    queuedMessageActionPending ||
    isFollowUpShortcutSending;
  const compactThread = useCompactThread();
  const isFollowUpSubmitting =
    sendMessage.isPending ||
    createQueuedMessage.isPending ||
    compactThread.isPending ||
    isFollowUpShortcutSending;
  const handleStopThread = useCallback(() => {
    stopThread.mutate(thread.id);
  }, [stopThread, thread.id]);
  const handleCancelPlan = useCallback(() => {
    cancelThreadPlan.mutate(thread.id);
  }, [cancelThreadPlan, thread.id]);
  const handleClearGoal = useCallback(() => {
    clearThreadGoal.mutate(thread.id);
  }, [clearThreadGoal, thread.id]);
  const submitMode: FollowUpSubmitMode = useMemo(() => {
    return buildFollowUpSubmitMode({
      hasPendingInteraction,
      isDefaultExecutionOptionsLoading,
      isPendingInteractionsInitialLoading: pendingInteractionsInitialLoading,
      isStopRequested,
      onStop: handleStopThread,
      runtimeDisplayStatus,
    });
  }, [
    handleStopThread,
    hasPendingInteraction,
    isDefaultExecutionOptionsLoading,
    pendingInteractionsInitialLoading,
    isStopRequested,
    runtimeDisplayStatus,
  ]);
  const promptPlaceholder = isStopRequested
    ? "Stopping thread..."
    : getFollowUpPromptPlaceholder(runtimeDisplayStatus);
  const compactPromptPlaceholder = isStopRequested
    ? "Stopping thread..."
    : getCompactFollowUpPromptPlaceholder(runtimeDisplayStatus);
  const normalPluginComposerHostBinding = useMemo<
    Omit<PluginComposerHost, "draft">
  >(
    () => ({
      scope: { kind: "thread", threadId: thread.id },
      textEffectKey: promptDraft.storageKey,
      getCurrent: promptDraft.getCurrent,
      setDraft: promptDraft.setDraft,
      focus: focusBottomPluginComposer,
    }),
    [
      focusBottomPluginComposer,
      promptDraft.getCurrent,
      promptDraft.setDraft,
      promptDraft.storageKey,
      thread.id,
    ],
  );
  const queuedPluginComposerHostBinding = useMemo<Omit<
    PluginComposerHost,
    "draft"
  > | null>(() => {
    if (!inlineEditingQueuedMessage) return null;

    const {
      draft: initialDraft,
      editSessionId,
      queuedMessageId,
    } = inlineEditingQueuedMessage;
    const isCurrentSession = (
      current: InlineQueuedMessageEditState | null,
    ): current is InlineQueuedMessageEditState =>
      current?.editSessionId === editSessionId &&
      current.queuedMessageId === queuedMessageId;

    return {
      scope: {
        kind: "queued-message",
        threadId: thread.id,
        queuedMessageId,
      },
      textEffectKey: `queued-message:${thread.id}:${queuedMessageId}:${editSessionId}`,
      getCurrent: () => {
        const current = inlineEditingQueuedMessageRef.current;
        return isCurrentSession(current) ? current.draft : initialDraft;
      },
      setDraft: (draft) => {
        const current = inlineEditingQueuedMessageRef.current;
        if (isCurrentSession(current)) {
          commitInlineQueuedMessage({ ...current, draft });
        }
      },
      focus: focusQueuedPluginComposer,
    };
  }, [
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
    focusQueuedPluginComposer,
    thread.id,
  ]);
  const normalPluginComposerHost = useMemo<PluginComposerHost>(
    () => ({
      ...normalPluginComposerHostBinding,
      draft: currentPromptDraft,
    }),
    [currentPromptDraft, normalPluginComposerHostBinding],
  );
  const queuedPluginComposerHost = useMemo<PluginComposerHost | null>(
    () =>
      queuedPluginComposerHostBinding
        ? {
            ...queuedPluginComposerHostBinding,
            draft: activeComposerDraft,
          }
        : null,
    [activeComposerDraft, queuedPluginComposerHostBinding],
  );
  usePublishPluginComposerHost(
    queuedPluginComposerHost ?? normalPluginComposerHost,
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
      model: effectiveSelectedModel,
      supportsServiceTier,
      serviceTier,
      reasoningLevel,
      permissionMode,
      executionInputSources,
    };
  }, [
    effectiveSelectedModel,
    executionInputSources,
    hasConcreteDefaultExecutionOptions,
    permissionMode,
    reasoningLevel,
    serviceTier,
    supportsServiceTier,
  ]);

  const handleSend = useCallback(async () => {
    const submittedDraft = currentPromptDraft;
    const submittedInput = currentPromptDraftInput;
    const isCompactCommand = isStandaloneBuiltinCompactCommand(submittedInput);
    const isQueuingMessage = shouldQueueFollowUpMessage(runtimeDisplayStatus);
    if (
      submittedInput.length === 0 ||
      (!isCompactCommand &&
        !isQueuingMessage &&
        isDefaultExecutionOptionsLoading)
    ) {
      return;
    }

    promptDraft.clearIfCurrentMatches(submittedDraft);
    setBottomAttachmentError(null);

    try {
      if (isCompactCommand) {
        await compactThread.mutateAsync(thread.id);
      } else if (isQueuingMessage) {
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
          fallbackMessage: isCompactCommand
            ? "Failed to compact context"
            : isQueuingMessage
              ? "Failed to queue message"
              : "Failed to send message",
          ...(!isCompactCommand
            ? {
                lifecycleOperation: isQueuingMessage
                  ? ("queue_message" as const)
                  : ("send_message" as const),
              }
            : {}),
        }),
      );
    }
  }, [
    compactThread,
    createQueuedMessage,
    currentPromptDraft,
    currentPromptDraftInput,
    followUpExecutionSelection,
    isDefaultExecutionOptionsLoading,
    promptDraft,
    sendMessage,
    setBottomAttachmentError,
    thread.id,
    runtimeDisplayStatus,
  ]);
  const handleModifierSubmit = useCallback(async () => {
    if (!canSubmitModifierShortcut) {
      return;
    }

    const submittedDraft = currentPromptDraft;
    const submittedInput = currentPromptDraftInput;
    if (isStandaloneBuiltinCompactCommand(submittedInput)) {
      setIsFollowUpShortcutSending(true);
      promptDraft.clearIfCurrentMatches(submittedDraft);
      setBottomAttachmentError(null);
      try {
        await compactThread.mutateAsync(thread.id);
      } catch (nextError) {
        promptDraft.restoreIfEmpty(submittedDraft);
        appToast.error(
          getMutationErrorMessage({
            error: nextError,
            fallbackMessage: "Failed to compact context",
          }),
        );
      } finally {
        setIsFollowUpShortcutSending(false);
      }
      return;
    }
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
      setBottomAttachmentError(null);

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
    compactThread,
    currentPromptDraft,
    currentPromptDraftInput,
    promptDraft,
    sendMessage,
    sendQueuedMessageById,
    setBottomAttachmentError,
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

  const bottomFocusEndKey = `${composerFocusRequestNonce}:${bottomPluginFocusNonce}`;

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
  const isUnarchiveCurrentThreadPending =
    unarchiveThread.isPending && unarchiveThread.variables?.id === thread.id;
  const handleUnarchiveCurrentThread = useCallback(() => {
    unarchiveThread.mutate({ id: thread.id });
  }, [thread.id, unarchiveThread]);
  const sourceThreadDisplayTitle = getThreadDisplayTitle({
    id: thread.id,
    title: thread.title,
    titleFallback: thread.titleFallback,
  });
  const handleHandoffToNewThread = useCallback(() => {
    navigate(getProjectComposeRoutePath(thread.projectId), {
      state: buildThreadHandoffLocationState({
        environmentId: thread.environmentId,
        projectId: thread.projectId,
        sourceThreadId: thread.id,
        sourceThreadTitle: sourceThreadDisplayTitle,
      }),
    });
  }, [
    navigate,
    sourceThreadDisplayTitle,
    thread.environmentId,
    thread.id,
    thread.projectId,
  ]);

  const bottomAttachmentsConfig = useMemo(
    () => ({
      items: currentPromptDraft.attachments,
      projectId,
      isAttaching: isAttachingBottomFiles,
      error: bottomAttachmentError,
      onAttachFiles: handleAttachBottomFiles,
      onRemove: promptDraft.removeAttachment,
    }),
    [
      bottomAttachmentError,
      currentPromptDraft.attachments,
      handleAttachBottomFiles,
      isAttachingBottomFiles,
      projectId,
      promptDraft.removeAttachment,
    ],
  );
  const inlineAttachmentsConfig = useMemo(
    () => ({
      items: activeComposerDraft.attachments,
      projectId,
      isAttaching: isAttachingInlineFiles,
      error: inlineAttachmentError,
      onAttachFiles: handleAttachInlineFiles,
      onRemove: removeActiveComposerAttachment,
    }),
    [
      activeComposerDraft.attachments,
      inlineAttachmentError,
      handleAttachInlineFiles,
      isAttachingInlineFiles,
      projectId,
      removeActiveComposerAttachment,
    ],
  );

  const handleBottomComposerSubmit = useCallback(() => {
    void handleSend();
  }, [handleSend]);
  const handleBottomComposerModifierSubmit = useCallback(() => {
    void handleModifierSubmit();
  }, [handleModifierSubmit]);
  const handleInlineComposerSubmit = useCallback(() => {
    void handleSaveInlineQueuedMessage();
  }, [handleSaveInlineQueuedMessage]);

  const bottomComposerConfig = useMemo<FollowUpComposerProps>(
    () => ({
      history: {
        currentDraft: currentPromptDraft,
        entries: promptHistoryDrafts,
        onSelectEntry: promptDraft.setDraft,
        resetKey: thread.id,
      },
      isFollowUpSubmitting,
      message: currentPromptDraft.text,
      mentionRanges: currentPromptDraft.mentions,
      onChangeMessage: promptDraft.setTextAndMentions,
      onModifierSubmit: handleBottomComposerModifierSubmit,
      onSubmit: handleBottomComposerSubmit,
      compactPromptPlaceholder,
      promptPlaceholder,
      canModifierSubmit: canSubmitModifierShortcut,
      steerActiveThreadOnEnter,
      submitMode,
      threadRuntimeDisplayStatus: runtimeDisplayStatus,
    }),
    [
      canSubmitModifierShortcut,
      compactPromptPlaceholder,
      currentPromptDraft,
      handleBottomComposerModifierSubmit,
      handleBottomComposerSubmit,
      isFollowUpSubmitting,
      promptHistoryDrafts,
      promptPlaceholder,
      promptDraft.setDraft,
      promptDraft.setTextAndMentions,
      runtimeDisplayStatus,
      steerActiveThreadOnEnter,
      submitMode,
      thread.id,
    ],
  );
  const inlineComposerConfig = useMemo<FollowUpComposerProps | null>(
    () =>
      inlineEditingQueuedMessage
        ? {
            history: {
              currentDraft: activeComposerDraft,
              entries: [],
              onSelectEntry: setActiveComposerDraft,
              resetKey: `${thread.id}:${inlineEditingQueuedMessage.editSessionId}`,
            },
            isFollowUpSubmitting: isUpdateQueuedMessagePending,
            message: activeComposerDraft.text,
            mentionRanges: activeComposerDraft.mentions,
            onChangeMessage: handleComposerMessageChange,
            onModifierSubmit: handleInlineComposerSubmit,
            onSubmit: handleInlineComposerSubmit,
            compactPromptPlaceholder,
            promptPlaceholder,
            canModifierSubmit:
              activeComposerDraftInput.length > 0 &&
              !isUpdateQueuedMessagePending,
            steerActiveThreadOnEnter: false,
            submitMode: { kind: "ready" },
            threadRuntimeDisplayStatus: runtimeDisplayStatus,
          }
        : null,
    [
      activeComposerDraft,
      activeComposerDraftInput.length,
      compactPromptPlaceholder,
      handleComposerMessageChange,
      handleInlineComposerSubmit,
      inlineEditingQueuedMessage,
      isUpdateQueuedMessagePending,
      promptPlaceholder,
      runtimeDisplayStatus,
      setActiveComposerDraft,
      thread.id,
    ],
  );

  const bottomExecutionConfig = useMemo(
    () => ({
      providerRouting: executionOptionsRouting,
      provider: {
        options: providerOptions,
        selectedId: selectedProviderId,
        hasMultiple: hasMultipleProviders,
        displayName: selectedProviderDisplayName,
      },
      model: {
        active: effectiveSelectedModel
          ? { model: effectiveSelectedModel }
          : null,
        selected: selectedModel,
        options: modelOptions,
        moreOptions: moreModelOptions,
        isLoading: isLoadingModels,
        loadFailed: modelLoadFailed,
        loadError: modelLoadError,
        onChange: handleModelChange,
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
      footerAction: {
        label: "Handoff to new thread",
        onClick: handleHandoffToNewThread,
      },
    }),
    [
      effectiveSelectedModel,
      executionOptionsRouting,
      hasMultipleProviders,
      handleHandoffToNewThread,
      handleModelChange,
      isLoadingModels,
      modelLoadFailed,
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
      setReasoningLevel,
      setServiceTier,
      supportsServiceTier,
    ],
  );
  const inlineExecutionConfig = useMemo(() => {
    if (!inlineEditingQueuedMessage) return null;
    const { footerAction: _footerAction, ...executionWithoutFooterAction } =
      bottomExecutionConfig;
    return {
      ...executionWithoutFooterAction,
      model: {
        ...bottomExecutionConfig.model,
        active: { model: inlineEditingQueuedMessage.model },
        selected: inlineEditingQueuedMessage.model,
      },
      serviceTier: {
        ...bottomExecutionConfig.serviceTier,
        value: inlineEditingQueuedMessage.serviceTier,
      },
      reasoning: {
        ...bottomExecutionConfig.reasoning,
        value: inlineEditingQueuedMessage.reasoningLevel,
      },
    };
  }, [bottomExecutionConfig, inlineEditingQueuedMessage]);

  const bottomPermissionConfig = useMemo(
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
  const inlinePermissionConfig = useMemo(
    () =>
      inlineEditingQueuedMessage
        ? {
            ...bottomPermissionConfig,
            value: inlineEditingQueuedMessage.permissionMode,
          }
        : null,
    [bottomPermissionConfig, inlineEditingQueuedMessage],
  );

  const environmentSummary = useMemo(
    () =>
      environmentLabel ? (
        <ThreadEnvironmentSummary
          projectName={projectName}
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
      projectName,
    ],
  );
  const activePromptModeCard = useMemo(
    () => (
      <ThreadPromptModeCard
        activePromptMode={activePromptMode}
        isExitPending={cancelThreadPlan.isPending}
        isExpanded={isPromptModeExpanded}
        onExitPlanMode={handleCancelPlan}
        onToggle={() => setIsPromptModeExpanded((value) => !value)}
      />
    ),
    [
      activePromptMode,
      cancelThreadPlan.isPending,
      handleCancelPlan,
      isPromptModeExpanded,
    ],
  );
  const activeGoalCard = useMemo(
    () => (
      <ThreadGoalCard
        goal={goal}
        isClearPending={clearThreadGoal.isPending}
        isExpanded={isGoalExpanded}
        onClearGoal={handleClearGoal}
        onToggle={() => setIsGoalExpanded((value) => !value)}
      />
    ),
    [clearThreadGoal.isPending, goal, handleClearGoal, isGoalExpanded],
  );
  const inlineEditor = useMemo<QueuedMessageInlineEditor | undefined>(() => {
    if (
      !inlineEditingQueuedMessage ||
      !inlineComposerConfig ||
      !inlineExecutionConfig ||
      !inlinePermissionConfig ||
      !queuedPluginComposerHost
    ) {
      return undefined;
    }
    return {
      queuedMessageId: inlineEditingQueuedMessage.queuedMessageId,
      queuedMessageIndex: inlineEditingQueuedMessage.queuedMessageIndex,
      onDismiss: dismissInlineQueuedMessageEditor,
      content: (
        <FollowUpPromptBox
          id={`${THREAD_DETAIL_COMPOSER_TEXTAREA_ID}-queued-${inlineEditingQueuedMessage.queuedMessageId}`}
          attachments={inlineAttachmentsConfig}
          stack={null}
          composer={inlineComposerConfig}
          pluginComposerHost={queuedPluginComposerHost}
          pluginComposerScope={queuedPluginComposerHost.scope}
          textEffects={queuedComposerTextEffects}
          environmentSummary={null}
          contextWindowUsage={null}
          execution={inlineExecutionConfig}
          executionReadOnly
          permission={inlinePermissionConfig}
          permissionReadOnly
          typeahead={typeaheadConfig}
          promptActions={promptActions}
          zenModeResetKey={`queued-message:${inlineEditingQueuedMessage.queuedMessageId}`}
          focusEndKey={`${inlineEditingQueuedMessage.editSessionId}:${editFocusNonce}`}
          isPrimaryComposer={false}
          showScrollToBottomButton={false}
        />
      ),
    };
  }, [
    dismissInlineQueuedMessageEditor,
    editFocusNonce,
    inlineAttachmentsConfig,
    inlineComposerConfig,
    inlineEditingQueuedMessage,
    inlineExecutionConfig,
    inlinePermissionConfig,
    promptActions,
    queuedComposerTextEffects,
    queuedPluginComposerHost,
    typeaheadConfig,
  ]);
  const promptStack = useMemo(
    () => (
      <>
        {activeWorkflows.map((workflow) => (
          <ThreadWorkflowCard
            key={workflow.id}
            workflow={workflow}
            isExpanded={expandedWorkflowIds.has(workflow.id)}
            onToggle={() => toggleWorkflowExpanded(workflow.id)}
          />
        ))}
        <ThreadBackgroundCommandsCard
          commands={activeBackgroundCommands}
          isExpanded={isBackgroundCommandsExpanded}
          onToggle={() => setIsBackgroundCommandsExpanded((value) => !value)}
        />
        {activePromptModeCard}
        {activeGoalCard}
        <ThreadTodoCard
          pendingTodos={
            thread.archivedAt === null && environmentGoneStatus === null
              ? pendingTodos
              : null
          }
          isExpanded={isTodoExpanded}
          onToggle={() => setIsTodoExpanded((value) => !value)}
        />
        <ThreadPromptContextBanner
          archivedSection={
            thread.archivedAt !== null
              ? {
                  archivedAt: thread.archivedAt,
                  onUnarchive: handleUnarchiveCurrentThread,
                  unarchivePending: isUnarchiveCurrentThreadPending,
                }
              : null
          }
          environmentGoneSection={
            environmentGoneStatus === null
              ? null
              : { status: environmentGoneStatus }
          }
          parentThreadSection={parentThreadSection}
          childThreadsSection={childThreadsSection}
          pullRequestSection={pullRequestSection}
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
        {modelFallback ? (
          <ThreadModelFallbackCard
            key={`${thread.id}:${modelFallback.sourceSeq}`}
            fallback={modelFallback}
            threadId={thread.id}
          />
        ) : null}
        {shouldHideComposer ? null : (
          <QueuedMessagesList
            queuedMessages={queuedMessages}
            resolveMentionLink={resolveMentionLink}
            inlineEditor={inlineEditor}
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
            onSetGroupBoundary={handleSetQueuedMessageGroupBoundary}
            onEdit={beginEditQueuedMessage}
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
      beginEditQueuedMessage,
      handlePromptBannerFileClick,
      handleReorderQueuedMessage,
      handleSendQueuedImmediately,
      handleSetQueuedMessageGroupBoundary,
      handleToggleBannerSection,
      handleUnarchiveCurrentThread,
      environmentGoneStatus,
      isFollowUpSubmitting,
      isUnarchiveCurrentThreadPending,
      isQueueMutationPending,
      inlineEditor,
      activeGoalCard,
      activePromptModeCard,
      isTodoExpanded,
      activeWorkflows,
      expandedWorkflowIds,
      toggleWorkflowExpanded,
      activeBackgroundCommands,
      isBackgroundCommandsExpanded,
      modelFallback,
      parentThreadSection,
      childThreadsSection,
      pullRequestSection,
      pendingTodos,
      displayedProcessingQueuedMessage,
      queuedMessages,
      resolveMentionLink,
      runtimeDisplayStatus,
      shouldHideComposer,
      submitMode.kind,
      thread.archivedAt,
      thread.id,
      workspaceChangedFilesSection,
      workspaceStatusPending,
    ],
  );

  if (activePendingInteraction && !shouldHideComposer) {
    const pendingInteractionComposer = isPluginPendingInteraction(
      activePendingInteraction,
    ) ? (
      <PluginPendingInteractionComposer
        interaction={activePendingInteraction}
      />
    ) : (
      <ThreadPendingInteractionBanner
        interaction={activePendingInteraction}
        threadId={thread.id}
      />
    );
    return (
      <div className="space-y-2">
        {activePromptMode ? activePromptModeCard : null}
        {goal ? activeGoalCard : null}
        <PluginComposerHostProvider value={normalPluginComposerHost}>
          <PluginComposerBanners
            view={{
              scope: normalPluginComposerHost.scope,
              layout: "expanded",
              draft: {
                text: normalPluginComposerHost.draft.text,
                isEmpty:
                  normalPluginComposerHost.draft.text.trim().length === 0 &&
                  normalPluginComposerHost.draft.attachments.length === 0,
                attachmentCount:
                  normalPluginComposerHost.draft.attachments.length,
              },
              run: { isRunning: false, isSubmitting: false },
            }}
          />
        </PluginComposerHostProvider>
        {pendingInteractionComposer}
      </div>
    );
  }

  return (
    <FollowUpPromptBox
      id={THREAD_DETAIL_COMPOSER_TEXTAREA_ID}
      attachments={bottomAttachmentsConfig}
      stack={promptStack}
      activePromptMode={activePromptMode}
      composer={shouldHideComposer ? null : bottomComposerConfig}
      pluginComposerHost={normalPluginComposerHost}
      pluginComposerScope={normalPluginComposerHost.scope}
      textEffects={promptTextEffects}
      zenModeResetKey={thread.id}
      focusEndKey={bottomFocusEndKey}
      environmentSummary={environmentSummary}
      contextWindowUsage={contextWindowUsage ?? null}
      execution={bottomExecutionConfig}
      permission={bottomPermissionConfig}
      typeahead={typeaheadConfig}
      promptActions={promptActions}
    />
  );
}
