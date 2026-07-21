import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  PermissionMode,
  PromptInput,
  ReasoningLevel,
  ServiceTier,
  ThreadRuntimeDisplayStatus,
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
import { PluginComposerStatuses } from "@/components/plugin/PluginComposerStatuses";
import { QueuedMessagesList } from "@/components/promptbox/banner/QueuedMessagesList";
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
  type ThreadTimelineRowFilter,
  type ThreadTimelineSendToMainMessageHandler,
  type ThreadTimelineSurfaceProps,
  type UseThreadTimelineControllerResult,
} from "@/components/thread/timeline";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import {
  useThread,
  useThreadQueuedMessages,
} from "@/hooks/queries/thread-queries";
import { useThreadDefaultExecutionOptions } from "@/hooks/queries/thread-default-execution-options-query";
import {
  useCreateThreadQueuedMessage,
  useSendThreadMessage,
  useStopThread,
} from "@/hooks/mutations/thread-runtime-mutations";
import { useMarkThreadRead } from "@/hooks/mutations/thread-state-mutations";
import { useThreadReadTracking } from "@/hooks/useThreadReadTracking";
import { useComposerTextEffect } from "@/lib/composer-text-effects";
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
  /** Thread whose row status plugin composer accessories reflect. */
  threadRowStatusThreadId?: string;
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
  /** Retained hidden surfaces pass false to pause read tracking + accessories. */
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
  onSendToMainMessage?: ThreadTimelineSendToMainMessageHandler;
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

export interface EmbeddedThreadChatComposerModeProps
  extends EmbeddedThreadChatSharedProps {
  variant: "compact";
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
  onSendToMainMessage,
  layout = "contained",
  measure = "panel",
  composer,
}: EmbeddedThreadChatComposerModeProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const surfaceKey = threadId ?? surfaceFallbackKey ?? "embedded-thread-chat";
  const markThreadRead = useMarkThreadRead();
  const stopThread = useStopThread();
  const sendThreadMessage = useSendThreadMessage();
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const threadQuery = useThread(threadId ?? "", {
    enabled: threadId !== null,
  });
  useThreadReadTracking({
    markThreadRead,
    thread: isActive ? threadQuery.data : undefined,
  });
  const { data: queuedMessages = [] } = useThreadQueuedMessages(threadId ?? "", {
    enabled: threadId !== null,
  });

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
  const [isTurnSubmitting, setIsTurnSubmitting] = useState(false);
  const isMountedRef = useRef(false);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const clearAttachmentErrorRef = useRef<() => void>(() => {});
  const {
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
    updateInlineQueuedMessage,
    dismissInlineQueuedMessageEditor,
    beginEditQueuedMessage,
    inlineEditor,
    inlineComposerTarget,
  } = useInlineQueuedMessageEditing({
    ownerThreadId: threadId,
    queuedMessages,
    onBeginEdit: () => {
      clearAttachmentErrorRef.current();
      setComposerFocusNonce((nonce) => nonce + 1);
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
    attachmentError,
    setAttachmentError,
    handleAttachFiles,
    isAttaching,
  } = useComposerAttachmentUploads({
    projectId,
    addDraftAttachment: promptDraft.addAttachment,
    inlineEditingQueuedMessage,
    inlineEditingQueuedMessageRef,
    commitInlineQueuedMessage,
  });
  clearAttachmentErrorRef.current = () => setAttachmentError(null);
  const { typeaheadConfig, promptActions } = useComposerTypeahead({
    projectId,
    providerId,
    environmentId: promptContextEnvironmentId,
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
  const isDefaultExecutionOptionsLoading =
    defaultExecutionOptions === undefined && executionOptionsQuery.isLoading;

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
    onSaveSuccess: () => setAttachmentError(null),
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
    setAttachmentError(null);
    setIsTurnSubmitting(true);
    void (sendOrQueueInput
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
    setAttachmentError,
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
    setAttachmentError(null);
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
    setAttachmentError,
    threadId,
  ]);

  const handleComposerSubmit = useCallback(() => {
    if (inlineEditingQueuedMessage) {
      void handleSaveInlineQueuedMessage();
      return;
    }
    handleSubmit();
  }, [handleSaveInlineQueuedMessage, handleSubmit, inlineEditingQueuedMessage]);
  const handleComposerModifierSubmit = useCallback(() => {
    if (inlineEditingQueuedMessage) {
      void handleSaveInlineQueuedMessage();
      return;
    }
    handleModifierSubmit();
  }, [
    handleModifierSubmit,
    handleSaveInlineQueuedMessage,
    inlineEditingQueuedMessage,
  ]);

  const handleAddToChat = useCallback<ThreadTimelineAddToChatHandler>(
    (text, attachments) => {
      promptDraft.addQuote(text, attachments);
      setComposerFocusNonce((nonce) => nonce + 1);
    },
    [promptDraft],
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
  const activeComposerIdentity = queuedComposerIdentity
    ? `queued-message:${queuedComposerIdentity.ownerThreadId}:${queuedComposerIdentity.queuedMessageId}:${queuedComposerIdentity.editSessionId}`
    : (composer.composerIdentity ?? surfaceKey);
  const activeComposerHostIdentity = useMemo(
    () =>
      createPluginComposerHostIdentity(
        `${activeComposerIdentity}:${isActive ? "active" : "inactive"}`,
      ),
    [activeComposerIdentity, isActive],
  );
  const activeComposerIdentityRef = useRef<string | null>(null);
  const activeComposerDraftRef = useRef(activeComposerDraft);
  activeComposerDraftRef.current = activeComposerDraft;
  const currentPromptDraftRef = useRef(currentPromptDraft);
  // The host reads only committed (painted) state: a render that suspends must
  // not leak its in-flight queued-edit draft into `getCurrent`.
  const committedInlineEditRef = useRef(inlineEditingQueuedMessage);
  useLayoutEffect(() => {
    currentPromptDraftRef.current = currentPromptDraft;
    committedInlineEditRef.current = inlineEditingQueuedMessage;
  }, [currentPromptDraft, inlineEditingQueuedMessage]);
  useLayoutEffect(() => {
    activeComposerIdentityRef.current = isActive
      ? activeComposerHostIdentity
      : null;
    return () => {
      if (activeComposerIdentityRef.current === activeComposerHostIdentity) {
        activeComposerIdentityRef.current = null;
      }
    };
  }, [activeComposerHostIdentity, isActive]);
  const setStoredPromptDraft = promptDraft.setDraft;
  const threadRowStatusThreadId =
    composer.threadRowStatusThreadId ?? threadId ?? undefined;
  const pluginComposerHost = useMemo<PluginComposerHost | null>(() => {
    if (bottomScope === null && queuedComposerIdentity === null) {
      return null;
    }
    const identity = activeComposerHostIdentity;
    const initialDraft = activeComposerDraftRef.current;
    const queuedEdit = queuedComposerIdentity;
    const isCurrentQueuedEdit = (
      current: typeof inlineEditingQueuedMessageRef.current,
    ): current is NonNullable<typeof current> =>
      queuedEdit !== null &&
      current?.editSessionId === queuedEdit.editSessionId &&
      current.ownerThreadId === queuedEdit.ownerThreadId &&
      current.queuedMessageId === queuedEdit.queuedMessageId;
    const scope: PluginComposerHost["scope"] | null =
      queuedEdit === null
        ? bottomScope
        : {
            kind: "queued-message",
            threadId: queuedEdit.ownerThreadId,
            queuedMessageId: queuedEdit.queuedMessageId,
          };
    if (scope === null) {
      return null;
    }

    return {
      scope,
      textEffectKey: identity,
      ...(threadRowStatusThreadId !== undefined
        ? { threadRowStatusThreadId }
        : {}),
      draft: activeComposerDraftRef.current,
      getCurrent: () => {
        if (activeComposerIdentityRef.current !== identity) {
          return initialDraft;
        }
        const currentQueuedEdit = committedInlineEditRef.current;
        return isCurrentQueuedEdit(currentQueuedEdit)
          ? currentQueuedEdit.draft
          : currentPromptDraftRef.current;
      },
      setDraft: (draft) => {
        if (activeComposerIdentityRef.current !== identity) {
          return;
        }
        if (queuedEdit !== null) {
          updateInlineQueuedMessage((current) =>
            isCurrentQueuedEdit(current) ? { ...current, draft } : current,
          );
          return;
        }
        setStoredPromptDraft(draft);
      },
      focus: () => {
        if (activeComposerIdentityRef.current === identity) {
          setComposerFocusNonce((nonce) => nonce + 1);
        }
      },
    };
  }, [
    activeComposerHostIdentity,
    bottomScope,
    inlineEditingQueuedMessageRef,
    queuedComposerIdentity,
    setStoredPromptDraft,
    threadRowStatusThreadId,
    updateInlineQueuedMessage,
  ]);
  const pluginComposerHostWithDraft = useMemo<PluginComposerHost | null>(
    () =>
      pluginComposerHost === null
        ? null
        : { ...pluginComposerHost, draft: activeComposerDraft },
    [activeComposerDraft, pluginComposerHost],
  );
  const activePluginComposerHost = isActive ? pluginComposerHostWithDraft : null;
  const composerTextEffect = useComposerTextEffect(
    activePluginComposerHost?.textEffectKey ?? null,
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

  const composerConfig = useMemo<FollowUpComposerProps>(
    () => ({
      // No prompt-history surface here. A draft-only history config (current
      // draft, no entries) satisfies the required shape without inventing a
      // feature the composer never exercises.
      history: {
        currentDraft: activeComposerDraft,
        entries: [],
        onSelectEntry: setActiveComposerDraft,
      } satisfies HistoryConfig,
      isFollowUpSubmitting: isTurnSubmitting || isUpdateQueuedMessagePending,
      message: activeComposerDraft.text,
      mentionRanges: activeComposerDraft.mentions,
      onChangeMessage: handleChangeMessage,
      onModifierSubmit: handleComposerModifierSubmit,
      onSubmit: handleComposerSubmit,
      compactPromptPlaceholder: compactComposerPlaceholder,
      promptPlaceholder: composerPlaceholder,
      canModifierSubmit: inlineEditingQueuedMessage
        ? activeComposerDraftInput.length > 0 && !isUpdateQueuedMessagePending
        : canSubmitModifierShortcut,
      submitMode: inlineEditingQueuedMessage
        ? ({ kind: "ready" } as const)
        : submitMode,
      threadRuntimeDisplayStatus: displayStatus,
    }),
    [
      activeComposerDraft,
      activeComposerDraftInput.length,
      canSubmitModifierShortcut,
      compactComposerPlaceholder,
      composerPlaceholder,
      displayStatus,
      handleChangeMessage,
      handleComposerModifierSubmit,
      handleComposerSubmit,
      inlineEditingQueuedMessage,
      isTurnSubmitting,
      isUpdateQueuedMessagePending,
      setActiveComposerDraft,
      submitMode,
    ],
  );

  const attachmentsConfig = useMemo<AttachmentsConfig>(
    () => ({
      items: activeComposerDraft.attachments,
      projectId,
      isAttaching,
      error: attachmentError,
      onAttachFiles: handleAttachFiles,
      onRemove: removeActiveComposerAttachment,
    }),
    [
      activeComposerDraft.attachments,
      attachmentError,
      handleAttachFiles,
      isAttaching,
      projectId,
      removeActiveComposerAttachment,
    ],
  );

  const executionConfig = useMemo<ExecutionControlsProps>(
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
          : activeModel,
        selected: inlineEditingQueuedMessage
          ? inlineEditingQueuedMessage.model
          : selectedModel,
        options: modelOptions,
        moreOptions: moreModelOptions,
        loadError: modelLoadError,
        isLoading: isLoadingModels,
        loadFailed: modelLoadFailed,
        onChange: setSelectedModel,
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
    }),
    [
      activeModel,
      executionOptionsRouting,
      hasMultipleProviders,
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
      setSelectedModel,
      setServiceTier,
      supportsServiceTier,
    ],
  );

  const permissionConfig = useMemo<ExecutionPermissionConfig>(
    () =>
      composer.permissionPolicy === "snapshot"
        ? {
            // Sourced from the same resolved-defaults value snapshot sends use,
            // so the displayed label can't drift from the permission the thread
            // actually runs with. Undefined until defaults load, which keeps
            // the picker hidden rather than guessing.
            value:
              inlineEditingQueuedMessage?.permissionMode ??
              snapshotPermissionMode,
            options: permissionModeOptions,
            onChange: () => {},
            supported: supportsPermissionModeSelection,
          }
        : {
            value:
              inlineEditingQueuedMessage?.permissionMode ?? permissionMode,
            options: permissionModeOptions,
            onChange: setPermissionMode,
            supported: supportsPermissionModeSelection,
          },
    [
      composer.permissionPolicy,
      inlineEditingQueuedMessage?.permissionMode,
      permissionMode,
      permissionModeOptions,
      setPermissionMode,
      snapshotPermissionMode,
      supportsPermissionModeSelection,
    ],
  );

  const composerStatusStack = useMemo(
    () => (
      <>
        {isActive ? (
          <PluginComposerStatuses projectId={projectId} threadId={threadId} />
        ) : null}
        {queuedMessages.length > 0 ? (
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
        ) : null}
      </>
    ),
    [
      beginEditQueuedMessage,
      handleDeleteQueuedMessage,
      handleReorderQueuedMessage,
      handleSendQueuedImmediately,
      handleSetQueuedMessageGroupBoundary,
      inlineEditor,
      isActive,
      isProvisioning,
      processingQueuedMessage?.action,
      processingQueuedMessage?.id,
      projectId,
      queuedMessageActionPending,
      queuedMessages,
      resolveMentionLink,
      threadId,
    ],
  );

  const footer = (
    <div className="relative bg-background">
      <OverflowFade placement="above" tone="background" />
      <div className="px-4 pb-4 pt-2">
        <FollowUpPromptBox
          attachments={attachmentsConfig}
          stack={composerStatusStack}
          composer={composerConfig}
          pluginComposerHost={activePluginComposerHost}
          textEffect={composerTextEffect}
          composerTarget={inlineComposerTarget}
          environmentSummary={composer.environmentSummary}
          contextWindowUsage={null}
          execution={executionConfig}
          executionReadOnly={inlineEditingQueuedMessage !== null}
          permission={permissionConfig}
          permissionReadOnly={
            composer.permissionPolicy === "snapshot" ||
            inlineEditingQueuedMessage !== null
          }
          typeahead={typeaheadConfig}
          promptActions={promptActions}
          suppressPluginComposerAccessories={!isActive}
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
        onSendToMainMessage={onSendToMainMessage}
        onMessageAddToChat={handleAddToChat}
        onSelectionAddToChat={handleAddToChat}
        provisioningLabel={labels.provisioning}
        rowFilter={rowFilter}
        showLoadOlderRows={showLoadOlderRows}
        threadId={threadId}
        timeline={timeline}
        timelineErrorLabel={labels.timelineError}
      />
    ) : (
      <ThreadTimelineSurface
        activeThinking={null}
        leadingContent={leadingContent}
        isThreadTimelinePending={false}
        timelineError={false}
        showOngoingIndicator={isTurnSubmitting}
        ongoingIndicatorLabel={labels.draftSubmitting}
        timelineRows={draftModeTimelineRows ? [...draftModeTimelineRows] : []}
        threadId={surfaceKey}
        threadRuntimeDisplayStatus="starting"
        workspaceRootPath={undefined}
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
        className="flex min-w-0 flex-col bg-background"
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
    <div data-thread-window="" className="flex min-h-0 flex-1 flex-col">
      <BottomAnchoredScrollBody
        key={surfaceKey}
        scrollAreaClassName="bg-background"
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
