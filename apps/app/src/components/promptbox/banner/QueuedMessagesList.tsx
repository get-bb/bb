import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ThreadQueuedMessage } from "@bb/domain";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import {
  PromptStackCard,
  PROMPT_STACK_COMPACT_INLAY_INSET_CLASS,
  PROMPT_STACK_COMPACT_INLAY_SEGMENT_CLASS,
} from "@/components/promptbox/banner/PromptStackCard";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  countQueuedMessageAttachments,
  formatQueuedMessagePreview,
  getQueuedMessageVisibleText,
} from "@/views/thread-detail/threadQueuedMessages";
import type { QueuedMessageReorderRequest } from "@/lib/queued-message-reorder";

/** Which in-flight action the processing message is running, for its label. */
export type QueuedMessageProcessingAction = "send" | "edit" | "delete";

export interface QueuedMessageGroupBoundaryRequest {
  expectedGroupedPrefixQueuedMessageIds: string[];
  groupBoundaryQueuedMessageId: string;
}

export interface QueuedMessagesListProps {
  queuedMessages: readonly ThreadQueuedMessage[];
  sendDisabled: boolean;
  actionDisabled: boolean;
  processingMessageId: string | null;
  processingAction: QueuedMessageProcessingAction | null;
  onSendImmediately: (id: string) => void;
  onReorder: (request: QueuedMessageReorderRequest) => void;
  onSetGroupBoundary: (request: QueuedMessageGroupBoundaryRequest) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

interface QueuedMessagePreviewSegment {
  kind: "quote" | "text";
  text: string;
}

interface QueuedMessageRowProps {
  queuedMessage: ThreadQueuedMessage;
  index: number;
  isProcessing: boolean;
  processingLabel: string;
  dragDisabled: boolean;
  sendDisabled: boolean;
  actionDisabled: boolean;
  onSendImmediately: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

const GROUP_DIVIDER_ID = "__queued_message_group_divider__";

function collectLeadQueuedMessageGroupIds(
  queuedMessages: readonly ThreadQueuedMessage[],
): string[] {
  const ids: string[] = [];
  for (const queuedMessage of queuedMessages) {
    ids.push(queuedMessage.id);
    if (!queuedMessage.groupWithNext) break;
  }
  return ids;
}

function preserveLeadQueuedMessageGroupAfterReorder({
  originalLeadGroupIds,
  queuedMessages,
}: {
  originalLeadGroupIds: readonly string[];
  queuedMessages: readonly ThreadQueuedMessage[];
}): ThreadQueuedMessage[] {
  if (originalLeadGroupIds.length <= 1) {
    return queuedMessages.map((queuedMessage) => ({
      ...queuedMessage,
      groupWithNext: false,
    }));
  }

  const originalLeadGroupIdSet = new Set(originalLeadGroupIds);
  const preservesLeadGroup = queuedMessages
    .slice(0, originalLeadGroupIds.length)
    .every((queuedMessage) => originalLeadGroupIdSet.has(queuedMessage.id));

  return queuedMessages.map((queuedMessage, index) => ({
    ...queuedMessage,
    groupWithNext:
      preservesLeadGroup && index < originalLeadGroupIds.length - 1,
  }));
}

export function resolveQueuedMessageDrag({
  activeId,
  combinedIds,
  orderedMessages,
  overId,
}: {
  activeId: string;
  combinedIds: readonly string[];
  orderedMessages: readonly ThreadQueuedMessage[];
  overId: string;
}):
  | {
      kind: "divider";
      orderedMessages: ThreadQueuedMessage[];
      request: QueuedMessageGroupBoundaryRequest;
    }
  | {
      kind: "row";
      request: QueuedMessageReorderRequest;
      orderedMessages: ThreadQueuedMessage[];
    }
  | null {
  if (activeId === overId) {
    return null;
  }
  const oldIndex = combinedIds.indexOf(activeId);
  const newIndex = combinedIds.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1) {
    return null;
  }

  const movedIds = arrayMove([...combinedIds], oldIndex, newIndex);
  const byId = new Map(
    orderedMessages.map((queuedMessage) => [queuedMessage.id, queuedMessage]),
  );
  const dividerIndex = movedIds.indexOf(GROUP_DIVIDER_ID);
  const nextMessages = movedIds
    .filter((id) => id !== GROUP_DIVIDER_ID)
    .map((id) => byId.get(id))
    .filter(
      (queuedMessage): queuedMessage is ThreadQueuedMessage =>
        queuedMessage !== undefined,
    );

  if (activeId === GROUP_DIVIDER_ID) {
    const boundaryIndex = Math.max(dividerIndex - 1, 0);
    const groupBoundaryQueuedMessageId = nextMessages[boundaryIndex]?.id;
    if (!groupBoundaryQueuedMessageId) {
      return null;
    }
    return {
      kind: "divider",
      orderedMessages: nextMessages.map((queuedMessage, index) => ({
        ...queuedMessage,
        groupWithNext: index < boundaryIndex,
      })),
      request: {
        expectedGroupedPrefixQueuedMessageIds: nextMessages
          .slice(0, boundaryIndex + 1)
          .map((queuedMessage) => queuedMessage.id),
        groupBoundaryQueuedMessageId,
      },
    };
  }

  const messageIndex = nextMessages.findIndex(
    (queuedMessage) => queuedMessage.id === activeId,
  );
  if (messageIndex === -1) {
    return null;
  }

  return {
    kind: "row",
    orderedMessages: preserveLeadQueuedMessageGroupAfterReorder({
      queuedMessages: nextMessages,
      originalLeadGroupIds: collectLeadQueuedMessageGroupIds(orderedMessages),
    }),
    request: {
      queuedMessageId: activeId,
      previousQueuedMessageId: nextMessages[messageIndex - 1]?.id ?? null,
      nextQueuedMessageId: nextMessages[messageIndex + 1]?.id ?? null,
    },
  };
}

function isQuoteLine(line: string): boolean {
  return line === ">" || line.startsWith("> ");
}

function stripQuotePrefix(line: string): string {
  if (line.startsWith("> ")) return line.slice(2);
  if (line === ">") return "";
  return line;
}

function normalizePreviewSegmentText(lines: readonly string[]): string {
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

function buildQueuedMessagePreviewSegments(
  queuedMessage: ThreadQueuedMessage,
): QueuedMessagePreviewSegment[] {
  const text = getQueuedMessageVisibleText(queuedMessage.content);
  if (!text.split("\n").some(isQuoteLine)) {
    return [
      {
        kind: "text",
        text: formatQueuedMessagePreview(queuedMessage.content, {
          truncate: false,
        }),
      },
    ];
  }

  const lines = text.split("\n");
  const segments: QueuedMessagePreviewSegment[] = [];
  let index = 0;
  while (index < lines.length) {
    const quote = isQuoteLine(lines[index]!);
    let end = index;
    while (end < lines.length && isQuoteLine(lines[end]!) === quote) {
      end += 1;
    }
    const groupLines = lines.slice(index, end);
    const segmentText = normalizePreviewSegmentText(
      quote ? groupLines.map(stripQuotePrefix) : groupLines,
    );
    if (segmentText.length > 0) {
      segments.push({
        kind: quote ? "quote" : "text",
        text: segmentText,
      });
    }
    index = end;
  }

  return segments.length > 0
    ? segments
    : [
        {
          kind: "text",
          text: formatQueuedMessagePreview(queuedMessage.content, {
            truncate: false,
          }),
        },
      ];
}

function QueuedMessagePreview({
  queuedMessage,
}: {
  queuedMessage: ThreadQueuedMessage;
}) {
  const preview = useMemo(
    () =>
      formatQueuedMessagePreview(queuedMessage.content, {
        truncate: false,
      }),
    [queuedMessage.content],
  );
  const segments = useMemo(
    () => buildQueuedMessagePreviewSegments(queuedMessage),
    [queuedMessage],
  );

  return (
    <div
      className="fade-clip-right min-w-0 flex-1 overflow-hidden whitespace-nowrap text-foreground"
      title={preview}
    >
      <div className="flex min-w-0 max-w-full items-center gap-1.5">
        {segments.map((segment, index) =>
          segment.kind === "quote" ? (
            <blockquote
              key={`${segment.kind}-${index}`}
              className="m-0 inline-flex min-w-0 shrink items-center border-l-2 border-surface-selected-border pl-2 text-muted-foreground"
            >
              <span className="min-w-0 overflow-hidden whitespace-nowrap">
                {segment.text}
              </span>
            </blockquote>
          ) : (
            <span
              key={`${segment.kind}-${index}`}
              className="min-w-0 shrink overflow-hidden whitespace-nowrap"
            >
              {segment.text}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

const QueuedMessageRow = memo(function QueuedMessageRow({
  queuedMessage,
  index,
  isProcessing,
  processingLabel,
  dragDisabled,
  sendDisabled,
  actionDisabled,
  onSendImmediately,
  onEdit,
  onDelete,
}: QueuedMessageRowProps) {
  const attachmentCount = useMemo(
    () => countQueuedMessageAttachments(queuedMessage.content),
    [queuedMessage.content],
  );
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({
    id: queuedMessage.id,
    disabled: dragDisabled,
  });
  const rowStyle = {
    // Translate only. `CSS.Transform.toString` would also emit the scaleX/scaleY
    // dnd-kit derives for these variable-height rows, visibly squishing the
    // dragged message.
    transform: CSS.Translate.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={rowStyle}
      data-queued-message-row=""
      className={cn(
        "group px-2.5 py-0.5",
        isDragging && "relative z-10 opacity-80",
      )}
    >
      <div className="flex items-center gap-1.5">
        {/* One drag handle holding the grip (hover-revealed) and the reorder
            arrow. The grip is always rendered at opacity-0 so the button width
            — and the row layout — stays constant whether or not it's hovered. */}
        <Button
          ref={setActivatorNodeRef}
          type="button"
          variant="ghost"
          className={cn(
            "-ml-2 flex h-7 shrink-0 items-center gap-0 rounded-md px-0.5 text-muted-foreground",
            !dragDisabled && "cursor-grab active:cursor-grabbing",
          )}
          disabled={dragDisabled}
          aria-label={`Reorder queued message ${index + 1}`}
          {...attributes}
          {...listeners}
        >
          <Icon
            name="DragDropVertical"
            className={cn(
              "size-3.5 shrink-0 opacity-0 transition-opacity",
              !dragDisabled && "group-hover:opacity-100",
            )}
            aria-hidden="true"
          />
          <Icon
            name="ArrowTurnForward"
            className="size-3.5 shrink-0 opacity-70"
          />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1 text-xs leading-4">
            <QueuedMessagePreview queuedMessage={queuedMessage} />
            {attachmentCount > 0 ? (
              <span className="shrink-0 text-subtle-foreground opacity-70">
                {attachmentCount === 1
                  ? "1 attachment"
                  : `${attachmentCount} attachments`}
              </span>
            ) : null}
          </div>
        </div>
        <div className="ml-1 flex shrink-0 items-center gap-1">
          {isProcessing ? (
            // While an action is in flight, the status label takes the place of
            // the send-now button (which an icon button can't hold as text).
            <span className="whitespace-nowrap px-1 text-xs text-muted-foreground">
              {processingLabel}
            </span>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-7 text-muted-foreground"
              disabled={sendDisabled}
              onClick={() => onSendImmediately(queuedMessage.id)}
              aria-label="Send now"
            >
              <Icon name="Sent" className="size-4 opacity-70" />
            </Button>
          )}
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground"
            disabled={actionDisabled || isProcessing}
            onClick={() => onEdit(queuedMessage.id)}
            aria-label={`Edit queued message ${index + 1}`}
          >
            <Icon name="Edit" className="size-4 opacity-70" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground hover:text-destructive"
            disabled={actionDisabled || isProcessing}
            onClick={() => onDelete(queuedMessage.id)}
            aria-label={`Delete queued message ${index + 1}`}
          >
            <Icon name="Trash2" className="size-4 opacity-70" />
          </Button>
        </div>
      </div>
    </li>
  );
});

function SortableGroupDivider({ disabled }: { disabled: boolean }) {
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: GROUP_DIVIDER_ID, disabled });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/divider relative list-none px-2.5 py-1.5",
        isDragging && "z-10",
      )}
    >
      <div className="mx-auto h-px w-3/4 bg-border/60" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                ref={setActivatorNodeRef}
                type="button"
                className={cn(
                  "pointer-events-none flex h-4 shrink-0 touch-none select-none items-center rounded-full bg-surface-recessed px-1.5 text-muted-foreground opacity-0 shadow-sm transition focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover/divider:pointer-events-auto group-hover/divider:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                  !disabled && "cursor-grab active:cursor-grabbing",
                  isDragging &&
                    "pointer-events-auto cursor-grabbing text-foreground opacity-100",
                )}
                disabled={disabled}
                aria-label="Messages above send together"
                {...attributes}
                {...listeners}
              >
                <Icon
                  name="DragDropHorizontal"
                  className="size-3.5"
                  aria-hidden="true"
                />
              </button>
            </TooltipTrigger>
            <TooltipContent>Messages above send together</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </li>
  );
}

export function QueuedMessagesList({
  queuedMessages,
  sendDisabled,
  actionDisabled,
  processingMessageId,
  processingAction,
  onSendImmediately,
  onReorder,
  onSetGroupBoundary,
  onEdit,
  onDelete,
}: QueuedMessagesListProps) {
  const processingLabel =
    processingAction === "edit"
      ? "Editing..."
      : processingAction === "delete"
        ? "Deleting..."
        : "Sending...";
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const [isExpanded, setIsExpanded] = useState(true);
  const {
    aboveOverflow,
    belowOverflow,
    bottomSentinelRef,
    scrollRef,
    topSentinelRef,
  } = useScrollOverflowState<HTMLDivElement>({
    measureOverflow: true,
  });

  // Render from a local order so a drag can reorder synchronously in the drop
  // event (no snap-back). The prop is re-adopted only when the queue's
  // persisted order or grouping changes — not when an unrelated query
  // notification merely replays the same order we already applied.
  // (React Query defers its notification past dnd-kit's drop, so re-adopting on
  // every prop change would momentarily re-render a dropped row in its old
  // slot.)
  const [orderedMessages, setOrderedMessages] = useState(queuedMessages);
  const orderKey = queuedMessages
    .map(
      (queuedMessage) =>
        `${queuedMessage.id}:${queuedMessage.groupWithNext ? "1" : "0"}`,
    )
    .join("|");
  const [syncedOrderKey, setSyncedOrderKey] = useState(orderKey);
  if (orderKey !== syncedOrderKey) {
    setSyncedOrderKey(orderKey);
    setOrderedMessages(queuedMessages);
  }

  const groupBoundaryIndex = useMemo(() => {
    const firstUngroupedIndex = orderedMessages.findIndex(
      (queuedMessage) => !queuedMessage.groupWithNext,
    );
    return firstUngroupedIndex === -1
      ? Math.max(0, orderedMessages.length - 1)
      : firstUngroupedIndex;
  }, [orderedMessages]);
  const combinedIds = useMemo(() => {
    const ids = orderedMessages.map((queuedMessage) => queuedMessage.id);
    if (ids.length < 2) return ids;
    return [
      ...ids.slice(0, groupBoundaryIndex + 1),
      GROUP_DIVIDER_ID,
      ...ids.slice(groupBoundaryIndex + 1),
    ];
  }, [groupBoundaryIndex, orderedMessages]);
  const sortingDisabled =
    actionDisabled || processingMessageId !== null || queuedMessages.length < 2;
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!event.over || event.active.id === event.over.id) {
        return;
      }
      const activeId = String(event.active.id);
      const overId = String(event.over.id);
      const oldIndex = combinedIds.indexOf(activeId);
      const newIndex = combinedIds.indexOf(overId);
      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      const dragResult = resolveQueuedMessageDrag({
        activeId,
        combinedIds,
        orderedMessages,
        overId,
      });
      if (!dragResult) return;

      // Apply the new order locally and synchronously so the dropped row
      // settles into place in the same render flush as the drop; the mutation
      // syncs the server in the background.
      setOrderedMessages(dragResult.orderedMessages);

      if (dragResult.kind === "divider") {
        onSetGroupBoundary(dragResult.request);
        return;
      }

      onReorder(dragResult.request);
    },
    [combinedIds, onReorder, onSetGroupBoundary, orderedMessages],
  );

  // Keep a dragged row from being pulled outside the visible list: clamp the
  // drag to the list's bounds and to the vertical axis.
  const listRef = useRef<HTMLUListElement>(null);
  const restrictToListBounds = useCallback<Modifier>(
    ({ draggingNodeRect, transform }) => {
      const listRect =
        scrollRef.current?.getBoundingClientRect() ??
        listRef.current?.getBoundingClientRect();
      if (!listRect || !draggingNodeRect) {
        return { ...transform, x: 0 };
      }
      const minY = listRect.top - draggingNodeRect.top;
      const maxY = listRect.bottom - draggingNodeRect.bottom;
      return {
        ...transform,
        x: 0,
        y: Math.min(Math.max(transform.y, minY), maxY),
      };
    },
    [scrollRef],
  );

  if (queuedMessages.length === 0) return null;

  return (
    <PromptStackCard
      ariaLabel="Queued messages"
      className={cn(
        "relative -mb-5 overflow-hidden rounded-b-none border-b-0 pb-3 shadow-none",
        // Keep a hidden flat tail below the visible drawer content. The prompt
        // box overlaps that tail, so the drawer rails continue underneath the
        // prompt's rounded top corners without adding visible collapsed height.
      )}
    >
      <div className={PROMPT_STACK_COMPACT_INLAY_INSET_CLASS}>
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((prev) => !prev)}
          className={cn(
            "flex w-full min-w-0 items-center gap-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            PROMPT_STACK_COMPACT_INLAY_SEGMENT_CLASS,
            "cursor-pointer text-muted-foreground hover:bg-state-hover hover:text-foreground",
          )}
        >
          <span className="opacity-70">Queued</span>
          <span className="text-2xs text-subtle-foreground">
            {queuedMessages.length}
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              "ml-auto size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
              isExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      {isExpanded ? (
        <div
          className="relative isolate min-w-0 overflow-hidden"
          data-queued-messages-scroll-frame=""
        >
          <div
            ref={scrollRef}
            data-queued-messages-scroll=""
            className="max-h-32 min-w-0 overflow-y-auto overflow-x-hidden pb-1"
            tabIndex={0}
          >
            <div ref={topSentinelRef} aria-hidden className="h-px w-full" />
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToListBounds]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={combinedIds}
                strategy={verticalListSortingStrategy}
              >
                <ul ref={listRef}>
                  {combinedIds.map((id) => {
                    if (id === GROUP_DIVIDER_ID) {
                      return (
                        <SortableGroupDivider
                          key={id}
                          disabled={sortingDisabled}
                        />
                      );
                    }
                    const queuedMessage = orderedMessages.find(
                      (message) => message.id === id,
                    );
                    if (!queuedMessage) return null;
                    const index = orderedMessages.indexOf(queuedMessage);
                    return (
                      <QueuedMessageRow
                        key={queuedMessage.id}
                        queuedMessage={queuedMessage}
                        index={index}
                        isProcessing={processingMessageId === queuedMessage.id}
                        processingLabel={processingLabel}
                        dragDisabled={sortingDisabled}
                        sendDisabled={sendDisabled}
                        actionDisabled={actionDisabled}
                        onSendImmediately={onSendImmediately}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>
            <div ref={bottomSentinelRef} aria-hidden className="h-px w-full" />
          </div>
          {aboveOverflow ? (
            <div
              aria-hidden
              data-queued-messages-fade="above"
              className="pointer-events-none absolute inset-x-0 top-0 z-10 h-6 bg-gradient-to-b from-surface-recessed-solid to-transparent"
            />
          ) : null}
          {belowOverflow ? (
            <div
              aria-hidden
              data-queued-messages-fade="below"
              className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-8 bg-gradient-to-t from-surface-recessed-solid via-surface-recessed-solid/90 to-transparent"
            />
          ) : null}
        </div>
      ) : null}
    </PromptStackCard>
  );
}
