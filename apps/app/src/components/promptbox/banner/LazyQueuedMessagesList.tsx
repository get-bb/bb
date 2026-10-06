import { useEffect, type ReactNode } from "react";
import type { ThreadQueuedMessage } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import {
  getPendingQueuedMessagesDrawerHeight,
  getQueuedMessagesDrawerHeight,
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
}

function QueuedMessagesCardFrame({
  attached,
  children,
  height,
  queuedMessageCount,
}: {
  attached: boolean;
  children: ReactNode;
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
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border/35 px-2">
        <div className="flex min-w-16 items-baseline gap-1.5 pl-1">
          <span className="text-xs font-medium text-foreground">Queue</span>
          <span className="text-2xs tabular-nums text-subtle-foreground">
            {queuedMessageCount}
          </span>
        </div>
      </header>
      {children}
    </PromptStackCard>
  );
}

const LOADING_ROW_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"];

function QueuedMessagesLoadingRows({
  queuedMessageCount,
}: {
  queuedMessageCount: number;
}) {
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
      height={getQueuedMessagesDrawerHeight(props)}
      queuedMessageCount={props.queuedMessages.length}
    >
      <QueuedMessagesLoadingRows
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
  queuedMessageCount,
}: {
  queuedMessageCount: number;
}) {
  useEffect(() => {
    void LazyQueuedMessagesList.preload();
  }, []);
  return (
    <QueuedMessagesCardFrame
      attached
      height={getPendingQueuedMessagesDrawerHeight(queuedMessageCount)}
      queuedMessageCount={queuedMessageCount}
    >
      <QueuedMessagesLoadingRows queuedMessageCount={queuedMessageCount} />
    </QueuedMessagesCardFrame>
  );
}
