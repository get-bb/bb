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
import type { PluginComposerHost } from "@/components/plugin/plugin-composer-host";
import { withAutomationPromptAction } from "@/components/promptbox/PromptBoxActionsMenu";
import {
  QueuedMessagesList,
  type QueuedMessageEditRequest,
  type QueuedMessageGroupBoundaryRequest,
  type QueuedMessageInlineEditor,
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
import type { PromptDraftState } from "@/lib/prompt-draft";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { Icon } from "@bb/shared-ui/icon";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";
import { OverflowFade } from "@/components/ui/overflow-fade";
import {
  isRunningThreadRuntimeDisplayStatus,
  ThreadTimelinePanelContent,
  ThreadTimelineSurface,
  useThreadTimelineController,
  type ThreadTimelineAddToChatHandler,
  type ThreadTimelineRowFilter,
  type ThreadTimelineSendToMainMessageHandler,
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
  useUpdateThreadQueuedMessage,
} from "@/hooks/mutations/thread-runtime-mutations";
import { useMarkThreadRead } from "@/hooks/mutations/thread-state-mutations";
import { useThreadReadTracking } from "@/hooks/useThreadReadTracking";
import {
  buildSideChatCreateRequest,
  buildSideChatMessageInput,
  resolveSideChatReplyReference,
} from "@/lib/side-chat-create-request";
import type { SideChatFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { useComposerTextEffect } from "@/lib/composer-text-effects";
import { BbHttpError } from "@/lib/sdk";
import type { QueuedMessageReorderRequest } from "@/lib/queued-message-reorder";
import { appToast } from "@/components/ui/app-toast";
import { queuedInputToDraft } from "@/views/thread-detail/threadQueuedMessages";
import {
  buildSideChatSubmitMode,
  canSubmitFollowUpShortcut,
} from "@/views/thread-detail/threadDetailPromptSubmission";

const noop = () => {};

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
  onMessageAddToChat: ThreadTimelineAddToChatHandler | undefined;
  onSelectionAddToChat: ThreadTimelineAddToChatHandler | undefined;
}

const isVisibleSideChatTimelineRow: ThreadTimelineRowFilter = (row) =>
  !(
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind === "thread-provisioning"
  );

const SINGLE_FENCED_CODE_BLOCK_PATTERN =
  /^(?: {0,3})(`{3,}|~{3,})[^\r\n]*\r?\n[\s\S]*?\r?\n(?: {0,3})\1[ \t]*$/u;

function isSingleFencedCodeBlock(text: string): boolean {
  return SINGLE_FENCED_CODE_BLOCK_PATTERN.test(text);
}

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
  onMessageAddToChat,
  onSelectionAddToChat,
}: SideChatConversationProps) {
  return (
    <ThreadTimelinePanelContent
      isTurnSubmitting={isSideChatTurnSubmitting}
      leadingContent={leadingContent}
      missingThreadLabel="This side chat is no longer available."
      onSendToMainMessage={onSendToMainMessage}
      onMessageAddToChat={onMessageAddToChat}
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
 * with provider locked to the parent and permission snapshotted from the source
 * thread's effective mode at creation. The
 * child thread is created by the user's first submit, so opening a side chat is
 * just a draft surface until the user sends. Once a thread exists, each
 * side-chat agent reply carries a
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
  const updateQueuedMessage = useUpdateThreadQueuedMessage();
  const deleteQueuedMessage = useDeleteThreadQueuedMessage();
  const markThreadRead = useMarkThreadRead();
  const reorderQueuedMessage = useReorderThreadQueuedMessage();
  const sendQueuedMessage = useSendThreadQueuedMessage();
  const setQueuedMessageGroupBoundary =
    useSetThreadQueuedMessageGroupBoundary();
  const sendThreadMessage = useSendThreadMessage();
  const stopThread = useStopThread();
  const { isLocalDaemonHost } = useHostDaemon();
  const [shouldLoadExecutionOptions, setShouldLoadExecutionOptions] =
    useState(false);
  useEffect(() => {
    if (!isActive) {
      setShouldLoadExecutionOptions(false);
      return;
    }
    // The drawer itself is useful before model metadata is. Let its first
    // paint win over host-backed model discovery, which can take seconds on a
    // remote mobile session. Inactive retained side chats do not need this
    // metadata at all until the user returns to them.
    const timeoutId = window.setTimeout(
      () => setShouldLoadExecutionOptions(true),
      0,
    );
    return () => window.clearTimeout(timeoutId);
  }, [isActive]);
  const executionOptionsThreadId = childThreadId ?? sourceThread.id;
  const executionOptionsQuery = useThreadDefaultExecutionOptions(
    executionOptionsThreadId,
    { enabled: shouldLoadExecutionOptions },
  );
  const childThreadQuery = useThread(childThreadId ?? "", {
    enabled: childThreadId !== null,
  });
  useThreadReadTracking({
    markThreadRead,
    thread: isActive ? childThreadQuery.data : undefined,
  });
  // Build the SAME execution + permission configs the main thread builds (see
  // ThreadDetailPromptArea), seeded from the parent thread while the side chat
  // is a draft and from the child thread after creation. Provider stays locked
  // to the parent. Permission seeds from the source thread's effective mode and
  // is snapshotted into the child at creation; after that the child thread's
  // own default execution options govern, so later parent changes never mutate
  // an existing side chat.
  const defaultExecutionOptions = executionOptionsQuery.data;
  const threadCreationOptions = useThreadCreationOptions({
    enabled: shouldLoadExecutionOptions,
    scope: "component-local",
    environmentId: sourceThread.environmentId ?? undefined,
    resetKey: sourceThread.id,
    initialProviderId: sourceThread.providerId,
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
  // The side chat's effective permission mode: the source thread's effective
  // mode while the side chat is a draft (`executionOptionsThreadId` is the
  // parent), then the child thread's own mode once it exists. Sourced straight
  // from the thread's resolved defaults — not the provider-filtered picker
  // state — so a slow capabilities load can never widen the snapshot.
  const sideChatPermissionMode = defaultExecutionOptions?.permissionMode;
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
  const setStoredPromptDraft = promptDraft.setDraft;
  const setStoredPromptTextAndMentions = promptDraft.setTextAndMentions;
  const removeStoredPromptAttachment = promptDraft.removeAttachment;
  const promptContextEnvironmentId =
    childThreadQuery.data?.environmentId ?? sourceThread.environmentId ?? null;
  const promptContextThreadId = childThreadId ?? sourceThread.id;
  const promptMentions = usePromptMentions(sourceThread.projectId, {
    currentThreadId: promptContextThreadId,
    environmentId: promptContextEnvironmentId,
  });
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const providerPromptActions = useMemo(
    () => buildProviderPromptActionProps(selectedProviderComposerActions ?? []),
    [selectedProviderComposerActions],
  );
  const promptActions = useMemo(
    () => withAutomationPromptAction(providerPromptActions.promptActions),
    [providerPromptActions.promptActions],
  );
  const commandSuggestions = useCommandSuggestions({
    projectId: sourceThread.projectId,
    providerId: sourceThread.providerId,
    skillsTrigger: providerPromptActions.skillsTrigger,
    promptActions,
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
  const [inlineEditingQueuedMessage, setInlineEditingQueuedMessage] =
    useState<InlineQueuedMessageEditState | null>(null);
  const inlineEditSessionIdRef = useRef(0);
  const [inlineComposerTarget, setInlineComposerTarget] =
    useState<HTMLDivElement | null>(null);
  const dismissInlineQueuedMessageEditor = useCallback(() => {
    setInlineComposerTarget(null);
    setInlineEditingQueuedMessage(null);
  }, []);
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
  const currentPromptDraft = useMemo(
    () => ({
      text: promptDraft.text,
      mentions: promptDraft.mentions,
      attachments: promptDraft.attachments,
    }),
    [promptDraft.attachments, promptDraft.mentions, promptDraft.text],
  );
  const currentPromptDraftRef = useRef(currentPromptDraft);
  currentPromptDraftRef.current = currentPromptDraft;
  const inlineEditingQueuedMessageRef =
    useRef<InlineQueuedMessageEditState | null>(inlineEditingQueuedMessage);
  inlineEditingQueuedMessageRef.current = inlineEditingQueuedMessage;
  const currentPromptDraftInput = useMemo(
    () => promptDraftToInput(currentPromptDraft),
    [currentPromptDraft],
  );
  const activeComposerDraft =
    inlineEditingQueuedMessage?.draft ?? currentPromptDraft;
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
  const activeComposerIdentity = queuedComposerIdentity
    ? `queued-message:${queuedComposerIdentity.ownerThreadId}:${queuedComposerIdentity.queuedMessageId}:${queuedComposerIdentity.editSessionId}`
    : `side-chat:${sourceThread.projectId}:${sourceThread.id}:${tab.id}:${childThreadId ?? ""}`;
  const composerOwnershipRef = useRef({
    activeComposerIdentity,
    isActive,
    version: 0,
  });
  if (
    composerOwnershipRef.current.activeComposerIdentity !==
      activeComposerIdentity ||
    composerOwnershipRef.current.isActive !== isActive
  ) {
    composerOwnershipRef.current = {
      activeComposerIdentity,
      isActive,
      version: composerOwnershipRef.current.version + 1,
    };
  }
  const activeComposerHostIdentity = `${activeComposerIdentity}:ownership:${composerOwnershipRef.current.version}`;
  const activeComposerIdentityRef = useRef<string | null>(
    isActive ? activeComposerHostIdentity : null,
  );
  activeComposerIdentityRef.current = isActive
    ? activeComposerHostIdentity
    : null;
  const activeComposerDraftRef = useRef(activeComposerDraft);
  activeComposerDraftRef.current = activeComposerDraft;
  const pluginComposerHostBinding = useMemo<
    Omit<PluginComposerHost, "draft">
  >(() => {
    const identity = activeComposerHostIdentity;
    const initialDraft = activeComposerDraftRef.current;
    const queuedEdit = queuedComposerIdentity;
    const isCurrentQueuedEdit = (
      current: InlineQueuedMessageEditState | null,
    ): current is InlineQueuedMessageEditState =>
      queuedEdit !== null &&
      current?.editSessionId === queuedEdit.editSessionId &&
      current.ownerThreadId === queuedEdit.ownerThreadId &&
      current.queuedMessageId === queuedEdit.queuedMessageId;

    return {
      scope:
        queuedEdit === null
          ? {
              kind: "side-chat",
              projectId: sourceThread.projectId,
              parentThreadId: sourceThread.id,
              tabId: tab.id,
              childThreadId,
            }
          : {
              kind: "queued-message",
              threadId: queuedEdit.ownerThreadId,
              queuedMessageId: queuedEdit.queuedMessageId,
            },
      textEffectKey: identity,
      getCurrent: () => {
        if (activeComposerIdentityRef.current !== identity) {
          return initialDraft;
        }
        const currentQueuedEdit = inlineEditingQueuedMessageRef.current;
        return isCurrentQueuedEdit(currentQueuedEdit)
          ? currentQueuedEdit.draft
          : currentPromptDraftRef.current;
      },
      setDraft: (draft) => {
        if (activeComposerIdentityRef.current !== identity) {
          return;
        }
        if (queuedEdit !== null) {
          setInlineEditingQueuedMessage((current) =>
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
    childThreadId,
    queuedComposerIdentity,
    setStoredPromptDraft,
    sourceThread.id,
    sourceThread.projectId,
    tab.id,
  ]);
  const pluginComposerHost = useMemo<PluginComposerHost>(
    () => ({
      ...pluginComposerHostBinding,
      draft: activeComposerDraft,
    }),
    [activeComposerDraft, pluginComposerHostBinding],
  );
  const activePluginComposerHost = isActive ? pluginComposerHost : null;
  const composerTextEffect = useComposerTextEffect(
    activePluginComposerHost?.textEffectKey ?? null,
  );
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
      setStoredPromptDraft(draft);
    },
    [inlineEditingQueuedMessage, setStoredPromptDraft],
  );
  const handleChangeMessage = useCallback(
    (nextValue: string, nextMentions: PromptTextMention[]) => {
      if (inlineEditingQueuedMessage) {
        setInlineEditingQueuedMessage((current) =>
          current
            ? {
                ...current,
                draft: {
                  ...current.draft,
                  mentions: nextMentions,
                  text: nextValue,
                },
              }
            : current,
        );
        return;
      }
      setStoredPromptTextAndMentions(nextValue, nextMentions);
    },
    [inlineEditingQueuedMessage, setStoredPromptTextAndMentions],
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
      removeStoredPromptAttachment(path);
    },
    [inlineEditingQueuedMessage, removeStoredPromptAttachment],
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
  const triggerMessageIsSingleFence =
    isSingleFencedCodeBlock(triggerMessageText);

  const sourceEnvironmentReady =
    sourceThread.environmentId === null || sourceEnvironment !== null;
  const canCreateSideChatThread =
    childThreadId === null &&
    defaultExecutionOptions !== undefined &&
    sourceEnvironmentReady;
  const sideChatExecutionRequestFields = useMemo(
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
      // Omitted while the child's defaults are still loading — the server then
      // falls back to the thread's own stored default, which is the same value.
      ...(sideChatPermissionMode !== undefined
        ? { permissionMode: sideChatPermissionMode }
        : {}),
    }),
    [
      reasoningLevel,
      selectedExecutionModel,
      selectedExecutionServiceTier,
      sideChatPermissionMode,
    ],
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
  useEffect(() => {
    if (
      inlineEditingQueuedMessage &&
      (inlineEditingQueuedMessage.ownerThreadId !== childThreadId ||
        !queuedMessages.some(
          (message) =>
            message.id === inlineEditingQueuedMessage.queuedMessageId,
        ))
    ) {
      dismissInlineQueuedMessageEditor();
    }
  }, [
    childThreadId,
    dismissInlineQueuedMessageEditor,
    inlineEditingQueuedMessage,
    queuedMessages,
  ]);

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
      activeComposerIdentityRef.current = null;
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
      if (
        !canCreateSideChatThread ||
        selectedExecutionModel.length === 0 ||
        sideChatPermissionMode === undefined
      ) {
        return null;
      }
      const request = buildSideChatCreateRequest({
        input,
        projectId: sourceThread.projectId,
        sourceThreadId: sourceThread.id,
        sourceEnvironment,
        providerId: sourceThread.providerId,
        model: selectedExecutionModel,
        permissionMode: sideChatPermissionMode,
        reasoningLevel,
        serviceTier: selectedExecutionServiceTier,
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
      onSetThreadId,
      reasoningLevel,
      selectedExecutionModel,
      selectedExecutionServiceTier,
      sideChatPermissionMode,
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

  // A side chat hands results back to the main thread per agent message via the
  // cross-thread `senderThreadId` transport. Queue it on the main thread rather
  // than interrupting the user's active work there.
  const sendMessageToMain = useCallback<ThreadTimelineSendToMainMessageHandler>(
    (target) => {
      if (childThreadId === null || createQueuedMessage.isPending) {
        return;
      }
      createQueuedMessage.mutate({
        id: sourceThread.id,
        input: [{ type: "text", text: target.messageText, mentions: [] }],
        senderThreadId: childThreadId,
      });
    },
    [childThreadId, createQueuedMessage, sourceThread.id],
  );
  const handleSelectionAddToChat = useCallback<ThreadTimelineAddToChatHandler>(
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
  const compactComposerPlaceholder = isSideChatStopRequested
    ? "Stopping side chat..."
    : isSideChatProvisioning
      ? "Setting up side chat..."
      : "Reply in the side chat…";
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
            projectId: sourceThread.projectId,
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
      promptDraft.addAttachment,
      sourceThread.projectId,
      uploadPromptAttachment,
    ],
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
    sendQueuedMessage.isPending ||
    updateQueuedMessage.isPending;

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
    ({ queuedMessageId, queuedMessageIndex }: QueuedMessageEditRequest) => {
      if (childThreadId === null) {
        return;
      }
      const queuedMessage = queuedMessagesById.get(queuedMessageId);
      if (!queuedMessage) {
        return;
      }
      setInlineEditingQueuedMessage({
        draft: queuedInputToDraft(queuedMessage.content),
        editSessionId: (inlineEditSessionIdRef.current += 1),
        expectedUpdatedAt: queuedMessage.updatedAt,
        model: queuedMessage.model,
        ownerThreadId: childThreadId,
        permissionMode: queuedMessage.permissionMode,
        queuedMessageId,
        queuedMessageIndex,
        reasoningLevel: queuedMessage.reasoningLevel,
        serviceTier: queuedMessage.serviceTier,
      });
      setAttachmentError(null);
      setComposerFocusNonce((nonce) => nonce + 1);
    },
    [childThreadId, queuedMessagesById],
  );

  const handleSaveInlineQueuedMessage = useCallback(async () => {
    if (
      childThreadId === null ||
      !inlineEditingQueuedMessage ||
      activeComposerDraftInput.length === 0 ||
      updateQueuedMessage.isPending
    ) {
      return;
    }
    if (
      inlineEditingQueuedMessage.ownerThreadId !== childThreadId ||
      !queuedMessagesById.has(inlineEditingQueuedMessage.queuedMessageId)
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
    } catch (error) {
      if (error instanceof BbHttpError && error.status === 404) {
        dismissInlineQueuedMessageEditor();
      }
      appToast.error(
        getMutationErrorMessage({
          error,
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
    childThreadId,
    dismissInlineQueuedMessageEditor,
    inlineEditingQueuedMessage,
    queuedMessagesById,
    updateQueuedMessage,
  ]);

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
          resolveMentionLink={resolveMentionLink}
          inlineEditor={inlineEditor}
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
      inlineEditor,
      processingQueuedMessage?.action,
      processingQueuedMessage?.id,
      queuedMessageActionPending,
      queuedMessages,
      resolveMentionLink,
    ],
  );

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

  const composerConfig = useMemo<FollowUpComposerProps>(
    () => ({
      // Side chats have no prompt-history surface in v1. A draft-only history
      // config (current draft, no entries, no-op select) satisfies the required
      // shape without inventing a feature the composer never exercises.
      history: {
        currentDraft: activeComposerDraft,
        entries: [],
        onSelectEntry: setActiveComposerDraft,
      } satisfies HistoryConfig,
      isFollowUpSubmitting:
        isSideChatTurnSubmitting || updateQueuedMessage.isPending,
      message: activeComposerDraft.text,
      mentionRanges: activeComposerDraft.mentions,
      onChangeMessage: handleChangeMessage,
      onModifierSubmit: handleComposerModifierSubmit,
      onSubmit: handleComposerSubmit,
      compactPromptPlaceholder: compactComposerPlaceholder,
      promptPlaceholder: composerPlaceholder,
      canModifierSubmit: inlineEditingQueuedMessage
        ? activeComposerDraftInput.length > 0 && !updateQueuedMessage.isPending
        : canSubmitModifierShortcut,
      submitMode: inlineEditingQueuedMessage
        ? ({ kind: "ready" } as const)
        : sideChatSubmitMode,
      threadRuntimeDisplayStatus: sideChatRuntimeDisplayStatus,
    }),
    [
      activeComposerDraft,
      activeComposerDraftInput.length,
      canSubmitModifierShortcut,
      composerPlaceholder,
      handleChangeMessage,
      handleComposerModifierSubmit,
      handleComposerSubmit,
      inlineEditingQueuedMessage,
      isSideChatTurnSubmitting,
      compactComposerPlaceholder,
      setActiveComposerDraft,
      sideChatRuntimeDisplayStatus,
      sideChatSubmitMode,
      updateQueuedMessage.isPending,
    ],
  );

  const attachmentsConfig = useMemo<AttachmentsConfig>(
    () => ({
      items: activeComposerDraft.attachments,
      projectId: sourceThread.projectId,
      isAttaching: uploadPromptAttachment.isPending,
      error: attachmentError,
      onAttachFiles: handleAttachFiles,
      onRemove: removeActiveComposerAttachment,
    }),
    [
      activeComposerDraft.attachments,
      attachmentError,
      handleAttachFiles,
      removeActiveComposerAttachment,
      sourceThread.projectId,
      uploadPromptAttachment.isPending,
    ],
  );

  const typeaheadConfig = useMemo<TypeaheadConfig>(
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
      promptMentions.triggers,
      resolveMentionLink,
    ],
  );

  // Built the same shape as the main thread's executionConfig (see
  // ThreadDetailPromptArea). Provider remains locked because the child thread
  // clones the parent's provider session, but model/reasoning/service tier can
  // be changed before sending a side-chat turn.
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
    () => ({
      // Sourced from the same resolved-defaults value the create request
      // snapshots, so the displayed label can't drift from the permission the
      // side chat actually runs with. Undefined until defaults load, which
      // keeps the picker hidden rather than guessing.
      value:
        inlineEditingQueuedMessage?.permissionMode ?? sideChatPermissionMode,
      options: permissionModeOptions,
      onChange: noop,
      supported: supportsPermissionModeSelection,
    }),
    [
      inlineEditingQueuedMessage?.permissionMode,
      permissionModeOptions,
      sideChatPermissionMode,
      supportsPermissionModeSelection,
    ],
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
      identity: null,
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
          pluginComposerHost={activePluginComposerHost}
          textEffect={composerTextEffect}
          composerTarget={inlineComposerTarget}
          environmentSummary={environmentSummary}
          contextWindowUsage={null}
          execution={executionConfig}
          executionReadOnly={inlineEditingQueuedMessage !== null}
          permission={permissionConfig}
          permissionReadOnly
          typeahead={typeaheadConfig}
          promptActions={promptActions}
          zenModeResetKey={childThreadId ?? tab.id}
          focusEndKey={composerFocusNonce}
          // A side chat is a secondary composer: it stays mounted (often hidden)
          // inside its pane, so it must not answer the pane-scoped Cmd+Shift+C /
          // Cmd+Shift+M fallback unless the caret is actually inside it.
          isPrimaryComposer={false}
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
        <div
          className={
            triggerMessageIsSingleFence
              ? "break-words"
              : "max-h-20 overflow-hidden break-words"
          }
        >
          <MarkdownPreview
            content={triggerMessageText}
            className="text-xs leading-5 [&_blockquote]:my-1 [&_h1]:mb-1 [&_h1]:mt-0 [&_h1]:text-sm [&_h2]:mb-1 [&_h2]:mt-0 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:mt-0 [&_h3]:text-xs [&_li]:mb-0 [&_ol]:mb-1 [&_p]:mb-1 [&_ul]:mb-1"
          />
        </div>
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
            onMessageAddToChat={handleSelectionAddToChat}
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
