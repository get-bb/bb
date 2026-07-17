import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { IconName } from "@bb/shared-ui/icon";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  getFollowUpPromptPlaceholder,
  getCompactFollowUpPromptPlaceholder,
} from "@/components/promptbox/follow-up-placeholder";
import { buildProviderPromptActionProps } from "@/components/promptbox/mentions/command-trigger";
import { isPluginPendingInteraction, PERSONAL_PROJECT_ID } from "@bb/domain";
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
  type QueuedMessageEditRequest,
  type QueuedMessageGroupBoundaryRequest,
  type QueuedMessageInlineEditor,
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
import { useProjectDisplayName } from "@/hooks/queries/sidebar-navigation-query";
import {
  useCreateThreadQueuedMessage,
  useDeleteThreadQueuedMessage,
  useReorderThreadQueuedMessage,
  useSendThreadQueuedMessage,
  useSetThreadQueuedMessageGroupBoundary,
  useStopThread,
  useUpdateThreadQueuedMessage,
} from "@/hooks/mutations/thread-runtime-mutations";
import { useUnarchiveThread } from "@/hooks/mutations/thread-state-mutations";
import {
  getLatestPendingInteraction,
  useThreadQueuedMessages,
  useThreadPromptHistory,
} from "@/hooks/queries/thread-queries";
import { useThreadDefaultExecutionOptions } from "@/hooks/queries/thread-default-execution-options-query";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { BbHttpError } from "@/lib/sdk";
import { promptHistoryEntriesToDrafts } from "@/lib/prompt-history";
import { promptDraftToInput } from "@/lib/prompt-draft";
import type { PromptDraftState } from "@/lib/prompt-draft";
import { getProjectComposeRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { buildThreadHandoffLocationState } from "@/lib/thread-handoff-request";
import { appToast } from "@/components/ui/app-toast";
import {
  FollowUpPromptBox,
  type FollowUpSubmitMode,
} from "@/components/promptbox/FollowUpPromptBox";
import { withAutomationPromptAction } from "@/components/promptbox/PromptBoxActionsMenu";
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

interface InlineQueuedMessageEditState {
  draft: PromptDraftState;
  editSessionId: number;
  expectedUpdatedAt: number;
  model: ThreadQueuedMessage["model"];
  ownerThreadId: string;
  permissionMode: ThreadQueuedMessage["permissionMode"];
  queuedMessageId: string;
  queuedMessageIndex: number;
  reasoningLevel: ThreadQueuedMessage["reasoningLevel"];
  serviceTier: ThreadQueuedMessage["serviceTier"];
}

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
  /** Running workflow row from the timeline. Null when no workflow is active. */
  activeWorkflow: TimelineWorkflowWorkRow | null;
  /** Running backgrounded shell command rows, most recent first. Empty when none. */
  activeBackgroundCommands: TimelineWorkflowWorkRow[];
  /** Parent reference for child threads. Null for root threads. */
  parentThreadSection: ThreadPromptParentThreadSection | null;
  /** Active child threads for parent threads. Null otherwise. */
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  /** Pull request summary for the active thread branch. Null when there is no PR. */
  pullRequest: ThreadPullRequest | null;
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
  activeWorkflow,
  activeBackgroundCommands,
  parentThreadSection,
  childThreadsSection,
  pullRequest,
  sendMessage,
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
  const [inlineEditingQueuedMessage, setInlineEditingQueuedMessage] =
    useState<InlineQueuedMessageEditState | null>(null);
  const inlineEditSessionIdRef = useRef(0);
  const [inlineComposerTarget, setInlineComposerTarget] =
    useState<HTMLDivElement | null>(null);
  const dismissInlineQueuedMessageEditor = useCallback(() => {
    setInlineComposerTarget(null);
    setInlineEditingQueuedMessage(null);
  }, []);
  useEffect(() => {
    if (
      inlineEditingQueuedMessage &&
      (inlineEditingQueuedMessage.ownerThreadId !== thread.id ||
        !queuedMessages.some(
          (message) =>
            message.id === inlineEditingQueuedMessage.queuedMessageId,
        ))
    ) {
      dismissInlineQueuedMessageEditor();
    }
  }, [
    dismissInlineQueuedMessageEditor,
    inlineEditingQueuedMessage,
    queuedMessages,
    thread.id,
  ]);
  const inlineEditor = useMemo<QueuedMessageInlineEditor | undefined>(
    () =>
      inlineEditingQueuedMessage
        ? {
            queuedMessageId: inlineEditingQueuedMessage.queuedMessageId,
            queuedMessageIndex: inlineEditingQueuedMessage.queuedMessageIndex,
            ready: true,
            onComposerTargetChange: setInlineComposerTarget,
            onDismiss: dismissInlineQueuedMessageEditor,
          }
        : undefined,
    [dismissInlineQueuedMessageEditor, inlineEditingQueuedMessage],
  );

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
    thread.id,
    {
      enabled: true,
    },
  );
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const updateQueuedMessage = useUpdateThreadQueuedMessage();
  const sendQueuedMessage = useSendThreadQueuedMessage();
  const deleteQueuedMessage = useDeleteThreadQueuedMessage();
  const reorderQueuedMessage = useReorderThreadQueuedMessage();
  const setQueuedMessageGroupBoundary =
    useSetThreadQueuedMessageGroupBoundary();
  const stopThread = useStopThread();
  const unarchiveThread = useUnarchiveThread();
  const uploadPromptAttachment = useUploadPromptAttachment();
  // The personal project isn't a meaningful label in the footer, so skip it.
  const projectName = useProjectDisplayName(
    thread.projectId === PERSONAL_PROJECT_ID ? undefined : thread.projectId,
  );
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
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
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
  const [isWorkflowExpanded, setIsWorkflowExpanded] = useState(false);
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
  const providerPromptActions = useMemo(
    () => buildProviderPromptActionProps(selectedProviderComposerActions),
    [selectedProviderComposerActions],
  );
  const providerPromptActionProps = useMemo(
    () => ({
      promptActions: withAutomationPromptAction(
        providerPromptActions.promptActions,
      ),
    }),
    [providerPromptActions.promptActions],
  );
  const commandSuggestions = useCommandSuggestions({
    projectId: thread.projectId,
    providerId: thread.providerId,
    skillsTrigger: providerPromptActions.skillsTrigger,
    promptActions: providerPromptActionProps.promptActions,
    environmentId: thread.environmentId,
    query: commandQuery,
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
    updateQueuedMessage.isPending ||
    sendQueuedMessage.isPending ||
    deleteQueuedMessage.isPending ||
    reorderQueuedMessage.isPending ||
    setQueuedMessageGroupBoundary.isPending ||
    isFollowUpShortcutSending;
  const isFollowUpSubmitting =
    sendMessage.isPending ||
    createQueuedMessage.isPending ||
    isFollowUpShortcutSending;
  const handleStopThread = useCallback(() => {
    stopThread.mutate(thread.id);
  }, [stopThread, thread.id]);
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
  const activeComposerDraft =
    inlineEditingQueuedMessage?.draft ?? currentPromptDraft;
  const activeComposerDraftInput = useMemo(
    () => promptDraftToInput(activeComposerDraft),
    [activeComposerDraft],
  );
  const setActiveComposerDraft = useCallback(
    (draft: PromptDraftState) => {
      if (inlineEditingQueuedMessage) {
        setInlineEditingQueuedMessage((current) =>
          current ? { ...current, draft } : current,
        );
        return;
      }
      promptDraft.setDraft(draft);
    },
    [inlineEditingQueuedMessage, promptDraft.setDraft],
  );
  const handleComposerMessageChange = useCallback(
    (text: string, mentions: PromptDraftState["mentions"]) => {
      if (inlineEditingQueuedMessage) {
        setInlineEditingQueuedMessage((current) =>
          current
            ? { ...current, draft: { ...current.draft, mentions, text } }
            : current,
        );
        return;
      }
      promptDraft.setTextAndMentions(text, mentions);
    },
    [inlineEditingQueuedMessage, promptDraft.setTextAndMentions],
  );
  const removeActiveComposerAttachment = useCallback(
    (path: string) => {
      if (inlineEditingQueuedMessage) {
        setInlineEditingQueuedMessage((current) =>
          current
            ? {
                ...current,
                draft: {
                  ...current.draft,
                  attachments: current.draft.attachments.filter(
                    (attachment) => attachment.path !== path,
                  ),
                },
              }
            : current,
        );
        return;
      }
      promptDraft.removeAttachment(path);
    },
    [inlineEditingQueuedMessage, promptDraft.removeAttachment],
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

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      const attachmentOwner = inlineEditingQueuedMessage
        ? {
            kind: "queued" as const,
            editSessionId: inlineEditingQueuedMessage.editSessionId,
            ownerThreadId: inlineEditingQueuedMessage.ownerThreadId,
            queuedMessageId: inlineEditingQueuedMessage.queuedMessageId,
          }
        : {
            addAttachment: promptDraft.addAttachment,
            kind: "bottom" as const,
          };
      setAttachmentError(null);
      const failedFiles: string[] = [];
      for (const file of files) {
        try {
          const uploaded = await uploadPromptAttachment.mutateAsync({
            projectId,
            file,
          });
          if (attachmentOwner.kind === "bottom") {
            attachmentOwner.addAttachment(uploaded);
          } else {
            setInlineEditingQueuedMessage((current) => {
              if (
                !current ||
                current.editSessionId !== attachmentOwner.editSessionId ||
                current.ownerThreadId !== attachmentOwner.ownerThreadId ||
                current.queuedMessageId !== attachmentOwner.queuedMessageId ||
                current.draft.attachments.some(
                  (existing) => existing.path === uploaded.path,
                )
              ) {
                return current;
              }
              return {
                ...current,
                draft: {
                  ...current.draft,
                  attachments: [...current.draft.attachments, uploaded],
                },
              };
            });
          }
        } catch {
          failedFiles.push(file.name);
        }
      }
      if (failedFiles.length > 0) {
        setAttachmentError(`Failed to attach: ${failedFiles.join(", ")}`);
      }
    },
    [
      inlineEditingQueuedMessage,
      projectId,
      promptDraft.addAttachment,
      uploadPromptAttachment,
    ],
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
  // Selection quotes and queued-message edits both need the composer caret at
  // the end of the latest draft; combine their counters into one focus key.
  const focusEndKey = `${composerFocusRequestNonce}:${editFocusNonce}`;

  const handleEditQueuedMessage = useCallback(
    ({ queuedMessageId, queuedMessageIndex }: QueuedMessageEditRequest) => {
      const queuedMessage = queuedMessagesByIdRef.current.get(queuedMessageId);
      if (!queuedMessage) {
        return;
      }

      setInlineEditingQueuedMessage({
        draft: queuedInputToDraft(queuedMessage.content),
        editSessionId: (inlineEditSessionIdRef.current += 1),
        expectedUpdatedAt: queuedMessage.updatedAt,
        model: queuedMessage.model,
        ownerThreadId: thread.id,
        permissionMode: queuedMessage.permissionMode,
        queuedMessageId,
        queuedMessageIndex,
        reasoningLevel: queuedMessage.reasoningLevel,
        serviceTier: queuedMessage.serviceTier,
      });
      setAttachmentError(null);
      // Focus the composer caret at the end so the restored draft is ready to
      // keep typing (FollowUpPromptBox `focusEndKey`).
      setEditFocusNonce((nonce) => nonce + 1);
    },
    [thread.id],
  );

  const handleSaveInlineQueuedMessage = useCallback(async () => {
    if (
      !inlineEditingQueuedMessage ||
      activeComposerDraftInput.length === 0 ||
      updateQueuedMessage.isPending
    ) {
      return;
    }
    if (
      inlineEditingQueuedMessage.ownerThreadId !== thread.id ||
      !queuedMessagesByIdRef.current.has(
        inlineEditingQueuedMessage.queuedMessageId,
      )
    ) {
      dismissInlineQueuedMessageEditor();
      return;
    }
    const { expectedUpdatedAt, ownerThreadId, queuedMessageId } =
      inlineEditingQueuedMessage;
    setProcessingQueuedMessage({ id: queuedMessageId, action: "edit" });
    try {
      await updateQueuedMessage.mutateAsync({
        expectedUpdatedAt,
        id: ownerThreadId,
        input: activeComposerDraftInput,
        queuedMessageId,
      });
      setAttachmentError(null);
      dismissInlineQueuedMessageEditor();
    } catch (nextError) {
      if (nextError instanceof BbHttpError && nextError.status === 404) {
        dismissInlineQueuedMessageEditor();
      }
      appToast.error(
        getMutationErrorMessage({
          error: nextError,
          fallbackMessage: "Failed to update queued message",
          lifecycleOperation: "update_queued_message",
        }),
      );
    } finally {
      setProcessingQueuedMessage((current) =>
        current?.id === queuedMessageId ? null : current,
      );
    }
  }, [
    activeComposerDraftInput,
    dismissInlineQueuedMessageEditor,
    inlineEditingQueuedMessage,
    thread.id,
    updateQueuedMessage,
  ]);

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

  const handleSetQueuedMessageGroupBoundary = useCallback(
    (request: QueuedMessageGroupBoundaryRequest) => {
      void setQueuedMessageGroupBoundary
        .mutateAsync({
          id: thread.id,
          ...request,
        })
        .catch((nextError) => {
          appToast.error(
            getMutationErrorMessage({
              error: nextError,
              fallbackMessage: "Failed to group queued messages",
              lifecycleOperation: "set_queued_message_group_boundary",
            }),
          );
        });
    },
    [setQueuedMessageGroupBoundary, thread.id],
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

  const attachmentsConfig = useMemo(
    () => ({
      items: activeComposerDraft.attachments,
      projectId,
      isAttaching: uploadPromptAttachment.isPending,
      error: attachmentError,
      onAttachFiles: handleAttachFiles,
      onRemove: removeActiveComposerAttachment,
    }),
    [
      activeComposerDraft.attachments,
      attachmentError,
      handleAttachFiles,
      projectId,
      removeActiveComposerAttachment,
      uploadPromptAttachment.isPending,
    ],
  );

  const handleComposerSubmit = useCallback(() => {
    if (inlineEditingQueuedMessage) {
      void handleSaveInlineQueuedMessage();
      return;
    }
    void handleSend();
  }, [handleSaveInlineQueuedMessage, handleSend, inlineEditingQueuedMessage]);
  const handleComposerModifierSubmit = useCallback(() => {
    if (inlineEditingQueuedMessage) {
      void handleSaveInlineQueuedMessage();
      return;
    }
    void handleModifierSubmit();
  }, [
    handleModifierSubmit,
    handleSaveInlineQueuedMessage,
    inlineEditingQueuedMessage,
  ]);

  const composerConfig = useMemo(
    () => ({
      history: {
        currentDraft: activeComposerDraft,
        entries: inlineEditingQueuedMessage ? [] : promptHistoryDrafts,
        onSelectEntry: setActiveComposerDraft,
        resetKey: thread.id,
      },
      isFollowUpSubmitting:
        isFollowUpSubmitting || updateQueuedMessage.isPending,
      message: activeComposerDraft.text,
      mentionRanges: activeComposerDraft.mentions,
      onChangeMessage: handleComposerMessageChange,
      onModifierSubmit: handleComposerModifierSubmit,
      onSubmit: handleComposerSubmit,
      compactPromptPlaceholder,
      promptPlaceholder,
      canModifierSubmit: inlineEditingQueuedMessage
        ? activeComposerDraftInput.length > 0 && !updateQueuedMessage.isPending
        : canSubmitModifierShortcut,
      submitMode: inlineEditingQueuedMessage
        ? ({ kind: "ready" } as const)
        : submitMode,
      threadRuntimeDisplayStatus: runtimeDisplayStatus,
    }),
    [
      activeComposerDraft,
      activeComposerDraftInput.length,
      canSubmitModifierShortcut,
      handleComposerModifierSubmit,
      handleComposerMessageChange,
      handleComposerSubmit,
      inlineEditingQueuedMessage,
      isFollowUpSubmitting,
      promptHistoryDrafts,
      setActiveComposerDraft,
      compactPromptPlaceholder,
      promptPlaceholder,
      runtimeDisplayStatus,
      submitMode,
      thread.id,
      updateQueuedMessage.isPending,
    ],
  );

  const executionConfig = useMemo(
    () => ({
      providerRouting: executionOptionsRouting,
      provider: {
        options: providerOptions,
        selectedId: selectedProviderId,
        hasMultiple: hasMultipleProviders,
        displayName: selectedProviderDisplayName,
      },
      model: {
        active: inlineEditingQueuedMessage
          ? { model: inlineEditingQueuedMessage.model }
          : effectiveSelectedModel
            ? { model: effectiveSelectedModel }
            : null,
        selected: inlineEditingQueuedMessage
          ? inlineEditingQueuedMessage.model
          : selectedModel,
        options: modelOptions,
        moreOptions: moreModelOptions,
        isLoading: isLoadingModels,
        loadFailed: modelLoadFailed,
        loadError: modelLoadError,
        onChange: handleModelChange,
      },
      serviceTier: {
        value: inlineEditingQueuedMessage
          ? inlineEditingQueuedMessage.serviceTier
          : serviceTier,
        onChange: setServiceTier,
        supported: supportsServiceTier,
        supportByProvider: serviceTierSupportByProvider,
      },
      reasoning: {
        value: inlineEditingQueuedMessage
          ? inlineEditingQueuedMessage.reasoningLevel
          : reasoningLevel,
        options: reasoningOptions,
        onChange: setReasoningLevel,
      },
      ...(inlineEditingQueuedMessage
        ? {}
        : {
            footerAction: {
              label: "Handoff to new thread",
              onClick: handleHandoffToNewThread,
            },
          }),
    }),
    [
      effectiveSelectedModel,
      executionOptionsRouting,
      hasMultipleProviders,
      handleHandoffToNewThread,
      handleModelChange,
      inlineEditingQueuedMessage,
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

  const permissionConfig = useMemo(
    () => ({
      value: inlineEditingQueuedMessage
        ? inlineEditingQueuedMessage.permissionMode
        : hasConcreteDefaultExecutionOptions
          ? permissionMode
          : undefined,
      options: hasConcreteDefaultExecutionOptions ? permissionModeOptions : [],
      onChange: setPermissionMode,
      supported:
        hasConcreteDefaultExecutionOptions && supportsPermissionModeSelection,
    }),
    [
      hasConcreteDefaultExecutionOptions,
      inlineEditingQueuedMessage,
      permissionMode,
      permissionModeOptions,
      setPermissionMode,
      supportsPermissionModeSelection,
    ],
  );

  const typeaheadConfig = useMemo(
    () => ({
      mention: {
        triggers: promptMentions.triggers,
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
      promptMentions.triggers,
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
        isExpanded={isPromptModeExpanded}
        onExitPlanMode={handleStopThread}
        onToggle={() => setIsPromptModeExpanded((value) => !value)}
      />
    ),
    [activePromptMode, handleStopThread, isPromptModeExpanded],
  );
  const promptStack = useMemo(
    () => (
      <>
        <ThreadWorkflowCard
          workflow={activeWorkflow}
          isExpanded={isWorkflowExpanded}
          onToggle={() => setIsWorkflowExpanded((value) => !value)}
        />
        <ThreadBackgroundCommandsCard
          commands={activeBackgroundCommands}
          isExpanded={isBackgroundCommandsExpanded}
          onToggle={() => setIsBackgroundCommandsExpanded((value) => !value)}
        />
        {activePromptModeCard}
        <ThreadGoalCard
          goal={goal}
          isExpanded={isGoalExpanded}
          onToggle={() => setIsGoalExpanded((value) => !value)}
        />
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
            onEdit={handleEditQueuedMessage}
            onDelete={handleDeleteQueuedMessage}
          />
        )}
        {modelFallback ? (
          <ThreadModelFallbackCard
            key={`${thread.id}:${modelFallback.sourceSeq}`}
            fallback={modelFallback}
            threadId={thread.id}
          />
        ) : null}
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
      handleSetQueuedMessageGroupBoundary,
      handleToggleBannerSection,
      handleUnarchiveCurrentThread,
      environmentGoneStatus,
      isFollowUpSubmitting,
      isUnarchiveCurrentThreadPending,
      isQueueMutationPending,
      inlineEditor,
      goal,
      activePromptModeCard,
      isGoalExpanded,
      isTodoExpanded,
      activeWorkflow,
      isWorkflowExpanded,
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
    if (isPluginPendingInteraction(activePendingInteraction)) {
      return (
        <PluginPendingInteractionComposer
          interaction={activePendingInteraction}
        />
      );
    }
    if (!activePromptMode) {
      return (
        <ThreadPendingInteractionBanner
          interaction={activePendingInteraction}
          threadId={thread.id}
        />
      );
    }
    return (
      <div className="space-y-2">
        {activePromptModeCard}
        <ThreadPendingInteractionBanner
          interaction={activePendingInteraction}
          threadId={thread.id}
        />
      </div>
    );
  }

  return (
    <FollowUpPromptBox
      id={THREAD_DETAIL_COMPOSER_TEXTAREA_ID}
      attachments={attachmentsConfig}
      stack={promptStack}
      activePromptMode={activePromptMode}
      composer={shouldHideComposer ? null : composerConfig}
      composerTarget={inlineComposerTarget}
      zenModeResetKey={thread.id}
      focusEndKey={focusEndKey}
      environmentSummary={environmentSummary}
      contextWindowUsage={contextWindowUsage ?? null}
      execution={executionConfig}
      executionReadOnly={inlineEditingQueuedMessage !== null}
      permission={permissionConfig}
      permissionReadOnly={inlineEditingQueuedMessage !== null}
      typeahead={typeaheadConfig}
      {...providerPromptActionProps}
    />
  );
}
