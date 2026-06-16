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
  messageBodyHasQuote,
  renderMessageBodyWithQuotes,
} from "@/components/thread/timeline/ConversationMessageMentions";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { cn } from "@/lib/utils";
import {
  countQueuedMessageAttachments,
  formatQueuedMessagePreview,
} from "@/views/thread-detail/threadQueuedMessages";
import {
  buildQueuedMessageReorderRequest,
  type QueuedMessageReorderRequest,
} from "@/lib/queued-message-reorder";

/** Which in-flight action the processing message is running, for its label. */
export type QueuedMessageProcessingAction = "send" | "edit" | "delete";

export interface QueuedMessagesListProps {
  queuedMessages: readonly ThreadQueuedMessage[];
  sendDisabled: boolean;
  actionDisabled: boolean;
  processingMessageId: string | null;
  processingAction: QueuedMessageProcessingAction | null;
  onSendImmediately: (id: string) => void;
  onReorder: (request: QueuedMessageReorderRequest) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
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
  const preview = useMemo(
    () => formatQueuedMessagePreview(queuedMessage.content),
    [queuedMessage.content],
  );
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
      className={cn(
        "group px-2.5 py-0.5",
        isDragging && "relative z-10 opacity-80",
      )}
    >
      {/* Quote rows are multi-line, so top-align the drag handle + actions to
          the first line — it reads as a clear leading marker when scanning a
          mix of quoted and plain messages. Single-line rows stay centered. */}
      <div
        className={cn(
          "flex gap-1.5",
          messageBodyHasQuote(preview) ? "items-start" : "items-center",
        )}
      >
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
          title="Reorder queued message"
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
          <Icon name="ArrowTurnForward" className="size-3.5 shrink-0 opacity-70" />
        </Button>
        <div className="min-w-0 flex-1">
          {messageBodyHasQuote(preview) ? (
            // Render `> ` quote lines as styled blockquotes, height-capped so a
            // quoted queued message stays compact in the list.
            <div className="min-w-0 space-y-0.5 text-xs leading-4 text-foreground">
              <div
                className="max-h-16 overflow-hidden break-words"
                title={preview}
              >
                {renderMessageBodyWithQuotes({ mentions: [], text: preview })}
              </div>
              {attachmentCount > 0 ? (
                <span className="text-subtle-foreground opacity-70">
                  {attachmentCount === 1
                    ? "1 attachment"
                    : `${attachmentCount} attachments`}
                </span>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-1 text-xs leading-4">
              {/* Single line, no horizontal scroll — overflow is clipped with a
                  soft right-edge fade instead of a hard ellipsis. */}
              <p
                className="fade-clip-right min-w-0 flex-1 overflow-hidden whitespace-nowrap text-foreground"
                title={preview}
              >
                {preview}
              </p>
              {attachmentCount > 0 ? (
                <span className="shrink-0 text-subtle-foreground opacity-70">
                  {attachmentCount === 1
                    ? "1 attachment"
                    : `${attachmentCount} attachments`}
                </span>
              ) : null}
            </div>
          )}
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
              title="Send now"
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
            title="Edit queued message"
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
            title="Delete queued message"
          >
            <Icon name="Trash2" className="size-4 opacity-70" />
          </Button>
        </div>
      </div>
    </li>
  );
});

export function QueuedMessagesList({
  queuedMessages,
  sendDisabled,
  actionDisabled,
  processingMessageId,
  processingAction,
  onSendImmediately,
  onReorder,
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

  // Render from a local order so a drag can reorder synchronously in the drop
  // event (no snap-back). The prop is re-adopted only when the queue's
  // membership changes (add / send / delete / edit) — not when a reorder's
  // optimistic cache update merely catches up to an order we already applied.
  // (React Query defers its notification past dnd-kit's drop, so re-adopting on
  // every prop change would momentarily re-render a dropped row in its old
  // slot.)
  const [orderedMessages, setOrderedMessages] = useState(queuedMessages);
  const membershipKey = queuedMessages
    .map((queuedMessage) => queuedMessage.id)
    .slice()
    .sort()
    .join("|");
  const [syncedMembershipKey, setSyncedMembershipKey] = useState(membershipKey);
  if (membershipKey !== syncedMembershipKey) {
    setSyncedMembershipKey(membershipKey);
    setOrderedMessages(queuedMessages);
  }

  const queuedMessageIds = useMemo(
    () => orderedMessages.map((queuedMessage) => queuedMessage.id),
    [orderedMessages],
  );
  const sortingDisabled =
    actionDisabled || processingMessageId !== null || queuedMessages.length < 2;
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!event.over || event.active.id === event.over.id) {
        return;
      }
      const activeId = String(event.active.id);
      const overId = String(event.over.id);
      const oldIndex = orderedMessages.findIndex(
        (queuedMessage) => queuedMessage.id === activeId,
      );
      const newIndex = orderedMessages.findIndex(
        (queuedMessage) => queuedMessage.id === overId,
      );
      if (oldIndex === -1 || newIndex === -1) {
        return;
      }

      // Apply the new order locally and synchronously so the dropped row
      // settles into place in the same render flush as the drop; the mutation
      // syncs the server in the background.
      setOrderedMessages((current) =>
        arrayMove([...current], oldIndex, newIndex),
      );

      const reorderRequest = buildQueuedMessageReorderRequest({
        activeId,
        overId,
        queuedMessages: orderedMessages,
      });
      if (reorderRequest) {
        onReorder(reorderRequest);
      }
    },
    [onReorder, orderedMessages],
  );

  // Keep a dragged row from being pulled outside the visible list: clamp the
  // drag to the list's bounds and to the vertical axis.
  const listRef = useRef<HTMLUListElement>(null);
  const restrictToListBounds = useCallback<Modifier>(
    ({ draggingNodeRect, transform }) => {
      const listRect = listRef.current?.getBoundingClientRect();
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
    [],
  );

  if (queuedMessages.length === 0) return null;

  return (
    <PromptStackCard
      ariaLabel="Queued messages"
      // Tuck the drawer's flat, borderless bottom behind the prompt box (which
      // is `relative` + opaque, so it paints on top) so the queued list reads as
      // coming up from behind the composer rather than floating above it.
      className="-mb-3 overflow-hidden rounded-b-none border-b-0 pb-3"
    >
      <div className="px-2.5 pb-1 pt-2.5">
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => setIsExpanded((prev) => !prev)}
          className="-ml-2 flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-state-hover"
        >
          <span className="opacity-70">Queued</span>
          <span className="text-2xs text-subtle-foreground">
            {queuedMessages.length}
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
              isExpanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        </button>
      </div>
      {isExpanded ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToListBounds]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={queuedMessageIds}
            strategy={verticalListSortingStrategy}
          >
            <ul ref={listRef}>
              {orderedMessages.map((queuedMessage, index) => (
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
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : null}
    </PromptStackCard>
  );
}
