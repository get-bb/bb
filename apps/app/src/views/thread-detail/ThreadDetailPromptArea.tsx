import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { NavLink, useNavigate } from "react-router-dom";
import type { IconName } from "@bb/shared-ui/icon";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  getFollowUpPromptPlaceholder,
  getCompactFollowUpPromptPlaceholder,
} from "@/components/promptbox/follow-up-placeholder";
import { isPluginPendingInteraction, PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  EnvironmentStatus,
  PendingInteraction,
  PromptInput,
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
import type { ChildThreadPendingAttention } from "@/hooks/queries/child-thread-pending-interactions";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import { PluginPendingInteractionComposer } from "@/components/plugin/PluginPendingInteractionComposer";
import {
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
import { InlineMessageEditorFrame } from "@/components/promptbox/InlineMessageEditorFrame";
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
import { useLatestRef } from "@/hooks/useLatestRef";
import { useEscapeToHide } from "@/hooks/useEscapeToHide";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { useProjectDisplayName } from "@/hooks/queries/sidebar-navigation-query";
import {
  useActiveComposerDraft,
  useComposerAttachmentUploads,
  useDraftAttachmentUploads,
  useComposerTypeahead,
  useInlineQueuedMessageEditing,
  useQueuedMessageActions,
  type InlineQueuedMessageEditState,
} from "@/components/thread/embedded-chat";
import {
  useCreateThreadQueuedMessage,
  useCancelThreadPlan,
  useClearThreadGoal,
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
import { usePromptHistoryEnabled } from "@/hooks/usePromptHistoryEnabled";
import { getProjectComposeRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { buildThreadHandoffLocationState } from "@/lib/thread-handoff-request";
import { appToast } from "@/components/ui/app-toast";
import {
  promptDraftToInput,
  type PromptDraftAttachment,
  type PromptDraftState,
} from "@/lib/prompt-draft";
import {
  FollowUpPromptBox,
  type FollowUpComposerProps,
  type FollowUpPromptBoxProps,
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

export interface ThreadDetailSentMessageEdit {
  draft: PromptDraftState;
  hostElement: HTMLDivElement | null;
  isSubmitting: boolean;
  operationId: string;
  onCancel: () => void;
  onSubmit: (target: {
    execution: FollowUpExecutionSelection;
    input: PromptInput[];
  }) => void;
  updateDraft: (
    update: (current: PromptDraftState) => PromptDraftState,
  ) => void;
}

export const THREAD_DETAIL_COMPOSER_TEXTAREA_ID =
  "thread-detail-follow-up-composer";

interface ThreadDetailPromptAreaProps {
  activeBackgroundAgentCount: number;
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
  /** Machine of the thread's environment; routes host-scoped model catalogs by host. */
  environmentHostId?: string;
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
  /** Pending permission or question prompts from delegated child threads. */
  childPendingInteractions: readonly ChildThreadPendingAttention[];
  /** Active child threads for parent threads. Null otherwise. */
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  /** Pull request summary for the active thread branch. Null when there is no PR. */
  pullRequest: ThreadPullRequest | null;
  sendMessage: SendMessageMutationLike;
  /** Present only while a sent-message editor is mounted in the timeline. */
  sentMessageEdit?: ThreadDetailSentMessageEdit;
  steerActiveThreadOnEnter: boolean;
  /**
   * Bumped by the timeline host each time a quote is appended to the shared
   * draft via "Add to chat", so the composer can focus its caret at the end —
   * ready for the reply beneath the freshly inserted blockquote.
   */
  composerFocusRequestNonce: number;
  thread: ThreadWithRuntime;
}

interface InlineDraftComposerOptions {
  attachments: FollowUpPromptBoxProps["attachments"];
  canModifierSubmit: boolean;
  compactPromptPlaceholder: string;
  composerId: string;
  /** Live draft under edit; supplies the message text, mentions, and history draft. */
  draft: PromptDraftState;
  editFocusNonce: number;
  execution: FollowUpPromptBoxProps["execution"];
  /** Combined with editFocusNonce to focus the caret at the end per edit session. */
  focusSessionKey: string | number;
  historyResetKey: string;
  isSubmitting: boolean;
  onChangeMessage: FollowUpComposerProps["onChangeMessage"];
  onSelectHistoryEntry: (draft: PromptDraftState) => void;
  permission: FollowUpPromptBoxProps["permission"];
  pluginComposerHost: PluginComposerHost;
  promptActions: FollowUpPromptBoxProps["promptActions"];
  promptPlaceholder: string;
  submit: () => void;
  submitMode: FollowUpSubmitMode;
  submitTitle?: string;
  suppressPluginComposerCustomizations?: boolean;
  textEffects: FollowUpPromptBoxProps["textEffects"];
  threadRuntimeDisplayStatus: FollowUpComposerProps["threadRuntimeDisplayStatus"];
  typeahead: FollowUpPromptBoxProps["typeahead"];
  zenModeResetKey: string;
}

/**
 * The queued-message and sent-message inline editors render the same
 * FollowUpPromptBox shape: read-only execution/permission controls, no stack,
 * no environment summary, and a plugin-composer host bound to the draft under
 * edit. Only the draft accessors, submit wiring, and session keys differ, so
 * both call sites pass those in here and share the rest.
 */
function buildInlineDraftComposer(options: InlineDraftComposerOptions) {
  return (
    <FollowUpPromptBox
      id={options.composerId}
      attachments={options.attachments}
      stack={null}
      composer={{
        history: {
          currentDraft: options.draft,
          entries: [],
          onSelectEntry: options.onSelectHistoryEntry,
          resetKey: options.historyResetKey,
        },
        isFollowUpSubmitting: options.isSubmitting,
        message: options.draft.text,
        mentionRanges: options.draft.mentions,
        onChangeMessage: options.onChangeMessage,
        onModifierSubmit: options.submit,
        onSubmit: options.submit,
        submitTitle: options.submitTitle,
        compactPromptPlaceholder: options.compactPromptPlaceholder,
        promptPlaceholder: options.promptPlaceholder,
        canModifierSubmit: options.canModifierSubmit,
        steerActiveThreadOnEnter: false,
        submitMode: options.submitMode,
        threadRuntimeDisplayStatus: options.threadRuntimeDisplayStatus,
      }}
      pluginComposerHost={options.pluginComposerHost}
      pluginComposerScope={options.pluginComposerHost.scope}
      suppressPluginComposerCustomizations={
        options.suppressPluginComposerCustomizations
      }
      textEffects={options.textEffects}
      environmentSummary={null}
      contextWindowUsage={null}
      execution={options.execution}
      executionReadOnly
      permission={options.permission}
      permissionReadOnly
      typeahead={options.typeahead}
      promptActions={options.promptActions}
      zenModeResetKey={options.zenModeResetKey}
      focusEndKey={`${options.focusSessionKey}:${options.editFocusNonce}`}
      isPrimaryComposer={false}
      showScrollToBottomButton={false}
    />
  );
}

type InlineQueuedMessageEditSession = Pick<
  InlineQueuedMessageEditState,
  "editSessionId" | "queuedMessageId"
>;

function isInlineQueuedMessageEditSession(
  current: InlineQueuedMessageEditState | null,
  session: InlineQueuedMessageEditSession,
): current is InlineQueuedMessageEditState {
  return (
    current?.editSessionId === session.editSessionId &&
    current.queuedMessageId === session.queuedMessageId
  );
}

/** Plugin composer-host accessors for the queued-message inline editor (see below). */
function readInlineQueuedMessageDraft(
  editStateRef: RefObject<InlineQueuedMessageEditState | null>,
  session: InlineQueuedMessageEditSession,
  fallback: PromptDraftState,
): PromptDraftState {
  const current = editStateRef.current;
  return isInlineQueuedMessageEditSession(current, session)
    ? current.draft
    : fallback;
}

function writeInlineQueuedMessageDraft(
  editStateRef: RefObject<InlineQueuedMessageEditState | null>,
  session: InlineQueuedMessageEditSession,
  draft: PromptDraftState,
  commit: (next: InlineQueuedMessageEditState) => void,
): void {
  const current = editStateRef.current;
  if (isInlineQueuedMessageEditSession(current, session)) {
    commit({ ...current, draft });
  }
}

/**
 * Plugin composer-host accessors for the sent-message inline editor. Module
 * level on purpose: inlined closures that return `ref.current.draft` in one
 * branch and the render-time `draft` in another make React Compiler type the
 * whole edit object as a ref value and bail out of the component.
 */
function readSentMessageEditDraft(
  sentMessageEditRef: RefObject<ThreadDetailSentMessageEdit | undefined>,
  operationId: string,
  fallback: PromptDraftState,
): PromptDraftState {
  const current = sentMessageEditRef.current;
  return current?.operationId === operationId ? current.draft : fallback;
}

function writeSentMessageEditDraft(
  sentMessageEditRef: RefObject<ThreadDetailSentMessageEdit | undefined>,
  operationId: string,
  nextDraft: PromptDraftState,
): void {
  const current = sentMessageEditRef.current;
  if (current?.operationId === operationId) {
    current.updateDraft(() => nextDraft);
  }
}

/**
 * Flip the "sending" flag around a task. Kept outside the component: React
 * Compiler bails out of any function containing `try`/`finally`, and one such
 * block inside `ThreadDetailPromptArea` left the whole ~1600-line body
 * unmemoized.
 */
async function runWhileFollowUpShortcutSending(
  setSending: (sending: boolean) => void,
  task: () => Promise<void>,
): Promise<void> {
  setSending(true);
  try {
    await task();
  } finally {
    setSending(false);
  }
}

export function ThreadDetailPromptArea({
  activeBackgroundAgentCount,
  canUseGitUi,
  contextWindowUsage,
  environmentCheckout,
  environmentCompactLabel,
  environmentGoneStatus,
  environmentHostId,
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
  childPendingInteractions,
  childThreadsSection,
  pullRequest,
  sendMessage,
  sentMessageEdit,
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
  // A replayed (placeholder) resolution seeds the pickers so the first frame
  // shows the thread's last-known settings, but it is not proof of anything:
  // submission and the permission controls wait for the live resolution.
  const verifiedDefaultExecutionOptions =
    defaultExecutionOptionsQuery.isPlaceholderData
      ? undefined
      : defaultExecutionOptions;
  const hasResolvedDefaultExecutionOptions =
    verifiedDefaultExecutionOptions !== undefined;
  const hasConcreteDefaultExecutionOptions =
    verifiedDefaultExecutionOptions !== undefined &&
    verifiedDefaultExecutionOptions !== null;
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
  const queuedMessagesRef =
    useLatestRef<readonly ThreadQueuedMessage[]>(queuedMessages);
  const [bottomPluginFocusNonce, setBottomPluginFocusNonce] = useState(0);
  const [editFocusNonce, setEditFocusNonce] = useState(0);
  const focusBottomPluginComposer = useCallback(() => {
    setBottomPluginFocusNonce((nonce) => nonce + 1);
  }, []);
  const focusInlinePluginComposer = useCallback(() => {
    setEditFocusNonce((nonce) => nonce + 1);
  }, []);
  const sentMessageEditRef = useLatestRef(sentMessageEdit);
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
  const promptHistoryEnabled = usePromptHistoryEnabled();
  const { data: promptHistoryEntries = [] } = useThreadPromptHistory(
    thread.id,
    {
      enabled: promptHistoryEnabled,
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
  const updateSentMessageEditDraft = sentMessageEdit?.updateDraft;
  const addSentMessageEditAttachment = useCallback(
    (attachment: PromptDraftAttachment) => {
      updateSentMessageEditDraft?.((current) =>
        current.attachments.some(
          (existing) => existing.path === attachment.path,
        )
          ? current
          : {
              ...current,
              attachments: [...current.attachments, attachment],
            },
      );
    },
    [updateSentMessageEditDraft],
  );
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
  const {
    attachmentError: sentMessageAttachmentError,
    handleAttachFiles: handleAttachSentMessageFiles,
    isAttachingFiles: isAttachingSentMessageFiles,
  } = useDraftAttachmentUploads({
    projectId,
    target: sentMessageEdit
      ? {
          key: sentMessageEdit.operationId,
          addAttachment: addSentMessageEditAttachment,
        }
      : null,
  });
  // Read only from the queued-message edit handler (never during render), so
  // a layout-effect write is current by the time it can run.
  useLayoutEffect(() => {
    clearInlineAttachmentErrorRef.current = () =>
      setInlineAttachmentError(null);
  }, [setInlineAttachmentError]);
  const promptTextEffects = useComposerTextEffects(promptDraft.storageKey);
  const queuedComposerTextEffects = useComposerTextEffects(
    inlineEditingQueuedMessage
      ? `queued-message:${thread.id}:${inlineEditingQueuedMessage.queuedMessageId}:${inlineEditingQueuedMessage.editSessionId}`
      : null,
  );
  const sentMessageComposerTextEffects = useComposerTextEffects(
    sentMessageEdit
      ? `sent-message:${thread.id}:${sentMessageEdit.operationId}`
      : null,
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
    environmentHostId,
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
  const isFollowUpSubmitting =
    sendMessage.isPending ||
    createQueuedMessage.isPending ||
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
  const normalPluginComposerHost = useMemo<PluginComposerHost>(
    () => ({
      ...normalPluginComposerHostBinding,
      draft: currentPromptDraft,
    }),
    [currentPromptDraft, normalPluginComposerHostBinding],
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
    const isQueuingMessage = shouldQueueFollowUpMessage(runtimeDisplayStatus);
    if (
      submittedInput.length === 0 ||
      (!isQueuingMessage && isDefaultExecutionOptionsLoading)
    ) {
      return;
    }

    promptDraft.clearIfCurrentMatches(submittedDraft);
    setBottomAttachmentError(null);

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
    const shortcutRequest = buildFollowUpShortcutRequest({
      input: submittedInput,
      queuedMessages: queuedMessagesRef.current,
      threadId: thread.id,
    });
    if (!shortcutRequest) {
      return;
    }

    if (shortcutRequest.kind === "draft") {
      promptDraft.clearIfCurrentMatches(submittedDraft);
      setBottomAttachmentError(null);
      await runWhileFollowUpShortcutSending(
        setIsFollowUpShortcutSending,
        async () => {
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
          }
        },
      );
      return;
    }

    const queuedMessageId = shortcutRequest.request.queuedMessageId;
    if (queuedMessagesRef.current[0]?.id !== queuedMessageId) {
      return;
    }

    await runWhileFollowUpShortcutSending(
      setIsFollowUpShortcutSending,
      async () => {
        await sendQueuedMessageById({
          guard: "current-head",
          messageId: queuedMessageId,
        });
      },
    );
  }, [
    canSubmitModifierShortcut,
    currentPromptDraft,
    currentPromptDraftInput,
    promptDraft,
    queuedMessagesRef,
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
  const sentMessageEditInput = useMemo(
    () => (sentMessageEdit ? promptDraftToInput(sentMessageEdit.draft) : []),
    [sentMessageEdit],
  );
  const canSubmitSentMessageEdit =
    sentMessageEdit !== undefined &&
    sentMessageEditInput.length > 0 &&
    submitMode.kind === "ready" &&
    !shouldHideComposer &&
    !isDefaultExecutionOptionsLoading &&
    !isAttachingSentMessageFiles &&
    !isFollowUpSubmitting &&
    !isQueueMutationPending &&
    !sentMessageEdit.isSubmitting &&
    queuedMessages.length === 0 &&
    activeBackgroundAgentCount === 0 &&
    activeWorkflows.length === 0 &&
    activeBackgroundCommands.length === 0;
  // Empty input renders as "ready" with a no-op submit, matching the queued
  // inline editor; handleSentMessageEditSubmit guards on canSubmitSentMessageEdit.
  const sentMessageEditSubmitMode = useMemo<FollowUpSubmitMode>(
    () =>
      canSubmitSentMessageEdit || sentMessageEditInput.length === 0
        ? { kind: "ready" }
        : submitMode.kind === "blocked"
          ? submitMode
          : { kind: "blocked", reason: "unavailable" },
    [canSubmitSentMessageEdit, sentMessageEditInput.length, submitMode],
  );
  const handleSentMessageEditSubmit = useCallback(() => {
    if (!sentMessageEdit || !canSubmitSentMessageEdit) {
      return;
    }
    sentMessageEdit.onSubmit({
      execution: followUpExecutionSelection,
      input: sentMessageEditInput,
    });
  }, [
    canSubmitSentMessageEdit,
    followUpExecutionSelection,
    sentMessageEdit,
    sentMessageEditInput,
  ]);
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
  const compactExecutionConfig = useMemo(() => {
    const { footerAction: _footerAction, ...executionWithoutFooterAction } =
      bottomExecutionConfig;
    return executionWithoutFooterAction;
  }, [bottomExecutionConfig]);
  const inlineExecutionConfig = useMemo(() => {
    if (!inlineEditingQueuedMessage) return null;
    return {
      ...compactExecutionConfig,
      model: {
        ...compactExecutionConfig.model,
        active: { model: inlineEditingQueuedMessage.model },
        selected: inlineEditingQueuedMessage.model,
      },
      serviceTier: {
        ...compactExecutionConfig.serviceTier,
        value: inlineEditingQueuedMessage.serviceTier,
      },
      reasoning: {
        ...compactExecutionConfig.reasoning,
        value: inlineEditingQueuedMessage.reasoningLevel,
      },
    };
  }, [compactExecutionConfig, inlineEditingQueuedMessage]);

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
  const queuedMessageEditor = useMemo(() => {
    if (
      !inlineEditingQueuedMessage ||
      !inlineExecutionConfig ||
      !inlinePermissionConfig
    ) {
      return null;
    }
    const {
      draft: initialDraft,
      editSessionId,
      queuedMessageId,
    } = inlineEditingQueuedMessage;
    const session = { editSessionId, queuedMessageId };
    const pluginComposerHost: PluginComposerHost = {
      scope: {
        kind: "queued-message",
        threadId: thread.id,
        queuedMessageId,
      },
      textEffectKey: `queued-message:${thread.id}:${queuedMessageId}:${editSessionId}`,
      draft: activeComposerDraft,
      getCurrent: () =>
        readInlineQueuedMessageDraft(
          inlineEditingQueuedMessageRef,
          session,
          initialDraft,
        ),
      setDraft: (draft) =>
        writeInlineQueuedMessageDraft(
          inlineEditingQueuedMessageRef,
          session,
          draft,
          commitInlineQueuedMessage,
        ),
      focus: focusInlinePluginComposer,
    };
    const inlineEditor: QueuedMessageInlineEditor = {
      queuedMessageId,
      queuedMessageIndex: inlineEditingQueuedMessage.queuedMessageIndex,
      onDismiss: dismissInlineQueuedMessageEditor,
      content: buildInlineDraftComposer({
        attachments: {
          items: activeComposerDraft.attachments,
          projectId,
          isAttaching: isAttachingInlineFiles,
          error: inlineAttachmentError,
          onAttachFiles: handleAttachInlineFiles,
          onRemove: removeActiveComposerAttachment,
        },
        canModifierSubmit:
          activeComposerDraftInput.length > 0 && !isUpdateQueuedMessagePending,
        compactPromptPlaceholder,
        composerId: `${THREAD_DETAIL_COMPOSER_TEXTAREA_ID}-queued-${queuedMessageId}`,
        draft: activeComposerDraft,
        editFocusNonce,
        execution: inlineExecutionConfig,
        focusSessionKey: editSessionId,
        historyResetKey: `${thread.id}:${editSessionId}`,
        isSubmitting: isUpdateQueuedMessagePending,
        onChangeMessage: handleComposerMessageChange,
        onSelectHistoryEntry: setActiveComposerDraft,
        permission: inlinePermissionConfig,
        pluginComposerHost,
        promptActions,
        promptPlaceholder,
        submit: handleInlineComposerSubmit,
        submitMode: { kind: "ready" },
        textEffects: queuedComposerTextEffects,
        threadRuntimeDisplayStatus: runtimeDisplayStatus,
        typeahead: typeaheadConfig,
        zenModeResetKey: `queued-message:${queuedMessageId}`,
      }),
    };
    return { inlineEditor, pluginComposerHost };
  }, [
    activeComposerDraft,
    activeComposerDraftInput.length,
    commitInlineQueuedMessage,
    compactPromptPlaceholder,
    dismissInlineQueuedMessageEditor,
    editFocusNonce,
    focusInlinePluginComposer,
    handleAttachInlineFiles,
    handleComposerMessageChange,
    handleInlineComposerSubmit,
    inlineAttachmentError,
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    inlineExecutionConfig,
    inlinePermissionConfig,
    isAttachingInlineFiles,
    isUpdateQueuedMessagePending,
    projectId,
    promptActions,
    promptPlaceholder,
    queuedComposerTextEffects,
    removeActiveComposerAttachment,
    runtimeDisplayStatus,
    setActiveComposerDraft,
    thread.id,
    typeaheadConfig,
  ]);
  usePublishPluginComposerHost(
    queuedMessageEditor?.pluginComposerHost ?? normalPluginComposerHost,
  );
  const sentMessageEditorPortal = useMemo(() => {
    if (!sentMessageEdit?.hostElement) {
      return null;
    }
    const { draft, hostElement, operationId } = sentMessageEdit;
    return createPortal(
      <InlineMessageEditorFrame
        cancelLabel="Stop editing sent message"
        label="Editing message"
        onCancel={sentMessageEdit.onCancel}
        variant="cap"
      >
        {buildInlineDraftComposer({
          attachments: {
            items: draft.attachments,
            projectId,
            isAttaching: isAttachingSentMessageFiles,
            error: sentMessageAttachmentError,
            onAttachFiles: handleAttachSentMessageFiles,
            onRemove: (path) => {
              sentMessageEdit.updateDraft((current) => ({
                ...current,
                attachments: current.attachments.filter(
                  (attachment) => attachment.path !== path,
                ),
              }));
            },
          },
          canModifierSubmit: canSubmitSentMessageEdit,
          compactPromptPlaceholder: "Edit message",
          composerId: `${THREAD_DETAIL_COMPOSER_TEXTAREA_ID}-sent-${operationId}`,
          draft,
          editFocusNonce,
          execution: compactExecutionConfig,
          focusSessionKey: operationId,
          historyResetKey: `${thread.id}:${operationId}`,
          isSubmitting: sentMessageEdit.isSubmitting,
          onChangeMessage: (text, mentions) =>
            sentMessageEdit.updateDraft((current) => ({
              ...current,
              text,
              mentions,
            })),
          onSelectHistoryEntry: (nextDraft) =>
            sentMessageEdit.updateDraft(() => nextDraft),
          permission: bottomPermissionConfig,
          pluginComposerHost: {
            scope: { kind: "thread", threadId: thread.id },
            textEffectKey: `sent-message:${thread.id}:${operationId}`,
            draft,
            getCurrent: () =>
              readSentMessageEditDraft(sentMessageEditRef, operationId, draft),
            setDraft: (nextDraft) =>
              writeSentMessageEditDraft(
                sentMessageEditRef,
                operationId,
                nextDraft,
              ),
            focus: focusInlinePluginComposer,
          },
          promptActions,
          promptPlaceholder: "Edit message",
          submit: handleSentMessageEditSubmit,
          submitMode: sentMessageEditSubmitMode,
          submitTitle: "Submit edit (Enter)",
          suppressPluginComposerCustomizations: true,
          textEffects: sentMessageComposerTextEffects,
          threadRuntimeDisplayStatus: runtimeDisplayStatus,
          typeahead: typeaheadConfig,
          zenModeResetKey: `sent-message:${operationId}`,
        })}
      </InlineMessageEditorFrame>,
      hostElement,
    );
  }, [
    bottomPermissionConfig,
    canSubmitSentMessageEdit,
    compactExecutionConfig,
    editFocusNonce,
    focusInlinePluginComposer,
    handleAttachSentMessageFiles,
    handleSentMessageEditSubmit,
    isAttachingSentMessageFiles,
    projectId,
    promptActions,
    runtimeDisplayStatus,
    sentMessageAttachmentError,
    sentMessageComposerTextEffects,
    sentMessageEdit,
    sentMessageEditRef,
    sentMessageEditSubmitMode,
    thread.id,
    typeaheadConfig,
  ]);
  const childPendingInteractionBanners = useMemo(
    () =>
      childPendingInteractions.map((item) =>
        isPluginPendingInteraction(item.interaction) ? (
          <div key={item.interaction.id}>
            <NavLink
              to={item.href}
              className="mb-1 block text-xs text-muted-foreground no-underline hover:underline"
            >
              From child thread: {item.childTitle}
            </NavLink>
            <PluginPendingInteractionComposer interaction={item.interaction} />
          </div>
        ) : (
          <ThreadPendingInteractionBanner
            key={item.interaction.id}
            interaction={item.interaction}
            sourceThread={{ href: item.href, title: item.childTitle }}
            threadId={item.childThreadId}
          />
        ),
      ),
    [childPendingInteractions],
  );
  const promptStack = useMemo(
    () => (
      <>
        {childPendingInteractionBanners}
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
            inlineEditor={queuedMessageEditor?.inlineEditor}
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
      childPendingInteractionBanners,
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
      queuedMessageEditor,
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

  // A pending permission/question takes the composer's place, but the
  // composer itself stays mounted (hidden) inside FollowUpPromptBox so the
  // TipTap editor, draft and pickers survive every approval instead of being
  // rebuilt per interaction (submitMode is already "blocked" here). The
  // interaction shows as the last stack item above a reduced stack: child
  // banners, plan mode and goal cards, plus plugin banners.
  const pendingInteractionNode = useMemo(() => {
    if (!activePendingInteraction || shouldHideComposer) {
      return null;
    }
    return isPluginPendingInteraction(activePendingInteraction) ? (
      <PluginPendingInteractionComposer
        interaction={activePendingInteraction}
      />
    ) : (
      <ThreadPendingInteractionBanner
        interaction={activePendingInteraction}
        threadId={thread.id}
      />
    );
  }, [activePendingInteraction, shouldHideComposer, thread.id]);
  const pendingInteractionStack = useMemo(
    () => (
      <>
        {childPendingInteractionBanners}
        {activePromptMode ? activePromptModeCard : null}
        {goal ? activeGoalCard : null}
      </>
    ),
    [
      activeGoalCard,
      activePromptMode,
      activePromptModeCard,
      childPendingInteractionBanners,
      goal,
    ],
  );

  const bottomContent = (
    <FollowUpPromptBox
      id={THREAD_DETAIL_COMPOSER_TEXTAREA_ID}
      attachments={bottomAttachmentsConfig}
      stack={pendingInteractionNode ? pendingInteractionStack : promptStack}
      pendingInteraction={pendingInteractionNode}
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

  return (
    <>
      {sentMessageEditorPortal}
      {bottomContent}
    </>
  );
}
