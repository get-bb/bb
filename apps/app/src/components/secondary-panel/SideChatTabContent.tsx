import { useCallback, useMemo, useRef, useState } from "react";
import type { Environment, PromptTextMention } from "@bb/domain";
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
import type {
  ExecutionControlsProps,
  ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Icon } from "@/components/ui/icon.js";
import {
  messageBodyHasQuote,
  renderMessageBodyWithQuotes,
} from "@/components/thread/timeline/ConversationMessageMentions";
import { cn } from "@/lib/utils";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@/components/ui/coarse-pointer-sizing";
import { Skeleton } from "@/components/ui/skeleton.js";
import {
  ThreadTimelineRows,
  type ThreadTimelineSendToMainMessageHandler,
} from "@/components/thread/timeline";
import { usePreferredTheme } from "@/hooks/useTheme";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import {
  useThread,
  useThreadDefaultExecutionOptions,
  useThreadTimeline,
} from "@/hooks/queries/thread-queries";
import {
  useCreateThread,
  useSendThreadMessage,
} from "@/hooks/mutations/thread-runtime-mutations";
import {
  SIDE_CHAT_PERMISSION_MODE,
  buildSideChatCreateRequest,
  resolveSideChatReplyReference,
} from "@/lib/side-chat-create-request";
import { HttpError } from "@/lib/api";
import type { SideChatFixedPanelTab } from "@/lib/fixed-panel-tabs-state";

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
  threadId: string;
  /**
   * Hand a side-chat agent message back to the main thread (the per-message
   * "send to main" action). Undefined while the side chat is mid-turn, which
   * keeps the action out of the bar until the reply is final.
   */
  onSendToMainMessage: ThreadTimelineSendToMainMessageHandler | undefined;
}

/**
 * The created side chat's own conversation. Reuses the canonical
 * `ThreadTimelineRows` renderer (no fork/side-chat actions — a side chat does
 * not spawn further children in v1); each agent reply gets a "send to main
 * thread" action via `onSendToMainMessage`. Live updates flow through the global
 * thread realtime subscription into the timeline query cache.
 */
function SideChatConversation({
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
  const displayStatus = threadQuery.data?.runtime.displayStatus ?? "idle";

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

  if (timelineQuery.isPending && rows.length === 0) {
    return (
      <div className="space-y-2 px-2 pt-2">
        <Skeleton className="h-4 w-3/4 rounded-sm" />
        <Skeleton className="h-4 w-2/3 rounded-sm" />
        <Skeleton className="h-4 w-1/2 rounded-sm" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyStatePanel className="mx-2 rounded-lg">
        Waiting for the side chat to respond…
      </EmptyStatePanel>
    );
  }

  return (
    <ThreadTimelineRows
      themeType={preferredTheme}
      timelineRows={[...rows]}
      threadId={threadId}
      threadRuntimeDisplayStatus={displayStatus}
      onSendToMainMessage={onSendToMainMessage}
      workspaceRootPath={undefined}
    />
  );
}

/**
 * Hosts a message-anchored side chat: the child thread's conversation above the
 * shared `FollowUpPromptBox` composer (the same component the main thread uses)
 * with its footer in read-only mode — the side chat inherits the parent's
 * provider/model and is always read-only. The child thread is created lazily on
 * the user's first submit (`tab.threadId === null`); later submits send
 * follow-up turns. Once a thread exists, each side-chat agent reply carries a
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
  // Synchronous guard against a double create: `tab.threadId` only flips to the
  // new id after the async create resolves and the panel state propagates, so a
  // second submit in that window would otherwise spawn a second child thread.
  // (`createThread.isPending` lags a synchronous re-submit.) Cleared on settle.
  const createInFlightRef = useRef(false);

  const [message, setMessage] = useState("");
  const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>([]);
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

  const submitText = useCallback(
    (text: string) => {
      if (childThreadId !== null) {
        sendThreadMessage.mutate({
          id: childThreadId,
          input: [{ type: "text", text, mentions: [] }],
          mode: "auto",
        });
        return;
      }

      if (createInFlightRef.current) {
        return;
      }
      const executionOptions = executionOptionsQuery.data;
      if (!executionOptions) {
        return;
      }
      // A host-backed source whose environment query hasn't resolved yet would
      // fall back to a personal workspace, which the server rejects outside the
      // personal project. Wait for the environment before creating. A personal
      // source (no environmentId) legitimately has a null environment.
      if (sourceThread.environmentId !== null && sourceEnvironment === null) {
        return;
      }
      const request = buildSideChatCreateRequest({
        projectId: sourceThread.projectId,
        sourceThreadId: sourceThread.id,
        sourceEnvironment,
        question: text,
        replyReference,
        providerId: sourceThread.providerId,
        model: executionOptions.model,
        title: tab.title,
      });
      createInFlightRef.current = true;
      createThread.mutate(request, {
        onSuccess: (thread) => {
          onSetThreadId({ tabId: tab.id, threadId: thread.id });
        },
        onSettled: () => {
          createInFlightRef.current = false;
        },
      });
    },
    [
      childThreadId,
      createThread,
      executionOptionsQuery.data,
      onSetThreadId,
      replyReference,
      sendThreadMessage,
      sourceEnvironment,
      sourceThread.environmentId,
      sourceThread.id,
      sourceThread.projectId,
      sourceThread.providerId,
      tab.id,
      tab.title,
    ],
  );

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim();
    if (trimmed.length === 0) {
      return;
    }
    submitText(trimmed);
    setMessage("");
    setMentionRanges([]);
  }, [message, submitText]);

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

  const isCreating = createThread.isPending;
  const composerPlaceholder =
    childThreadId === null
      ? "Ask a question about this conversation…"
      : "Reply in the side chat…";

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
      isFollowUpSubmitting: isCreating || sendThreadMessage.isPending,
      message,
      mentionRanges,
      onChangeMessage: handleChangeMessage,
      onModifierSubmit: noop,
      onSubmit: handleSubmit,
      promptPlaceholder: composerPlaceholder,
      canModifierSubmit: false,
      submitMode: { kind: "ready" },
      threadRuntimeDisplayStatus:
        childThreadQuery.data?.runtime.displayStatus ?? "idle",
    }),
    [
      childThreadQuery.data?.runtime.displayStatus,
      composerPlaceholder,
      handleChangeMessage,
      handleSubmit,
      isCreating,
      mentionRanges,
      message,
      sendThreadMessage.isPending,
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
      return <ThreadEnvironmentSummary environmentLabel="Working locally" />;
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
            threadId={childThreadId}
            onSendToMainMessage={canSendToMain ? sendMessageToMain : undefined}
          />
        ) : hasTriggerMessage ? null : (
          // Empty state only for side chats opened from the new-tab page, which
          // have no trigger message to anchor on.
          <EmptyStatePanel className="flex min-h-24 flex-1 flex-col items-center justify-center gap-2 text-center">
            <Icon
              name="SideChat"
              className={cn(
                COARSE_POINTER_ICON_SIZE_CLASS,
                "shrink-0 text-subtle-foreground",
              )}
            />
            <p className={cn(COARSE_POINTER_TEXT_SM_CLASS, "max-w-64")}>
              Ask anything about this thread — the agent has the full
              conversation as context. Replies stay here, separate from the main
              thread.
            </p>
          </EmptyStatePanel>
        )}
      </div>
      <div className="px-4 pb-4 pt-2">
        <FollowUpPromptBox
          attachments={SIDE_CHAT_ATTACHMENTS}
          stack={null}
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
