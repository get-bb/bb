import { useCallback, useMemo, useRef, useState } from "react";
import type { Environment, PromptTextMention } from "@bb/domain";
import type { Thread } from "@bb/domain";
import type { TimelineRow } from "@bb/server-contract";
import {
  PromptBoxInternal,
  type MentionsConfig,
} from "@/components/promptbox/PromptBoxInternal";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { EmptyStatePanel } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { ThreadTimelineRows } from "@/components/thread/timeline";
import { usePreferredTheme } from "@/hooks/useTheme";
import {
  useThread,
  useThreadDefaultExecutionOptions,
  useThreadTimeline,
} from "@/hooks/queries/thread-queries";
import {
  useCreateThread,
  useSendThreadMessage,
} from "@/hooks/mutations/thread-runtime-mutations";
import { buildSideChatContextSnapshot } from "@/lib/side-chat-context-snapshot";
import { buildSideChatCreateRequest } from "@/lib/side-chat-create-request";
import { HttpError } from "@/lib/api";
import type { SideChatFixedPanelTab } from "@/lib/fixed-panel-tabs-state";

// Side chats are conversation-only in v1 (no @-mentions / file reach), so the
// composer is wired with an inert mentions config rather than the thread
// mention-search stack. Keeping it explicit (not dead config) documents the
// intentional v1 scope.
const SIDE_CHAT_MENTIONS: MentionsConfig = {
  suggestions: [],
  isLoading: false,
  isError: false,
  onQueryChange: () => {},
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
  /** The main thread's timeline rows, snapshotted into the first turn. */
  sourceTimelineRows: readonly TimelineRow[];
  onSetThreadId: SetSideChatThreadId;
}

interface SideChatComposerProps {
  placeholder: string;
  submitDisabled: boolean;
  onSubmitText: (text: string) => void;
}

function SideChatComposer({
  placeholder,
  submitDisabled,
  onSubmitText,
}: SideChatComposerProps) {
  const [value, setValue] = useState("");
  const [mentionRanges, setMentionRanges] = useState<
    readonly PromptTextMention[]
  >([]);
  const handleChange = useCallback(
    (nextValue: string, nextMentions: PromptTextMention[]) => {
      setValue(nextValue);
      setMentionRanges(nextMentions);
    },
    [],
  );
  const handleSubmit = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return;
    }
    onSubmitText(trimmed);
    setValue("");
    setMentionRanges([]);
  }, [onSubmitText, value]);

  return (
    <PromptBoxInternal
      value={value}
      mentionRanges={mentionRanges}
      onChange={handleChange}
      onSubmit={handleSubmit}
      placeholder={placeholder}
      mentions={SIDE_CHAT_MENTIONS}
      mentionMenuPlacement="top"
      autoFocus
      submission={{ disabled: submitDisabled }}
    />
  );
}

interface SideChatConversationProps {
  threadId: string;
}

/**
 * The created side chat's own conversation. Reuses the canonical
 * `ThreadTimelineRows` renderer (no fork/side-chat actions — a side chat does
 * not spawn further children in v1). Live updates flow through the global thread
 * realtime subscription into the timeline query cache.
 */
function SideChatConversation({ threadId }: SideChatConversationProps) {
  const preferredTheme = usePreferredTheme();
  const threadQuery = useThread(threadId);
  const timelineQuery = useThreadTimeline(threadId);
  const rows = timelineQuery.data?.rows ?? [];
  const displayStatus =
    threadQuery.data?.runtime.displayStatus ?? "idle";

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
      workspaceRootPath={undefined}
    />
  );
}

/**
 * Hosts a message-anchored side chat: the child thread's conversation above a
 * focused composer. The child thread is created lazily on the user's first
 * submit (`tab.threadId === null`); later submits send follow-up turns. Once a
 * thread exists, a "Send to main thread" action posts the side chat's latest
 * result back into the main thread (rendered there as "Message from {side chat}")
 * via the existing cross-thread send transport (`senderThreadId`).
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
  const executionOptionsQuery = useThreadDefaultExecutionOptions(
    sourceThread.id,
  );
  const childTimelineQuery = useThreadTimeline(childThreadId ?? "", {
    enabled: childThreadId !== null,
  });
  // Synchronous guard against a double create: `tab.threadId` only flips to the
  // new id after the async create resolves and the panel state propagates, so a
  // second submit in that window would otherwise spawn a second child thread.
  // (`createThread.isPending` lags a synchronous re-submit.) Cleared on settle.
  const createInFlightRef = useRef(false);

  const handleSubmitText = useCallback(
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
      const contextSnapshot = buildSideChatContextSnapshot({
        rows: sourceTimelineRows,
        sourceMessageText: tab.sourceMessageText,
      });
      const request = buildSideChatCreateRequest({
        projectId: sourceThread.projectId,
        sourceThreadId: sourceThread.id,
        sourceEnvironment,
        question: text,
        contextSnapshot,
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
      sendThreadMessage,
      sourceEnvironment,
      sourceThread.environmentId,
      sourceThread.id,
      sourceThread.projectId,
      sourceThread.providerId,
      sourceTimelineRows,
      tab.id,
      tab.sourceMessageText,
      tab.title,
    ],
  );

  // The last assistant message in the side chat is the result to hand back.
  const lastAssistantText = useMemo(() => {
    const rows = childTimelineQuery.data?.rows ?? [];
    let result: string | null = null;
    const visit = (row: TimelineRow): void => {
      if (
        row.kind === "conversation" &&
        row.role === "assistant" &&
        row.text.trim().length > 0
      ) {
        result = row.text.trim();
        return;
      }
      if (row.kind === "turn" && row.children !== null) {
        for (const child of row.children) {
          visit(child);
        }
      }
    };
    for (const row of rows) {
      visit(row);
    }
    return result;
  }, [childTimelineQuery.data?.rows]);

  const canSendBack =
    childThreadId !== null &&
    lastAssistantText !== null &&
    !sendThreadMessage.isPending;

  const handleSendToMainThread = useCallback(() => {
    if (childThreadId === null || lastAssistantText === null) {
      return;
    }
    sendThreadMessage.mutate({
      id: sourceThread.id,
      input: [{ type: "text", text: lastAssistantText, mentions: [] }],
      mode: "auto",
      senderThreadId: childThreadId,
    });
  }, [
    childThreadId,
    lastAssistantText,
    sendThreadMessage,
    sourceThread.id,
  ]);

  const isCreating = createThread.isPending;
  const composerPlaceholder =
    childThreadId === null
      ? "Ask a question about this conversation…"
      : "Reply in the side chat…";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3">
        {childThreadId === null ? (
          <EmptyStatePanel className="mx-2 rounded-lg">
            Ask a question to start a side chat grounded in this conversation.
          </EmptyStatePanel>
        ) : (
          <SideChatConversation threadId={childThreadId} />
        )}
      </div>
      <div className="border-t border-border px-2 pb-2 pt-2">
        <SideChatComposer
          placeholder={composerPlaceholder}
          submitDisabled={isCreating}
          onSubmitText={handleSubmitText}
        />
        <div className="mt-1 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!canSendBack}
            onClick={handleSendToMainThread}
            title="Send the latest result to the main thread"
          >
            <Icon name="SideChat" className="size-3.5" />
            Send to main thread
          </Button>
        </div>
      </div>
    </div>
  );
}
