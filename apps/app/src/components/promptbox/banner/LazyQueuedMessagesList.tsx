import { useEffect, type ReactNode } from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PromptStackCard,
} from "@/components/promptbox/banner/PromptStackCard";
import { QueuedMessagesCountPill } from "@/components/promptbox/banner/QueuedMessagesCountPill";
import {
  getPendingQueuedMessagesDrawerHeight,
  getQueuedMessagesDrawerHeight,
  QUEUED_MESSAGES_COLLAPSED_HEIGHT,
} from "@/components/promptbox/banner/queued-messages-layout";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { defineSplit, SplitLoadFailure } from "@/lib/define-split";
import type { QueuedMessageReorderRequest } from "@/lib/queued-message-reorder";

export type QueuedMessageProcessingAction = "send" | "edit" | "delete";
export type QueuedMessageSendAction = "send-now" | "steer-when-ready";

export interface QueuedMessageGroupBoundaryRequest {
  expectedGroupedPrefixQueuedMessageIds: string[];
  groupBoundaryQueuedMessageId: string;
}

export interface QueuedMessageEditRequest {
  queuedMessageId: string;
  queuedMessageIndex: number;
}

export interface QueuedMessageInlineEditor {
  content: ReactNode;
  queuedMessageId: string;
  queuedMessageIndex: number;
  onDismiss: () => void;
}

export interface QueuedMessagesListProps {
  attachedToComposer: boolean;
  queuedMessages: readonly ThreadQueuedMessage[];
  resolveMentionLink?: PromptMentionLinkResolver;
  sendAction: QueuedMessageSendAction;
  sendDisabled: boolean;
  actionDisabled: boolean;
  processingMessageId: string | null;
  processingAction: QueuedMessageProcessingAction | null;
  inlineEditor?: QueuedMessageInlineEditor;
  onSend: (id: string) => void;
  onReorder: (request: QueuedMessageReorderRequest) => void;
  onSetGroupBoundary: (request: QueuedMessageGroupBoundaryRequest) => void;
  onEdit: (request: QueuedMessageEditRequest) => void;
  onDelete: (id: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

function QueuedMessagesCardFrame({
  attached,
  children,
  expanded,
  height,
  queuedMessageCount,
}: {
  attached: boolean;
  children: ReactNode;
  expanded: boolean;
  height: number;
  queuedMessageCount: number;
}) {
  return (
    <PromptStackCard
      ariaLabel="Queued messages"
      style={{ height }}
      className={cn(
        "relative z-10 flex min-h-0 flex-col overflow-hidden rounded-xl bg-surface-raised-solid shadow-lift",
        attached ? "-mb-5 rounded-b-none border-b-0 pb-3" : "mb-0 pb-4",
      )}
    >
      <header className="shrink-0">
        <div
          className={cn(
            PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
            "cursor-default hover:bg-transparent",
            expanded && "border-b border-border/35",
          )}
        >
          <span className="font-normal">Queue</span>
          <QueuedMessagesCountPill arrivals={0} count={queuedMessageCount} />
        </div>
      </header>
      {children}
    </PromptStackCard>
  );
}

const LOADING_ROW_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"];

function QueuedMessagesLoadingStatus({
  expanded,
  queuedMessageCount,
}: {
  expanded: boolean;
  queuedMessageCount: number;
}) {
  if (!expanded) {
    return <span role="status" aria-label="Loading queued messages" />;
  }
  return (
    <div
      role="status"
      aria-label="Loading queued messages"
      className="min-h-0 flex-1 py-1"
    >
      {LOADING_ROW_WIDTHS.slice(0, Math.max(1, queuedMessageCount)).map(
        (width) => (
          <div key={width} className="flex h-[33px] items-center px-3.5">
            <Skeleton className={cn("h-3 rounded-sm", width)} />
          </div>
        ),
      )}
    </div>
  );
}

function isAttachedToComposer({
  attachedToComposer,
  inlineEditor,
}: QueuedMessagesListProps): boolean {
  return attachedToComposer && inlineEditor === undefined;
}

function QueuedMessagesListLoading(props: QueuedMessagesListProps) {
  return (
    <QueuedMessagesCardFrame
      attached={isAttachedToComposer(props)}
      expanded={props.expanded}
      height={
        props.expanded
          ? getQueuedMessagesDrawerHeight(props)
          : QUEUED_MESSAGES_COLLAPSED_HEIGHT
      }
      queuedMessageCount={props.queuedMessages.length}
    >
      <QueuedMessagesLoadingStatus
        expanded={props.expanded}
        queuedMessageCount={props.queuedMessages.length}
      />
    </QueuedMessagesCardFrame>
  );
}

function QueuedMessagesListFailure({
  retry,
  ...props
}: QueuedMessagesListProps & { retry: () => void }) {
  return (
    <QueuedMessagesCardFrame
      attached={isAttachedToComposer(props)}
      expanded
      height={getQueuedMessagesDrawerHeight(props)}
      queuedMessageCount={props.queuedMessages.length}
    >
      <SplitLoadFailure retry={retry} />
    </QueuedMessagesCardFrame>
  );
}

export const LazyQueuedMessagesList = defineSplit<QueuedMessagesListProps>({
  id: "queued-messages-list",
  load: () =>
    import("./QueuedMessagesList").then((module) => module.QueuedMessagesList),
  loading: QueuedMessagesListLoading,
  error: QueuedMessagesListFailure,
  mountWhen: (props) =>
    props.queuedMessages.length > 0 || props.inlineEditor !== undefined,
  tier: "intent",
});

export function QueuedMessagesPendingCard({
  expanded,
  queuedMessageCount,
}: {
  expanded: boolean;
  queuedMessageCount: number;
}) {
  useEffect(() => {
    void LazyQueuedMessagesList.preload();
  }, []);
  return (
    <QueuedMessagesCardFrame
      attached
      expanded={expanded}
      height={
        expanded
          ? getPendingQueuedMessagesDrawerHeight(queuedMessageCount)
          : QUEUED_MESSAGES_COLLAPSED_HEIGHT
      }
      queuedMessageCount={queuedMessageCount}
    >
      <QueuedMessagesLoadingStatus
        expanded={expanded}
        queuedMessageCount={queuedMessageCount}
      />
    </QueuedMessagesCardFrame>
  );
}
