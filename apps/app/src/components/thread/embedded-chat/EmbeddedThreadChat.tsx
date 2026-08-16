import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  defaultAppSettings,
  type PermissionMode,
  type PromptInput,
  type ReasoningLevel,
  type ServiceTier,
  type ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import type {
  AttachmentsConfig,
  HistoryConfig,
} from "@/components/promptbox/PromptBoxInternal";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { cn } from "@bb/shared-ui/lib/utils";
import { BottomAnchoredScrollBody } from "@/components/ui/bottom-anchored-scroll-body";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  FollowUpPromptBox,
  type FollowUpComposerProps,
} from "@/components/promptbox/FollowUpPromptBox";
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import {
  QueuedMessagesList,
  type QueuedMessageInlineEditor,
} from "@/components/promptbox/banner/QueuedMessagesList";
import type {
  ExecutionControlsProps,
  ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import { OverflowFade } from "@/components/ui/overflow-fade";
import {
  ThreadTimelinePanelContent,
  ThreadTimelineSurface,
  type ThreadTimelineAddToChatHandler,
  type ThreadTimelineConsumerMessageAction,
  type ThreadTimelineLinkHandler,
  type ThreadTimelineLocalFileLinkHandler,
  type ThreadTimelineRowFilter,
  type ThreadTimelineSendToMainMessageHandler,
  type ThreadTimelineSurfaceProps,
  type UseThreadTimelineControllerResult,
} from "@/components/thread/timeline";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import {
  getLatestPendingInteraction,
  useThread,
  useThreadPendingInteractions,
  useThreadQueuedMessages,
} from "@/hooks/queries/thread-queries";
import { useThreadDefaultExecutionOptions } from "@/hooks/queries/thread-default-execution-options-query";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  useCreateThreadQueuedMessage,
  useSendThreadMessage,
  useStopThread,
} from "@/hooks/mutations/thread-runtime-mutations";
import { useMarkThreadRead } from "@/hooks/mutations/thread-state-mutations";
import { useThreadReadTracking } from "@/hooks/useThreadReadTracking";
import { useComposerTextEffects } from "@/lib/composer-text-effects";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type { PromptDraftScope } from "@/hooks/usePromptDraftStorage";
import { appToast } from "@/components/ui/app-toast";
import {
  buildSideChatSubmitMode,
  canSubmitFollowUpShortcut,
  shouldQueueFollowUpMessage,
} from "@/views/thread-detail/threadDetailPromptSubmission";
import { useActiveComposerDraft } from "./useActiveComposerDraft";
import { useComposerAttachmentUploads } from "./useComposerAttachmentUploads";
import { useComposerTypeahead } from "./useComposerTypeahead";
import { useInlineQueuedMessageEditing } from "./useInlineQueuedMessageEditing";
import { useQueuedMessageActions } from "./useQueuedMessageActions";

let pluginComposerHostOwnershipSequence = 0;

function createPluginComposerHostIdentity(scopeIdentity: string): string {
  pluginComposerHostOwnershipSequence += 1;
  return `${scopeIdentity}:ownership:${pluginComposerHostOwnershipSequence}`;
}

/**
 * Hides thread-provisioning operation rows — an embedded chat panel renders its
 * own provisioning label, so the timeline row would duplicate it.
 */
export const hideProvisioningTimelineRow: ThreadTimelineRowFilter = (row) =>
  !(
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind === "thread-provisioning"
  );

export interface EmbeddedThreadChatLabels {
  /** Composer placeholder while the thread is idle/active. */
  placeholder: string;
  stopping: string;
  provisioning: string;
  compactProvisioning?: string;
  missingThread: string;
  timelineError: string;
  /** Ongoing-indicator label while submitting in draft mode (no thread yet). */
  draftSubmitting: string;
  sendError: string;
}

const DEFAULT_LABELS: EmbeddedThreadChatLabels = {
  placeholder: "Reply…",
  stopping: "Stopping thread...",
  provisioning: "Provisioning thread...",
  missingThread: "This thread is no longer available.",
  timelineError: "Failed to load timeline",
  draftSubmitting: "Starting thread...",
  sendError: "Failed to send message",
};

export interface EmbeddedThreadChatExecutionContext {
  model: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  /** The resolved default (snapshot policy) or picked (editable policy) mode. */
  permissionMode: PermissionMode | undefined;
  /** Optional execution overrides in send/queue request field shape. */
  executionRequestFields: {
    model?: string;
    permissionMode?: PermissionMode;
    reasoningLevel?: ReasoningLevel;
    serviceTier?: ServiceTier;
  };
  displayStatus: ThreadRuntimeDisplayStatus;
}

export interface EmbeddedThreadChatComposerProps {
  draftScope: PromptDraftScope;
  /** Thread whose resolved defaults seed the execution controls (the parent thread while drafting). */
  executionDefaultsThreadId: string;
  executionResetKey: string;
  executionEnvironmentId?: string;
  /** Machine of `executionEnvironmentId`; lets host-scoped catalogs share one query across environments. */
  executionEnvironmentHostId?: string;
  /**
   * Defer model/permission metadata loading until the surface first becomes
   * active — lets a retained hidden panel's first paint win over host-backed
   * model discovery.
   */
  deferExecutionOptionsUntilActive?: boolean;
  permissionPolicy: "editable" | "snapshot";
  environmentSummary: ReactNode;
  /** Plugin composer host scope for the bottom draft. Null disables the host. */
  pluginComposerBottomScope?: PluginComposerHost["scope"] | null;
  /** Identity string namespacing this composer among retained instances. */
  composerIdentity?: string;
  /** ORed into queue-pending guards for consumer-owned submit mutations. */
  isExternalSubmitPending?: boolean;
  /**
   * Consumer-owned bottom-draft submit (e.g. side chat lazy create-on-first-send).
   * When omitted the component queues/sends to `threadId` itself.
   */
  onSendOrQueueInput?: (
    input: PromptInput[],
    context: EmbeddedThreadChatExecutionContext,
  ) => Promise<void>;
  /** Called with the submitted input right before the draft clears. */
  onDraftSubmitted?: (input: PromptInput[]) => void;
  /** Called when a bottom-draft submit fails, before the draft restores. */
  onDraftSubmitError?: () => void;
  /**
   * External focus nonce: every change focuses the composer caret at the end
   * of the draft (the initial value does not). Combined with the component's
   * own internal focus nonce.
   */
  focusRequestKey?: number;
}

interface EmbeddedThreadChatSharedProps {
  threadId: string | null;
  /** Stable surface identity while `threadId` is null (draft mode). */
  surfaceFallbackKey?: string;
  projectId: string;
  providerId: string;
  /** Environment context for mentions and command suggestions. */
  promptContextEnvironmentId: string | null;
  /** Retained hidden surfaces pass false to pause read tracking + composer customizations. */
  isActive?: boolean;
  resolveMentionLink: PromptMentionLinkResolver;
  timeline?: UseThreadTimelineControllerResult;
  rowFilter?: ThreadTimelineRowFilter;
  leadingContent?: ReactNode;
  /** Surface-scoped consumer actions for the per-message action bar. */
  consumerMessageActions?: readonly ThreadTimelineConsumerMessageAction[];
  /**
   * Whether slot-registered plugin message actions render in this surface's
   * timeline. Embedded consumers (plugin ThreadChat, the side-chat panel)
   * pass false; the main thread keeps the default.
   */
  includePluginMessageActions?: boolean;
  /** Rows rendered while `threadId` is null (e.g. an optimistic first message). */
  draftModeTimelineRows?: readonly TimelineRow[];
  labels?: Partial<EmbeddedThreadChatLabels>;
  showLoadOlderRows?: boolean;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
  onSendToMainMessage?: ThreadTimelineSendToMainMessageHandler;
  /** Workspace root used to resolve relative links in timeline Markdown. */
  workspaceRootPath?: string;
  /**
   * "contained" (default) fills and scrolls inside a bounded parent;
   * "document" grows with its content and defers scrolling to the page (no
   * bottom-anchored scroll body, so no follow-the-stream behavior).
   */
  layout?: "contained" | "document";
  /**
   * Content measure: "panel" (default) is the edge-to-edge side-panel
   * presentation; "page" centers the conversation at reading width.
   */
  measure?: "panel" | "page";
}

export interface EmbeddedThreadChatComposerModeProps extends EmbeddedThreadChatSharedProps {
  variant: "compact";
  /** Background shared by the timeline, footer, and its overflow fade. */
  surfaceTone?: "background" | "sidebar";
  composer: EmbeddedThreadChatComposerProps;
  footer?: never;
}

/**
 * The full-page presentation with an externally-owned composer footer. The main
 * thread view keeps its chrome-heavy composer (context banners, git, goal cards)
 * outside for now; it shares the same engine hooks this component uses.
 */
export interface EmbeddedThreadChatHostedFooterProps {
  variant: "hosted-footer";
  threadId: string;
  footer: ReactNode;
  scrollOverlay?: ReactNode;
  surface: ThreadTimelineSurfaceProps;
  composer?: never;
}

export type EmbeddedThreadChatProps =
  | EmbeddedThreadChatComposerModeProps
  | EmbeddedThreadChatHostedFooterProps;

/**
 * One thread's chat — timeline plus composer — embeddable in a side panel
 * ("compact") or as the main conversation surface ("hosted-footer"). Owns
 * timeline
 * loading (when no controller is injected), realtime cache updates, drafts,
 * send/queue/steer/stop, queued-message editing, attachments, mentions,
 * execution controls, and read tracking.
 */
export function EmbeddedThreadChat(props: EmbeddedThreadChatProps) {
  if (props.variant === "hosted-footer") {
    return <EmbeddedThreadChatHostedFooter {...props} />;
  }
  return <EmbeddedThreadChatWithComposer {...props} />;
}

function EmbeddedThreadChatHostedFooter({
  threadId,
  footer,
  scrollOverlay,
  surface,
}: EmbeddedThreadChatHostedFooterProps) {
  return (
    <div
      data-thread-window=""
      className="flex h-full min-h-0 min-w-0 flex-col overflow-clip"
    >
      <PageShell
        key={threadId}
        scrollBehavior="bottom-anchor"
        scrollAnchorThreadId={threadId}
        shellClassName="!mx-0 !mt-0 md:!mx-0 md:!mt-0"
        contentClassName="gap-2 pt-4"
        footerClassName="chat-prompt-box"
        footer={footer}
        scrollOverlay={scrollOverlay}
      >
        <ThreadTimelineSurface {...surface} />
      </PageShell>
    </div>
  );
}

function EmbeddedThreadChatWithComposer({
  threadId,
  surfaceFallbackKey,
  projectId,
  providerId,
  promptContextEnvironmentId,
  isActive = true,
  resolveMentionLink,
  timeline,
  rowFilter,
  leadingContent,
  consumerMessageActions,
  includePluginMessageActions,
  draftModeTimelineRows,
  labels: labelOverrides,
  showLoadOlderRows = true,
  onOpenLink,
  onOpenLocalFileLink,
  onSendToMainMessage,
  workspaceRootPath,
  layout = "contained",
  measure = "panel",
  surfaceTone = "background",
  composer,
}: EmbeddedThreadChatComposerModeProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const systemConfigQuery = useSystemConfig();
  const steerActiveThreadOnEnter =
    systemConfigQuery.data?.generalSettings.steerActiveThreadOnEnter ??
    defaultAppSettings.steerActiveThreadOnEnter;
  const surfaceKey = threadId ?? surfaceFallbackKey ?? "embedded-thread-chat";
  const markThreadRead = useMarkThreadRead();
  const stopThread = useStopThread();
  const sendThreadMessage = useSendThreadMessage();
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const threadQuery = useThread(threadId ?? "", {
    enabled: threadId !== null,
  });
  const pendingInteractionsQuery = useThreadPendingInteractions(
    threadId ?? "",
    {
      enabled: threadId !== null,
    },
  );
  const activePendingInteraction = getLatestPendingInteraction(
    pendingInteractionsQuery.data,
  );
  useThreadReadTracking({
    markThreadRead,
    thread: isActive ? threadQuery.data : undefined,
  });
  const { data: queuedMessages = [] } = useThreadQueuedMessages(
    threadId ?? "",
    {
      enabled: threadId !== null,
    },
  );

  const [shouldLoadExecutionOptions, setShouldLoadExecutionOptions] = useState(
    composer.deferExecutionOptionsUntilActive !== true,
  );
  const deferExecutionOptions =
    composer.deferExecutionOptionsUntilActive === true;
  useEffect(() => {
    if (!deferExecutionOptions) {
      return;
    }
    if (!isActive) {
      setShouldLoadExecutionOptions(false);
      return;
    }
    // The surface itself is useful before model metadata is. Let its first
    // paint win over host-backed model discovery, which can take seconds on a
    // remote mobile session.
    const timeoutId = window.setTimeout(
      () => setShouldLoadExecutionOptions(true),
      0,
    );
    return () => window.clearTimeout(timeoutId);
  }, [deferExecutionOptions, isActive]);

  const executionOptionsQuery = useThreadDefaultExecutionOptions(
    composer.executionDefaultsThreadId,
    { enabled: shouldLoadExecutionOptions },
  );
  const defaultExecutionOptions = executionOptionsQuery.data;
  const threadCreationOptions = useThreadCreationOptions({
    enabled: shouldLoadExecutionOptions,
    scope: "component-local",
    environmentId: composer.executionEnvironmentId,
    environmentHostId: composer.executionEnvironmentHostId,
    resetKey: composer.executionResetKey,
    initialProviderId: providerId,
    initialModel: defaultExecutionOptions?.model,
    initialServiceTier: defaultExecutionOptions?.serviceTier,
    initialReasoningLevel: defaultExecutionOptions?.reasoningLevel,
    initialPermissionMode: defaultExecutionOptions?.permissionMode,
  });
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
    modelLoadFailed,
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
    isLoadingModels,
  } = threadCreationOptions;
  const selectedExecutionModel = activeModel?.model ?? selectedModel;
  const selectedExecutionServiceTier = supportsServiceTier
    ? serviceTier
    : undefined;
  // Snapshot policy sources the mode straight from the thread's resolved
  // defaults — not the provider-filtered picker state — so a slow capabilities
  // load can never widen the value actually used.
  const snapshotPermissionMode = defaultExecutionOptions?.permissionMode;
  const effectivePermissionMode =
    composer.permissionPolicy === "snapshot"
      ? snapshotPermissionMode
      : permissionMode;

  const displayStatus = threadQuery.data?.runtime.displayStatus ?? "idle";
  const executionRequestFields = useMemo(
    () => ({
      ...(selectedExecutionModel.length > 0
        ? {
            model: selectedExecutionModel,
            reasoningLevel,
            ...(selectedExecutionServiceTier
              ? { serviceTier: selectedExecutionServiceTier }
              : {}),
          }
        : {}),
      // Omitted while defaults are still loading — the server then falls back
      // to the thread's own stored default, which is the same value.
      ...(effectivePermissionMode !== undefined
        ? { permissionMode: effectivePermissionMode }
        : {}),
    }),
    [
      effectivePermissionMode,
      reasoningLevel,
      selectedExecutionModel,
      selectedExecutionServiceTier,
    ],
  );
  const executionContext = useMemo<EmbeddedThreadChatExecutionContext>(
    () => ({
      model: selectedExecutionModel,
      reasoningLevel,
      serviceTier: selectedExecutionServiceTier,
      permissionMode: effectivePermissionMode,
      executionRequestFields,
      displayStatus,
    }),
    [
      displayStatus,
      effectivePermissionMode,
      executionRequestFields,
      reasoningLevel,
      selectedExecutionModel,
      selectedExecutionServiceTier,
    ],
  );

  const [composerFocusNonce, setComposerFocusNonce] = useState(0);
  const [inlineComposerFocusNonce, setInlineComposerFocusNonce] = useState(0);
  const [isTurnSubmitting, setIsTurnSubmitting] = useState(false);
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearInlineAttachmentErrorRef = useRef<() => void>(() => {});
  const {
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
    updateInlineQueuedMessage,
    dismissInlineQueuedMessageEditor,
    beginEditQueuedMessage,
  } = useInlineQueuedMessageEditing({
    ownerThreadId: threadId,
    queuedMessages,
    onBeginEdit: () => {
      clearInlineAttachmentErrorRef.current();
      setInlineComposerFocusNonce((nonce) => nonce + 1);
    },
  });
  const {
    promptDraft,
    currentPromptDraft,
    currentPromptDraftInput,
    activeComposerDraft,
    activeComposerDraftInput,
    setActiveComposerDraft,
    handleChangeMessage,
    removeActiveComposerAttachment,
  } = useActiveComposerDraft({
    draftScope: composer.draftScope,
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
  const { typeaheadConfig, promptActions } = useComposerTypeahead({
    projectId,
    providerId,
    environmentId: promptContextEnvironmentId,
    commandScope: threadId === null ? "new-thread" : "thread",
    currentThreadId: threadId ?? composer.executionDefaultsThreadId,
    selectedProviderComposerActions,
    resolveMentionLink,
  });

  const isStopRequested =
    threadId !== null &&
    (threadQuery.data?.status === "stopping" ||
      (stopThread.isPending && stopThread.variables === threadId));
  const handleStopThread = useCallback(() => {
    if (threadId === null) {
      return;
    }
    stopThread.mutate(threadId);
  }, [stopThread, threadId]);
  const isProvisioning =
    displayStatus === "provisioning" || displayStatus === "starting";
  // A replayed (placeholder) resolution seeds the pickers but does not open
  // submission; wait for the live query like an empty cache would.
  const isDefaultExecutionOptionsLoading =
    executionOptionsQuery.isPlaceholderData ||
    (defaultExecutionOptions === undefined && executionOptionsQuery.isLoading);

  const {
    processingQueuedMessage,
    queuedMessageActionPending,
    isUpdateQueuedMessagePending,
    handleSendQueuedImmediately,
    handleSaveInlineQueuedMessage,
    handleDeleteQueuedMessage,
    handleReorderQueuedMessage,
    handleSetQueuedMessageGroupBoundary,
  } = useQueuedMessageActions({
    threadId,
    queuedMessages,
    sendProcessingPersistence: "clear-on-settle",
    canSendNow: () => !isProvisioning,
    onSaveSuccess: () => setInlineAttachmentError(null),
    inlineEditingQueuedMessage,
    dismissInlineQueuedMessageEditor,
    activeComposerDraftInput,
  });

  const submitMode = useMemo<FollowUpComposerProps["submitMode"]>(
    () =>
      buildSideChatSubmitMode({
        childThreadId: threadId,
        isDefaultExecutionOptionsLoading,
        isStopRequested,
        onStop: handleStopThread,
        runtimeDisplayStatus: displayStatus,
      }),
    [
      displayStatus,
      handleStopThread,
      isDefaultExecutionOptionsLoading,
      isStopRequested,
      threadId,
    ],
  );

  const defaultSendOrQueueInput = useCallback(
    async (input: PromptInput[]) => {
      if (threadId === null) {
        throw new Error("No thread to send to yet.");
      }
      if (shouldQueueFollowUpMessage(displayStatus)) {
        await createQueuedMessage.mutateAsync({
          id: threadId,
          input,
          ...executionRequestFields,
        });
      } else {
        await sendThreadMessage.mutateAsync({
          id: threadId,
          input,
          mode: "queue-if-active",
          ...executionRequestFields,
        });
      }
    },
    [
      createQueuedMessage,
      displayStatus,
      executionRequestFields,
      sendThreadMessage,
      threadId,
    ],
  );
  const sendOrQueueInput = composer.onSendOrQueueInput;
  const onDraftSubmitted = composer.onDraftSubmitted;
  const onDraftSubmitError = composer.onDraftSubmitError;
  const handleSubmit = useCallback(() => {
    const submittedDraft = currentPromptDraft;
    const submittedInput = currentPromptDraftInput;
    if (submittedInput.length === 0 || isTurnSubmitting) {
      return;
    }
    onDraftSubmitted?.(submittedInput);
    promptDraft.clearIfCurrentMatches(submittedDraft);
    setBottomAttachmentError(null);
    setIsTurnSubmitting(true);
    void (
      sendOrQueueInput
        ? sendOrQueueInput(submittedInput, executionContext)
        : defaultSendOrQueueInput(submittedInput)
    )
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }
        onDraftSubmitError?.();
        promptDraft.restoreIfEmpty(submittedDraft);
        appToast.error(
          getMutationErrorMessage({
            error,
            fallbackMessage: labels.sendError,
            lifecycleOperation: shouldQueueFollowUpMessage(displayStatus)
              ? "queue_message"
              : "send_message",
          }),
        );
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsTurnSubmitting(false);
        }
      });
  }, [
    currentPromptDraft,
    currentPromptDraftInput,
    defaultSendOrQueueInput,
    displayStatus,
    executionContext,
    isTurnSubmitting,
    labels.sendError,
    onDraftSubmitError,
    onDraftSubmitted,
    promptDraft,
    sendOrQueueInput,
    setBottomAttachmentError,
  ]);

  const isQueueMutationPending =
    queuedMessageActionPending ||
    createQueuedMessage.isPending ||
    composer.isExternalSubmitPending === true;
  const hasPromptDraftInput = currentPromptDraftInput.length > 0;
  const canSubmitModifierShortcut = canSubmitFollowUpShortcut({
    hasPromptDraftInput,
    isFollowUpSubmitting: isTurnSubmitting,
    isQueueMutationPending,
    queuedMessageCount: queuedMessages.length,
    runtimeDisplayStatus: displayStatus,
    submitModeKind: submitMode.kind,
  });
  const handleModifierSubmit = useCallback(() => {
    if (!canSubmitModifierShortcut || threadId === null) {
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

    promptDraft.clearIfCurrentMatches(submittedDraft);
    setBottomAttachmentError(null);
    setIsTurnSubmitting(true);
    void sendThreadMessage
      .mutateAsync({
        id: threadId,
        input: submittedInput,
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
            fallbackMessage: labels.sendError,
            lifecycleOperation: "send_message",
          }),
        );
      })
      .finally(() => {
        if (isMountedRef.current) {
          setIsTurnSubmitting(false);
        }
      });
  }, [
    canSubmitModifierShortcut,
    currentPromptDraft,
    currentPromptDraftInput,
    handleSendQueuedImmediately,
    labels.sendError,
    promptDraft,
    queuedMessages,
    sendThreadMessage,
    setBottomAttachmentError,
    threadId,
  ]);

  const handleBottomComposerSubmit = useCallback(() => {
    handleSubmit();
  }, [handleSubmit]);
  const handleBottomComposerModifierSubmit = useCallback(() => {
    handleModifierSubmit();
  }, [handleModifierSubmit]);
  const handleInlineComposerSubmit = useCallback(() => {
    void handleSaveInlineQueuedMessage();
  }, [handleSaveInlineQueuedMessage]);

  const addQuoteToPromptDraft = promptDraft.addQuote;
  const handleAddToChat = useCallback<ThreadTimelineAddToChatHandler>(
    (text, attachments) => {
      addQuoteToPromptDraft(text, attachments);
      setComposerFocusNonce((nonce) => nonce + 1);
    },
    [addQuoteToPromptDraft],
  );

  // ---- Plugin composer host --------------------------------------------------
  const queuedEditSessionId = inlineEditingQueuedMessage?.editSessionId ?? null;
  const queuedEditOwnerThreadId =
    inlineEditingQueuedMessage?.ownerThreadId ?? null;
  const queuedEditMessageId =
    inlineEditingQueuedMessage?.queuedMessageId ?? null;
  const queuedComposerIdentity = useMemo(
    () =>
      queuedEditSessionId === null ||
      queuedEditOwnerThreadId === null ||
      queuedEditMessageId === null
        ? null
        : {
            editSessionId: queuedEditSessionId,
            ownerThreadId: queuedEditOwnerThreadId,
            queuedMessageId: queuedEditMessageId,
          },
    [queuedEditMessageId, queuedEditOwnerThreadId, queuedEditSessionId],
  );
  const bottomScope = composer.pluginComposerBottomScope ?? null;
  const bottomComposerHostIdentity = useMemo(
    () =>
      createPluginComposerHostIdentity(
        `${composer.composerIdentity ?? surfaceKey}:bottom:${isActive ? "active" : "inactive"}`,
      ),
    [composer.composerIdentity, isActive, surfaceKey],
  );
  const queuedComposerHostIdentity = useMemo(
    () =>
      queuedComposerIdentity
        ? createPluginComposerHostIdentity(
            `queued-message:${queuedComposerIdentity.ownerThreadId}:${queuedComposerIdentity.queuedMessageId}:${queuedComposerIdentity.editSessionId}:${isActive ? "active" : "inactive"}`,
          )
        : null,
    [isActive, queuedComposerIdentity],
  );
  const activeBottomComposerIdentityRef = useRef<string | null>(null);
  const activeQueuedComposerIdentityRef = useRef<string | null>(null);
  const currentPromptDraftRef = useRef(currentPromptDraft);
  // The host reads only committed (painted) state: a render that suspends must
  // not leak its in-flight queued-edit draft into `getCurrent`.
  const committedInlineEditRef = useRef(inlineEditingQueuedMessage);
  useLayoutEffect(() => {
    currentPromptDraftRef.current = currentPromptDraft;
    committedInlineEditRef.current = inlineEditingQueuedMessage;
  }, [currentPromptDraft, inlineEditingQueuedMessage]);
  useLayoutEffect(() => {
    activeBottomComposerIdentityRef.current = isActive
      ? bottomComposerHostIdentity
      : null;
    return () => {
      if (
        activeBottomComposerIdentityRef.current === bottomComposerHostIdentity
      ) {
        activeBottomComposerIdentityRef.current = null;
      }
    };
  }, [bottomComposerHostIdentity, isActive]);
  useLayoutEffect(() => {
    activeQueuedComposerIdentityRef.current =
      isActive && queuedComposerHostIdentity
        ? queuedComposerHostIdentity
        : null;
    return () => {
      if (
        activeQueuedComposerIdentityRef.current === queuedComposerHostIdentity
      ) {
        activeQueuedComposerIdentityRef.current = null;
      }
    };
  }, [isActive, queuedComposerHostIdentity]);
  const setStoredPromptDraft = promptDraft.setDraft;
  const bottomPluginComposerHost = useMemo<PluginComposerHost | null>(() => {
    if (bottomScope === null) return null;
    const identity = bottomComposerHostIdentity;
    const initialDraft = currentPromptDraftRef.current;
    return {
      scope: bottomScope,
      textEffectKey: identity,
      draft: currentPromptDraftRef.current,
      getCurrent: () =>
        activeBottomComposerIdentityRef.current === identity
          ? currentPromptDraftRef.current
          : initialDraft,
      setDraft: (draft) => {
        if (activeBottomComposerIdentityRef.current === identity) {
          setStoredPromptDraft(draft);
        }
      },
      focus: () => {
        if (activeBottomComposerIdentityRef.current === identity) {
          setComposerFocusNonce((nonce) => nonce + 1);
        }
      },
    };
  }, [bottomComposerHostIdentity, bottomScope, setStoredPromptDraft]);
  const queuedPluginComposerHost = useMemo<PluginComposerHost | null>(() => {
    if (
      queuedComposerIdentity === null ||
      queuedComposerHostIdentity === null
    ) {
      return null;
    }
    const identity = queuedComposerHostIdentity;
    const initialDraft = inlineEditingQueuedMessageRef.current?.draft ?? {
      attachments: [],
      mentions: [],
      text: "",
    };
    const queuedEdit = queuedComposerIdentity;
    const isCurrentQueuedEdit = (
      current: typeof inlineEditingQueuedMessageRef.current,
    ): current is NonNullable<typeof current> =>
      queuedEdit !== null &&
      current?.editSessionId === queuedEdit.editSessionId &&
      current.ownerThreadId === queuedEdit.ownerThreadId &&
      current.queuedMessageId === queuedEdit.queuedMessageId;
    return {
      scope: {
        kind: "queued-message",
        threadId: queuedEdit.ownerThreadId,
        queuedMessageId: queuedEdit.queuedMessageId,
      },
      textEffectKey: identity,
      draft: initialDraft,
      getCurrent: () => {
        if (activeQueuedComposerIdentityRef.current !== identity) {
          return initialDraft;
        }
        const currentQueuedEdit = committedInlineEditRef.current;
        return isCurrentQueuedEdit(currentQueuedEdit)
          ? currentQueuedEdit.draft
          : initialDraft;
      },
      setDraft: (draft) => {
        if (activeQueuedComposerIdentityRef.current !== identity) {
          return;
        }
        updateInlineQueuedMessage((current) =>
          isCurrentQueuedEdit(current) ? { ...current, draft } : current,
        );
      },
      focus: () => {
        if (activeQueuedComposerIdentityRef.current === identity) {
          setInlineComposerFocusNonce((nonce) => nonce + 1);
        }
      },
    };
  }, [
    inlineEditingQueuedMessageRef,
    queuedComposerIdentity,
    queuedComposerHostIdentity,
    updateInlineQueuedMessage,
  ]);
  const bottomPluginComposerHostWithDraft = useMemo<PluginComposerHost | null>(
    () =>
      bottomPluginComposerHost === null
        ? null
        : { ...bottomPluginComposerHost, draft: currentPromptDraft },
    [bottomPluginComposerHost, currentPromptDraft],
  );
  const queuedPluginComposerHostWithDraft = useMemo<PluginComposerHost | null>(
    () =>
      queuedPluginComposerHost === null
        ? null
        : { ...queuedPluginComposerHost, draft: activeComposerDraft },
    [activeComposerDraft, queuedPluginComposerHost],
  );
  const activeBottomPluginComposerHost = isActive
    ? bottomPluginComposerHostWithDraft
    : null;
  const activeQueuedPluginComposerHost = isActive
    ? queuedPluginComposerHostWithDraft
    : null;
  const bottomComposerTextEffects = useComposerTextEffects(
    activeBottomPluginComposerHost?.textEffectKey ?? null,
  );
  const queuedComposerTextEffects = useComposerTextEffects(
    activeQueuedPluginComposerHost?.textEffectKey ?? null,
  );

  // ---- Composer configs ------------------------------------------------------
  const composerPlaceholder = isStopRequested
    ? labels.stopping
    : isProvisioning
      ? labels.provisioning
      : labels.placeholder;
  const compactComposerPlaceholder = isStopRequested
    ? labels.stopping
    : isProvisioning
      ? (labels.compactProvisioning ?? labels.provisioning)
      : labels.placeholder;

  const bottomComposerConfig = useMemo<FollowUpComposerProps>(
    () => ({
      // No prompt-history surface here. A draft-only history config (current
      // draft, no entries) satisfies the required shape without inventing a
      // feature the composer never exercises.
      history: {
        currentDraft: currentPromptDraft,
        entries: [],
        onSelectEntry: promptDraft.setDraft,
      } satisfies HistoryConfig,
      isFollowUpSubmitting: isTurnSubmitting,
      message: currentPromptDraft.text,
      mentionRanges: currentPromptDraft.mentions,
      onChangeMessage: promptDraft.setTextAndMentions,
      onModifierSubmit: handleBottomComposerModifierSubmit,
      onSubmit: handleBottomComposerSubmit,
      compactPromptPlaceholder: compactComposerPlaceholder,
      promptPlaceholder: composerPlaceholder,
      canModifierSubmit: canSubmitModifierShortcut,
      steerActiveThreadOnEnter,
      submitMode,
      threadRuntimeDisplayStatus: displayStatus,
    }),
    [
      canSubmitModifierShortcut,
      compactComposerPlaceholder,
      composerPlaceholder,
      currentPromptDraft,
      displayStatus,
      handleBottomComposerModifierSubmit,
      handleBottomComposerSubmit,
      isTurnSubmitting,
      promptDraft.setDraft,
      promptDraft.setTextAndMentions,
      steerActiveThreadOnEnter,
      submitMode,
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
            } satisfies HistoryConfig,
            isFollowUpSubmitting: isUpdateQueuedMessagePending,
            message: activeComposerDraft.text,
            mentionRanges: activeComposerDraft.mentions,
            onChangeMessage: handleChangeMessage,
            onModifierSubmit: handleInlineComposerSubmit,
            onSubmit: handleInlineComposerSubmit,
            compactPromptPlaceholder: compactComposerPlaceholder,
            promptPlaceholder: composerPlaceholder,
            canModifierSubmit:
              activeComposerDraftInput.length > 0 &&
              !isUpdateQueuedMessagePending,
            steerActiveThreadOnEnter: false,
            submitMode: { kind: "ready" },
            threadRuntimeDisplayStatus: displayStatus,
          }
        : null,
    [
      activeComposerDraft,
      activeComposerDraftInput.length,
      compactComposerPlaceholder,
      composerPlaceholder,
      displayStatus,
      handleChangeMessage,
      handleInlineComposerSubmit,
      inlineEditingQueuedMessage,
      isUpdateQueuedMessagePending,
      setActiveComposerDraft,
    ],
  );

  const bottomAttachmentsConfig = useMemo<AttachmentsConfig>(
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
  const inlineAttachmentsConfig = useMemo<AttachmentsConfig>(
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

  const bottomExecutionConfig = useMemo<ExecutionControlsProps>(
    () => ({
      providerRouting: executionOptionsRouting,
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
        loadFailed: modelLoadFailed,
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
      executionOptionsRouting,
      hasMultipleProviders,
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
      setSelectedModel,
      setServiceTier,
      supportsServiceTier,
    ],
  );
  const inlineExecutionConfig = useMemo<ExecutionControlsProps | null>(
    () =>
      inlineEditingQueuedMessage
        ? {
            ...bottomExecutionConfig,
            model: {
              ...bottomExecutionConfig.model,
              active: { model: inlineEditingQueuedMessage.model },
              selected: inlineEditingQueuedMessage.model,
            },
            serviceTier: {
              value: inlineEditingQueuedMessage.serviceTier,
              onChange: setServiceTier,
              supported: supportsServiceTier,
              supportByProvider: serviceTierSupportByProvider,
            },
            reasoning: {
              ...bottomExecutionConfig.reasoning,
              value: inlineEditingQueuedMessage.reasoningLevel,
            },
          }
        : null,
    [
      bottomExecutionConfig,
      inlineEditingQueuedMessage,
      serviceTierSupportByProvider,
      setServiceTier,
      supportsServiceTier,
    ],
  );

  const bottomPermissionConfig = useMemo<ExecutionPermissionConfig>(
    () =>
      composer.permissionPolicy === "snapshot"
        ? {
            // Sourced from the same resolved-defaults value snapshot sends use,
            // so the displayed label can't drift from the permission the thread
            // actually runs with. Undefined until defaults load, which keeps
            // the picker hidden rather than guessing.
            value: snapshotPermissionMode,
            options: permissionModeOptions,
            onChange: () => {},
            supported: supportsPermissionModeSelection,
          }
        : {
            value: permissionMode,
            options: permissionModeOptions,
            onChange: setPermissionMode,
            supported: supportsPermissionModeSelection,
          },
    [
      composer.permissionPolicy,
      permissionMode,
      permissionModeOptions,
      setPermissionMode,
      snapshotPermissionMode,
      supportsPermissionModeSelection,
    ],
  );
  const inlinePermissionConfig = useMemo<ExecutionPermissionConfig | null>(
    () =>
      inlineEditingQueuedMessage
        ? {
            ...bottomPermissionConfig,
            value: inlineEditingQueuedMessage.permissionMode,
          }
        : null,
    [bottomPermissionConfig, inlineEditingQueuedMessage],
  );

  const inlineEditor = useMemo<QueuedMessageInlineEditor | undefined>(() => {
    if (
      !inlineEditingQueuedMessage ||
      !inlineComposerConfig ||
      !inlineExecutionConfig ||
      !inlinePermissionConfig
    ) {
      return undefined;
    }
    return {
      queuedMessageId: inlineEditingQueuedMessage.queuedMessageId,
      queuedMessageIndex: inlineEditingQueuedMessage.queuedMessageIndex,
      onDismiss: dismissInlineQueuedMessageEditor,
      content: (
        <FollowUpPromptBox
          attachments={inlineAttachmentsConfig}
          stack={null}
          composer={inlineComposerConfig}
          pluginComposerHost={activeQueuedPluginComposerHost}
          pluginComposerScope={activeQueuedPluginComposerHost?.scope ?? null}
          textEffects={queuedComposerTextEffects}
          environmentSummary={null}
          contextWindowUsage={null}
          execution={inlineExecutionConfig}
          executionReadOnly
          permission={inlinePermissionConfig}
          permissionReadOnly
          typeahead={typeaheadConfig}
          promptActions={promptActions}
          suppressPluginComposerCustomizations={!isActive}
          zenModeResetKey={`${surfaceKey}:queued-message:${inlineEditingQueuedMessage.queuedMessageId}`}
          focusEndKey={`${inlineEditingQueuedMessage.editSessionId}:${inlineComposerFocusNonce}`}
          isPrimaryComposer={false}
          showScrollToBottomButton={false}
        />
      ),
    };
  }, [
    activeQueuedPluginComposerHost,
    dismissInlineQueuedMessageEditor,
    inlineAttachmentsConfig,
    inlineComposerConfig,
    inlineComposerFocusNonce,
    inlineEditingQueuedMessage,
    inlineExecutionConfig,
    inlinePermissionConfig,
    isActive,
    promptActions,
    queuedComposerTextEffects,
    surfaceKey,
    typeaheadConfig,
  ]);

  const queuedMessagesStack = useMemo(
    () =>
      queuedMessages.length > 0 ? (
        <QueuedMessagesList
          queuedMessages={queuedMessages}
          resolveMentionLink={resolveMentionLink}
          inlineEditor={inlineEditor}
          sendDisabled={
            threadId === null || isProvisioning || queuedMessageActionPending
          }
          actionDisabled={queuedMessageActionPending}
          processingMessageId={processingQueuedMessage?.id ?? null}
          processingAction={processingQueuedMessage?.action ?? null}
          onSendImmediately={handleSendQueuedImmediately}
          onReorder={handleReorderQueuedMessage}
          onSetGroupBoundary={handleSetQueuedMessageGroupBoundary}
          onEdit={beginEditQueuedMessage}
          onDelete={handleDeleteQueuedMessage}
        />
      ) : null,
    [
      beginEditQueuedMessage,
      handleDeleteQueuedMessage,
      handleReorderQueuedMessage,
      handleSendQueuedImmediately,
      handleSetQueuedMessageGroupBoundary,
      inlineEditor,
      isProvisioning,
      processingQueuedMessage?.action,
      processingQueuedMessage?.id,
      queuedMessageActionPending,
      queuedMessages,
      resolveMentionLink,
      threadId,
    ],
  );

  const surfaceClassName =
    surfaceTone === "sidebar" ? "bg-sidebar" : "bg-background";
  // An approval or question blocks the turn until it is answered, so this
  // surface swaps the composer for it exactly like the main thread view. A
  // plugin-owned interaction renders in its own composer instead, so the
  // banner ignores it and the draft stays.
  const pendingInteractionBanner =
    activePendingInteraction === null ||
    activePendingInteraction.payload.kind === "plugin" ? null : (
      <ThreadPendingInteractionBanner
        interaction={activePendingInteraction}
        threadId={threadId ?? ""}
      />
    );
  const footer = (
    <div className={cn("relative", surfaceClassName)}>
      <OverflowFade placement="above" tone={surfaceTone} />
      <div className="px-4 pb-4 pt-2">
        {pendingInteractionBanner ?? (
          <FollowUpPromptBox
            attachments={bottomAttachmentsConfig}
            stack={queuedMessagesStack}
            composer={bottomComposerConfig}
            pluginComposerHost={activeBottomPluginComposerHost}
            pluginComposerScope={activeBottomPluginComposerHost?.scope ?? null}
            textEffects={bottomComposerTextEffects}
            environmentSummary={composer.environmentSummary}
            contextWindowUsage={null}
            execution={bottomExecutionConfig}
            permission={bottomPermissionConfig}
            permissionReadOnly={composer.permissionPolicy === "snapshot"}
            typeahead={typeaheadConfig}
            promptActions={promptActions}
            suppressPluginComposerCustomizations={!isActive}
            zenModeResetKey={surfaceKey}
            focusEndKey={
              // Composite only when an external nonce is supplied, so existing
              // consumers keep the plain internal-nonce key.
              composer.focusRequestKey === undefined
                ? composerFocusNonce
                : `${composerFocusNonce}:${composer.focusRequestKey}`
            }
            // Embedded surfaces never own the global composer shortcuts; the
            // thread-detail composer does.
            isPrimaryComposer={false}
          />
        )}
      </div>
    </div>
  );

  const maxWidthClassName = measure === "page" ? "max-w-[760px]" : "max-w-none";
  const timelineBody =
    threadId !== null ? (
      <ThreadTimelinePanelContent
        isTurnSubmitting={isTurnSubmitting}
        leadingContent={leadingContent}
        consumerMessageActions={consumerMessageActions}
        includePluginMessageActions={includePluginMessageActions}
        missingThreadLabel={labels.missingThread}
        onOpenLink={onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
        onSendToMainMessage={onSendToMainMessage}
        onMessageAddToChat={handleAddToChat}
        onSelectionAddToChat={handleAddToChat}
        projectId={projectId}
        provisioningLabel={labels.provisioning}
        resolveMentionLink={resolveMentionLink}
        rowFilter={rowFilter}
        showLoadOlderRows={showLoadOlderRows}
        threadId={threadId}
        timeline={timeline}
        timelineErrorLabel={labels.timelineError}
        workspaceRootPath={workspaceRootPath}
      />
    ) : (
      <ThreadTimelineSurface
        activeThinking={null}
        leadingContent={leadingContent}
        isThreadTimelinePending={false}
        timelineError={false}
        showOngoingIndicator={isTurnSubmitting}
        ongoingIndicatorLabel={labels.draftSubmitting}
        onOpenLink={onOpenLink}
        onOpenLocalFileLink={onOpenLocalFileLink}
        resolveMentionLink={resolveMentionLink}
        timelineRows={draftModeTimelineRows ? [...draftModeTimelineRows] : []}
        threadId={surfaceKey}
        threadRuntimeDisplayStatus="starting"
        workspaceRootPath={workspaceRootPath}
      />
    );

  if (layout === "document") {
    // Normal document flow: the page (or panel) scrolls, not this component.
    // The sticky footer keeps the composer visible while the transcript is in
    // view without capturing scroll ownership.
    return (
      <div
        key={surfaceKey}
        data-thread-window=""
        data-surface-tone={surfaceTone}
        className={cn("flex min-w-0 flex-col", surfaceClassName)}
      >
        <div
          className={cn(
            "mx-auto flex w-full min-w-0 flex-col",
            measure === "page" ? "px-4 pb-3 pt-3" : "px-2 pb-3 pt-3",
            maxWidthClassName,
          )}
        >
          {timelineBody}
        </div>
        <div className="sticky bottom-0 z-20">{footer}</div>
      </div>
    );
  }

  return (
    <div
      data-thread-window=""
      data-surface-tone={surfaceTone}
      className="flex min-h-0 flex-1 flex-col"
    >
      <BottomAnchoredScrollBody
        key={surfaceKey}
        scrollAreaClassName={surfaceClassName}
        contentClassName={
          measure === "page" ? "!pb-3 !pt-3" : "!px-2 !pb-3 !pt-3"
        }
        maxWidthClassName={maxWidthClassName}
        footer={footer}
        scrollAnchorThreadId={threadId ?? undefined}
      >
        {timelineBody}
      </BottomAnchoredScrollBody>
    </div>
  );
}
