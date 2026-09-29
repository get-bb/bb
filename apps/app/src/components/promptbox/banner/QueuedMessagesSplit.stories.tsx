import { useCallback, useState, type ReactNode } from "react";
import type { PromptTextMention, ThreadQueuedMessage } from "@bb/domain";
import { makeThreadQueuedMessage } from "@bb/test-helpers/domain-fixtures";
import {
  EMPTY_ORDERED_MENTION_SUGGESTIONS,
  promptDraftToInput,
  queuedInputToDraft,
  type PromptDraftState,
} from "@bb/client-core";
import { FollowUpPromptBox } from "@/components/promptbox/FollowUpPromptBox";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  type AttachmentsConfig,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import type { ExecutionPermissionConfig } from "@/components/promptbox/ExecutionControls";
import { PageShell } from "@/components/ui/page-shell.js";
import { SplitPreviewProvider } from "@/lib/define-split";
import {
  applyQueuedMessageReorder,
  collectLeadQueuedMessageGroupIds,
  preserveLeadQueuedMessageGroupAfterReorder,
  type QueuedMessageReorderRequest,
} from "@/lib/queued-message-reorder";
import {
  LazyQueuedMessagesList,
  QueuedMessagesPendingCard,
  type QueuedMessageEditRequest,
  type QueuedMessageGroupBoundaryRequest,
} from "./LazyQueuedMessagesList";
import { makeExecutionControlsProps } from "../../../../.ladle/story-fixtures";

export default { title: "performance/Split review/Queued messages" };

const noop = () => {};

const execution = makeExecutionControlsProps();

const permission: ExecutionPermissionConfig = {
  value: "auto",
  options: [{ value: "auto", label: "Approve for me" }],
  onChange: noop,
  supported: true,
};

const typeahead: TypeaheadConfig = {
  mention: {
    results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
    isLoading: false,
    isError: false,
    onQueryChange: noop,
  },
  command: INERT_TYPEAHEAD_COMMAND_CONFIG,
};

const attachments: AttachmentsConfig = {
  items: [],
  projectId: "proj_story",
  isAttaching: false,
  error: null,
  onAttachFiles: noop,
  onRemove: noop,
};

function queued(
  id: string,
  text: string,
  overrides: Partial<ThreadQueuedMessage> = {},
): ThreadQueuedMessage {
  return makeThreadQueuedMessage({
    id,
    threadId: "thr_split_review",
    content: [{ type: "text", text, mentions: [] }],
    ...overrides,
  });
}

const initialQueue: readonly ThreadQueuedMessage[] = [
  queued("q_1", "Also check the timeline error overlay.", {
    groupWithNext: true,
  }),
  queued("q_2", "Verify keyboard reordering from each grip."),
  queued("q_3", "Review the queue at a narrow width.", {
    sendAt: Date.now() + 42 * 60 * 1000,
    waitingOn: { kind: "time" },
  }),
];

type PreviewState = "loading" | "error" | "live";
type QueueData = "empty" | "pending" | "loaded";

function PromptStage({ children }: { children: ReactNode }) {
  return (
    <div className="w-full min-w-0 bg-background">
      <PageShell
        shellClassName="!mx-0 !mt-0 !h-auto !min-h-0 !flex-none md:!mx-0 md:!mt-0"
        scrollAreaClassName="hidden"
        footerClassName="chat-prompt-box"
        footer={children}
      >
        <span aria-hidden="true" />
      </PageShell>
    </div>
  );
}

function StoryComposer({
  collapseResetKey,
  isPrimaryComposer,
  message,
  mentions,
  onChange,
  onSubmit,
  stack,
}: {
  collapseResetKey: string;
  isPrimaryComposer: boolean;
  message: string;
  mentions: PromptTextMention[];
  onChange: (message: string, mentions: PromptTextMention[]) => void;
  onSubmit: () => void;
  stack: ReactNode;
}) {
  return (
    <FollowUpPromptBox
      attachments={attachments}
      stack={stack}
      composer={{
        history: {
          currentDraft: { text: message, mentions, attachments: [] },
          entries: [],
          onSelectEntry: noop,
        },
        isFollowUpSubmitting: false,
        message,
        mentionRanges: mentions,
        onChangeMessage: onChange,
        onModifierSubmit: onSubmit,
        onSubmit,
        compactPromptPlaceholder: "Queue a follow-up",
        promptPlaceholder: "Queue a follow-up",
        canModifierSubmit: true,
        steerActiveThreadOnEnter: false,
        submitMode: { kind: "queue", onStop: noop },
        threadRuntimeDisplayStatus: "active",
      }}
      environmentSummary={null}
      contextWindowUsage={null}
      execution={execution}
      executionReadOnly={!isPrimaryComposer}
      permission={permission}
      permissionReadOnly={!isPrimaryComposer}
      promptActions={[]}
      typeahead={typeahead}
      collapseResetKey={collapseResetKey}
      isPrimaryComposer={isPrimaryComposer}
      showScrollToBottomButton={false}
    />
  );
}

export function QueuedMessages() {
  const [preview, setPreview] = useState<PreviewState>("loading");
  const [queueData, setQueueData] = useState<QueueData>("loaded");
  const [queue, setQueue] = useState(initialQueue);
  const [draft, setDraft] = useState({
    text: "",
    mentions: [] as PromptTextMention[],
  });
  const [editing, setEditing] = useState<{
    draft: PromptDraftState;
    queuedMessageId: string;
    queuedMessageIndex: number;
  } | null>(null);

  const removeQueued = useCallback((id: string) => {
    setQueue((current) => current.filter((message) => message.id !== id));
  }, []);
  const handleReorder = useCallback((request: QueuedMessageReorderRequest) => {
    setQueue((current) =>
      preserveLeadQueuedMessageGroupAfterReorder({
        queuedMessages: applyQueuedMessageReorder({
          queuedMessages: current,
          request,
        }),
        originalLeadGroupIds: collectLeadQueuedMessageGroupIds(current),
      }),
    );
  }, []);
  const handleSetGroupBoundary = useCallback(
    ({ groupBoundaryQueuedMessageId }: QueuedMessageGroupBoundaryRequest) => {
      setQueue((current) => {
        const boundaryIndex = current.findIndex(
          (message) => message.id === groupBoundaryQueuedMessageId,
        );
        return current.map((message, index) => ({
          ...message,
          groupWithNext: index < boundaryIndex,
        }));
      });
    },
    [],
  );
  const handleEdit = useCallback(
    ({ queuedMessageId, queuedMessageIndex }: QueuedMessageEditRequest) => {
      const message = queue.find(
        (candidate) => candidate.id === queuedMessageId,
      );
      if (!message) return;
      setEditing({
        draft: queuedInputToDraft(message.content),
        queuedMessageId,
        queuedMessageIndex,
      });
    },
    [queue],
  );
  const saveEdit = () => {
    if (!editing) return;
    const input = promptDraftToInput(editing.draft);
    if (input.length > 0) {
      setQueue((current) =>
        current.map((message) =>
          message.id === editing.queuedMessageId
            ? { ...message, content: input, updatedAt: Date.now() }
            : message,
        ),
      );
    }
    setEditing(null);
  };
  const queueTo = (next: QueueData) => {
    setQueueData(next);
    if (next !== "empty" && queue.length === 0) setQueue(initialQueue);
  };

  const list = (
    <LazyQueuedMessagesList
      attachedToComposer
      queuedMessages={queueData === "empty" ? [] : queue}
      sendAction="send-now"
      sendDisabled={false}
      actionDisabled={false}
      processingMessageId={null}
      processingAction={null}
      inlineEditor={
        editing
          ? {
              queuedMessageId: editing.queuedMessageId,
              queuedMessageIndex: editing.queuedMessageIndex,
              onDismiss: () => setEditing(null),
              content: (
                <StoryComposer
                  collapseResetKey={`queued:${editing.queuedMessageId}`}
                  isPrimaryComposer={false}
                  message={editing.draft.text}
                  mentions={editing.draft.mentions}
                  onChange={(text, mentions) =>
                    setEditing((current) =>
                      current
                        ? {
                            ...current,
                            draft: { ...current.draft, text, mentions },
                          }
                        : current,
                    )
                  }
                  onSubmit={saveEdit}
                  stack={null}
                />
              ),
            }
          : undefined
      }
      onSend={removeQueued}
      onReorder={handleReorder}
      onSetGroupBoundary={handleSetGroupBoundary}
      onEdit={handleEdit}
      onDelete={removeQueued}
    />
  );
  const stack =
    queueData === "pending" ? (
      <QueuedMessagesPendingCard queuedMessageCount={queue.length} />
    ) : preview === "live" ? (
      list
    ) : (
      <SplitPreviewProvider
        id={LazyQueuedMessagesList.id}
        state={preview}
        onRetry={() => setPreview("live")}
      >
        {list}
      </SplitPreviewProvider>
    );

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-3" aria-label="Split review controls">
        <button type="button" onClick={() => setPreview("loading")}>
          Hold loading
        </button>
        <button type="button" onClick={() => setPreview("error")}>
          Show failure
        </button>
        <button type="button" onClick={() => setPreview("live")}>
          Release to real UI
        </button>
        <span aria-hidden className="text-muted-foreground">
          |
        </span>
        <button type="button" onClick={() => queueTo("empty")}>
          Empty queue
        </button>
        <button type="button" onClick={() => queueTo("pending")}>
          Queue data pending
        </button>
        <button type="button" onClick={() => queueTo("loaded")}>
          Queue data loaded
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        {LazyQueuedMessagesList.id}: {preview} · data: {queueData} ·{" "}
        {queue.length} queued
      </p>
      <div className="max-w-[760px] pt-40">
        <PromptStage>
          <StoryComposer
            collapseResetKey="thr_split_review"
            isPrimaryComposer
            message={draft.text}
            mentions={draft.mentions}
            onChange={(text, mentions) => setDraft({ text, mentions })}
            onSubmit={() => {
              if (draft.text.trim().length === 0) return;
              setQueue((current) => [
                ...current,
                queued(`q_${Date.now()}`, draft.text),
              ]);
              setDraft({ text: "", mentions: [] });
            }}
            stack={stack}
          />
        </PromptStage>
      </div>
    </div>
  );
}
