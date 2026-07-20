import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Environment,
  PromptInput,
  PromptTextMention,
  Thread,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type {
  TimelineConversationAttachments,
  TimelineRow,
  TimelineUserConversationRow,
} from "@bb/server-contract";
import {
  formatEnvironmentDisplay,
  type EnvironmentDisplayHostContext,
} from "@bb/core-ui";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { ThreadEnvironmentSummary } from "@/components/promptbox/ThreadEnvironmentSummary";
import {
  EmbeddedThreadChat,
  hideProvisioningTimelineRow,
  type EmbeddedThreadChatExecutionContext,
} from "@/components/thread/embedded-chat";
import {
  isRunningThreadRuntimeDisplayStatus,
  useThreadTimelineController,
  type ThreadTimelineSendToMainMessageHandler,
} from "@/components/thread/timeline";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useThread } from "@/hooks/queries/thread-queries";
import { useThreadQueuedMessages } from "@/hooks/queries/thread-queries";
import {
  useCreateThread,
  useCreateThreadQueuedMessage,
  useSendThreadMessage,
} from "@/hooks/mutations/thread-runtime-mutations";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { formatWorkspaceCheckoutDisplay } from "@/lib/workspace-checkout-display";
import {
  buildSideChatCreateRequest,
  buildSideChatMessageInput,
  resolveSideChatReplyReference,
} from "@/lib/side-chat-create-request";
import type { SideChatFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { Icon } from "@bb/shared-ui/icon";
import { MarkdownPreview } from "@/components/ui/markdown-preview.js";

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
 * Hosts a message-anchored side chat: the child thread's conversation and the
 * shared composer, rendered by `EmbeddedThreadChat`. This wrapper keeps the
 * side-chat controller policy: the child thread is created by the user's first
 * submit (opening a side chat is just a draft surface until then), the
 * anchored-message reply reference is carried into the first turn, permission
 * is snapshotted from the source thread's effective mode at creation, and each
 * side-chat agent reply carries a per-message "send to main thread" action that
 * posts that reply into the main thread via the existing cross-thread send
 * transport (`senderThreadId`).
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
  const sendThreadMessage = useSendThreadMessage();
  const { isLocalDaemonHost } = useHostDaemon();
  const childThreadQuery = useThread(childThreadId ?? "", {
    enabled: childThreadId !== null,
  });
  const { data: queuedMessages = [] } = useThreadQueuedMessages(
    childThreadId ?? "",
    {
      enabled: childThreadId !== null,
    },
  );

  // `tab.threadId` only flips after async create resolves and panel state
  // propagates. Keep the in-flight create promise here so repeated submit
  // attempts share one side-chat thread.
  const createThreadPromiseRef = useRef<Promise<string | null> | null>(null);
  const childThreadIdRef = useRef<string | null>(childThreadId);
  const childHasUserMessageRef = useRef(false);
  const createdInitialMessageThreadIdRef = useRef<string | null>(null);
  const observedChildThreadIdRef = useRef<string | null>(childThreadId);
  const queuedMessageCountRef = useRef(0);
  const [optimisticFirstUserRow, setOptimisticFirstUserRow] =
    useState<TimelineUserConversationRow | null>(null);

  // The anchored-message reply reference: present only when the anchor is NOT
  // the parent's last conversation message (the most recent exchange needs no
  // explicit pointer). When present it both renders as a "Replying to" quote
  // above the conversation and is carried into the first turn as agent-only
  // context. Captured at the parent's current timeline because the side-chat
  // anchor is fixed at open time.
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

  const childTimeline = useThreadTimelineController({
    enabled: childThreadId !== null,
    rowFilter: hideProvisioningTimelineRow,
    surfaceKey: childThreadId !== null ? `side-chat:${childThreadId}` : tab.id,
    threadId: childThreadId ?? "",
  });
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
    if (childHasUserMessage) {
      setOptimisticFirstUserRow(null);
    }
  }, [childHasUserMessage]);

  const sourceEnvironmentReady =
    sourceThread.environmentId === null || sourceEnvironment !== null;
  const createSideChatThread = useCallback(
    async (
      input: PromptInput[],
      execution: EmbeddedThreadChatExecutionContext,
    ): Promise<string | null> => {
      const existingThreadId = childThreadIdRef.current;
      if (existingThreadId !== null) {
        return existingThreadId;
      }
      if (createThreadPromiseRef.current !== null) {
        return createThreadPromiseRef.current;
      }
      if (
        !sourceEnvironmentReady ||
        execution.model.length === 0 ||
        execution.permissionMode === undefined
      ) {
        return null;
      }
      const request = buildSideChatCreateRequest({
        input,
        projectId: sourceThread.projectId,
        sourceThreadId: sourceThread.id,
        sourceEnvironment,
        providerId: sourceThread.providerId,
        model: execution.model,
        // Snapshotted from the source thread's effective mode at creation;
        // after that the child thread's own default execution options govern,
        // so later parent changes never mutate an existing side chat.
        permissionMode: execution.permissionMode,
        reasoningLevel: execution.reasoningLevel,
        serviceTier: execution.serviceTier,
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
      createThread,
      onSetThreadId,
      sourceEnvironment,
      sourceEnvironmentReady,
      sourceThread.id,
      sourceThread.projectId,
      sourceThread.providerId,
      tab.id,
      tab.sourceSeqEnd,
      tab.title,
    ],
  );

  const sendOrQueueSideChatInput = useCallback(
    async (
      visibleInput: PromptInput[],
      execution: EmbeddedThreadChatExecutionContext,
    ) => {
      const input = buildSideChatMessageInput({
        includeReplyReference:
          !childHasUserMessageRef.current &&
          queuedMessageCountRef.current === 0,
        replyReference,
        visibleInput,
      });
      const existingThreadId = childThreadIdRef.current;
      if (existingThreadId === null) {
        const createdThreadId = await createSideChatThread(input, execution);
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
          ...execution.executionRequestFields,
        });
      } else {
        await sendThreadMessage.mutateAsync({
          id: existingThreadId,
          input,
          mode: "queue-if-active",
          ...execution.executionRequestFields,
        });
      }
    },
    [
      childThreadQuery.data?.runtime.displayStatus,
      createQueuedMessage,
      createSideChatThread,
      replyReference,
      sendThreadMessage,
    ],
  );

  const handleDraftSubmitted = useCallback(
    (input: PromptInput[]) => {
      const shouldShowOptimisticFirstMessage =
        childThreadIdRef.current === null &&
        !childHasUserMessageRef.current &&
        queuedMessageCountRef.current === 0;
      if (shouldShowOptimisticFirstMessage) {
        setOptimisticFirstUserRow(
          buildOptimisticSideChatUserRow({
            createdAt: Date.now(),
            input,
            tabId: tab.id,
            threadId: childThreadIdRef.current ?? tab.id,
          }),
        );
      }
    },
    [tab.id],
  );
  const handleDraftSubmitError = useCallback(() => {
    setOptimisticFirstUserRow(null);
  }, []);

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
  const sideChatRuntimeDisplayStatus =
    childThreadQuery.data?.runtime.displayStatus ?? "idle";
  const canSendMessageToMain = !isRunningThreadRuntimeDisplayStatus(
    sideChatRuntimeDisplayStatus,
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

  const promptContextEnvironmentId =
    childThreadQuery.data?.environmentId ?? sourceThread.environmentId ?? null;

  return (
    <EmbeddedThreadChat
      variant="compact"
      threadId={childThreadId}
      surfaceFallbackKey={tab.id}
      projectId={sourceThread.projectId}
      providerId={sourceThread.providerId}
      promptContextEnvironmentId={promptContextEnvironmentId}
      isActive={isActive}
      resolveMentionLink={resolveMentionLink}
      timeline={childThreadId !== null ? displayedChildTimeline : undefined}
      rowFilter={hideProvisioningTimelineRow}
      leadingContent={sideChatLeadingContent}
      draftModeTimelineRows={
        optimisticFirstUserRow === null ? [] : [optimisticFirstUserRow]
      }
      showLoadOlderRows={false}
      onSendToMainMessage={canSendMessageToMain ? sendMessageToMain : undefined}
      labels={{
        placeholder: "Reply in the side chat…",
        stopping: "Stopping side chat...",
        provisioning: "Provisioning side chat...",
        compactProvisioning: "Setting up side chat...",
        missingThread: "This side chat is no longer available.",
        timelineError: "Failed to load side chat",
        draftSubmitting: "Starting side chat...",
        sendError: "Failed to send side chat message",
      }}
      composer={{
        draftScope: {
          kind: "side-chat",
          parentThreadId: sourceThread.id,
          tabId: tab.id,
        },
        // Seeded from the parent thread while the side chat is a draft and from
        // the child thread after creation. Provider stays locked to the parent.
        executionDefaultsThreadId: childThreadId ?? sourceThread.id,
        executionResetKey: sourceThread.id,
        executionEnvironmentId: sourceThread.environmentId ?? undefined,
        deferExecutionOptionsUntilActive: true,
        permissionPolicy: "snapshot",
        environmentSummary,
        contextWindowUsage: null,
        // A side chat is a secondary composer: it stays mounted (often hidden)
        // inside its pane, so it must not answer the pane-scoped Cmd+Shift+C /
        // Cmd+Shift+M fallback unless the caret is actually inside it.
        isPrimaryComposer: false,
        pluginComposerBottomScope: {
          kind: "side-chat",
          projectId: sourceThread.projectId,
          parentThreadId: sourceThread.id,
          tabId: tab.id,
          childThreadId,
        },
        composerIdentity: `side-chat:${sourceThread.projectId}:${sourceThread.id}:${tab.id}:${childThreadId ?? ""}`,
        threadRowStatusThreadId: sourceThread.id,
        isExternalSubmitPending: createQueuedMessage.isPending,
        onSendOrQueueInput: sendOrQueueSideChatInput,
        onDraftSubmitted: handleDraftSubmitted,
        onDraftSubmitError: handleDraftSubmitError,
      }}
    />
  );
}
