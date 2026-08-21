import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { defaultAppSettings, type PromptInput } from "@bb/domain";
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
  type ThreadTimelineSurfaceProps,
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
} from "@bb/client-core";
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

interface EmbeddedThreadChatLabels {
  /** Composer placeholder while the thread is idle/active. */
  placeholder: string;
  stopping: string;
  provisioning: string;
  sendError: string;
}

const DEFAULT_LABELS: EmbeddedThreadChatLabels = {
  placeholder: "Reply…",
  stopping: "Stopping thread...",
  provisioning: "Provisioning thread...",
  sendError: "Failed to send message",
};

interface EmbeddedThreadChatComposerProps {
  draftScope: PromptDraftScope;
  /** Thread whose resolved defaults seed the execution controls (the parent thread while drafting). */
  executionDefaultsThreadId: string;
  executionResetKey: string;
  executionEnvironmentId?: string;
  /** Machine of `executionEnvironmentId`; lets host-scoped catalogs share one query across environments. */
  executionEnvironmentHostId?: string;
  permissionPolicy: "editable" | "snapshot";
  environmentSummary: ReactNode;
  /** Plugin composer host scope for the bottom draft. Null disables the host. */
  pluginComposerBottomScope?: PluginComposerHost["scope"] | null;
  /** Identity string namespacing this composer among retained instances. */
  composerIdentity?: string;
  /**
   * External focus nonce: every change focuses the composer caret at the end
   * of the draft (the initial value does not). Combined with the component's
   * own internal focus nonce.
   */
  focusRequestKey?: number;
}

interface EmbeddedThreadChatSharedProps {
  threadId: string;
  projectId: string;
  providerId: string;
  /** Environment context for mentions and command suggestions. */
  promptContextEnvironmentId: string | null;
  resolveMentionLink: PromptMentionLinkResolver;
  leadingContent?: ReactNode;
  /** Surface-scoped consumer actions for the per-message action bar. */
  consumerMessageActions?: readonly ThreadTimelineConsumerMessageAction[];
  /**
   * Whether slot-registered plugin message actions render in this surface's
   * timeline. Embedded consumers (plugin ThreadChat, the side-chat panel)
   * pass false; the main thread keeps the default.
   */
  includePluginMessageActions?: boolean;
  onOpenLink?: ThreadTimelineLinkHandler;
  onOpenLocalFileLink?: ThreadTimelineLocalFileLinkHandler;
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

interface EmbeddedThreadChatComposerModeProps extends EmbeddedThreadChatSharedProps {
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
interface EmbeddedThreadChatHostedFooterProps {
  variant: "hosted-footer";
  footer: ReactNode;
  scrollOverlay?: ReactNode;
  surface: ThreadTimelineSurfaceProps;
  composer?: never;
}

type EmbeddedThreadChatProps =
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
        key={surface.threadId}
        scrollBehavior="bottom-anchor"
        scrollAnchorThreadId={surface.threadId}
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
  projectId,
  providerId,
  promptContextEnvironmentId,
  resolveMentionLink,
  leadingContent,
  consumerMessageActions,
  includePluginMessageActions,
  onOpenLink,
  onOpenLocalFileLink,
  workspaceRootPath,
  layout = "contained",
  measure = "panel",
  surfaceTone = "background",
  composer,
}: EmbeddedThreadChatComposerModeProps) {
  const labels = DEFAULT_LABELS;
  const systemConfigQuery = useSystemConfig();
  const steerActiveThreadOnEnter =
    systemConfigQuery.data?.generalSettings.steerActiveThreadOnEnter ??
    defaultAppSettings.steerActiveThreadOnEnter;
  const surfaceKey = threadId;
  const markThreadRead = useMarkThreadRead();
  const stopThread = useStopThread();
  const sendThreadMessage = useSendThreadMessage();
  const createQueuedMessage = useCreateThreadQueuedMessage();
  const threadQuery = useThread(threadId);
  const pendingInteractionsQuery = useThreadPendingInteractions(threadId);
  const activePendingInteraction = getLatestPendingInteraction(
    pendingInteractionsQuery.data,
  );
  useThreadReadTracking({
    markThreadRead,
    thread: threadQuery.data,
  });
  const { data: queuedMessages = [] } = useThreadQueuedMessages(threadId);

  const executionOptionsQuery = useThreadDefaultExecutionOptions(
    composer.executionDefaultsThreadId,
    { enabled: true },
  );
  const defaultExecutionOptions = executionOptionsQuery.data;
  const threadCreationOptions = useThreadCreationOptions({
    enabled: true,
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
    currentThreadId: threadId,
    selectedProviderComposerActions,
    resolveMentionLink,
  });

  const isStopRequested =
    threadQuery.data?.status === "stopping" ||
    (stopThread.isPending && stopThread.variables === threadId);
  const handleStopThread = useCallback(() => {
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
  const handleSubmit = useCallback(() => {
    const submittedDraft = currentPromptDraft;
    const submittedInput = currentPromptDraftInput;
    if (submittedInput.length === 0 || isTurnSubmitting) {
      return;
    }
    promptDraft.clearIfCurrentMatches(submittedDraft);
    setBottomAttachmentError(null);
    setIsTurnSubmitting(true);
    void defaultSendOrQueueInput(submittedInput)
      .catch((error) => {
        if (!isMountedRef.current) {
          return;
        }
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
    isTurnSubmitting,
    labels.sendError,
    promptDraft,
    setBottomAttachmentError,
  ]);

  const isQueueMutationPending =
    queuedMessageActionPending || createQueuedMessage.isPending;
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
    if (!canSubmitModifierShortcut) {
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
        `${composer.composerIdentity ?? surfaceKey}:bottom:active`,
      ),
    [composer.composerIdentity, surfaceKey],
  );
  const queuedComposerHostIdentity = useMemo(
    () =>
      queuedComposerIdentity
        ? createPluginComposerHostIdentity(
            `queued-message:${queuedComposerIdentity.ownerThreadId}:${queuedComposerIdentity.queuedMessageId}:${queuedComposerIdentity.editSessionId}:active`,
          )
        : null,
    [queuedComposerIdentity],
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
    activeBottomComposerIdentityRef.current = bottomComposerHostIdentity;
    return () => {
      if (
        activeBottomComposerIdentityRef.current === bottomComposerHostIdentity
      ) {
        activeBottomComposerIdentityRef.current = null;
      }
    };
  }, [bottomComposerHostIdentity]);
  useLayoutEffect(() => {
    activeQueuedComposerIdentityRef.current =
      queuedComposerHostIdentity ?? null;
    return () => {
      if (
        activeQueuedComposerIdentityRef.current === queuedComposerHostIdentity
      ) {
        activeQueuedComposerIdentityRef.current = null;
      }
    };
  }, [queuedComposerHostIdentity]);
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
  const activeBottomPluginComposerHost = bottomPluginComposerHostWithDraft;
  const activeQueuedPluginComposerHost = queuedPluginComposerHostWithDraft;
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
      onModifierSubmit: handleModifierSubmit,
      onSubmit: handleSubmit,
      compactPromptPlaceholder: composerPlaceholder,
      promptPlaceholder: composerPlaceholder,
      canModifierSubmit: canSubmitModifierShortcut,
      steerActiveThreadOnEnter,
      submitMode,
      threadRuntimeDisplayStatus: displayStatus,
    }),
    [
      canSubmitModifierShortcut,
      composerPlaceholder,
      currentPromptDraft,
      displayStatus,
      handleModifierSubmit,
      handleSubmit,
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
            compactPromptPlaceholder: composerPlaceholder,
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
          sendDisabled={isProvisioning || queuedMessageActionPending}
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
        threadId={threadId}
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
  const timelineBody = (
    <ThreadTimelinePanelContent
      isTurnSubmitting={isTurnSubmitting}
      leadingContent={leadingContent}
      consumerMessageActions={consumerMessageActions}
      includePluginMessageActions={includePluginMessageActions}
      onOpenLink={onOpenLink}
      onOpenLocalFileLink={onOpenLocalFileLink}
      onMessageAddToChat={handleAddToChat}
      onSelectionAddToChat={handleAddToChat}
      projectId={projectId}
      resolveMentionLink={resolveMentionLink}
      threadId={threadId}
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
        scrollAnchorThreadId={threadId}
      >
        {timelineBody}
      </BottomAnchoredScrollBody>
    </div>
  );
}
