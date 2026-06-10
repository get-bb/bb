import { memo, useCallback, useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ThreadQueuedMessage } from "@bb/domain";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
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

export interface QueuedMessagesListProps {
  queuedMessages: readonly ThreadQueuedMessage[];
  sendDisabled: boolean;
  actionDisabled: boolean;
  processingMessageId: string | null;
  onSendImmediately: (id: string) => void;
  onReorder: (request: QueuedMessageReorderRequest) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

interface QueuedMessageRowProps {
  queuedMessage: ThreadQueuedMessage;
  index: number;
  isProcessing: boolean;
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
      className={cn("px-2.5 py-0.5", isDragging && "relative z-10 opacity-80")}
    >
      <div className="flex items-center gap-1.5">
        <Button
          ref={setActivatorNodeRef}
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            "size-6 shrink-0 text-muted-foreground",
            !dragDisabled && "cursor-grab active:cursor-grabbing",
          )}
          disabled={dragDisabled}
          aria-label={`Reorder queued message ${index + 1}`}
          title="Reorder queued message"
          {...attributes}
          {...listeners}
        >
          <Icon name="ArrowTurnForward" className="size-3.5 opacity-70" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1 text-xs leading-4">
            <p className="min-w-0 truncate text-foreground" title={preview}>
              {preview}
            </p>
            {attachmentCount > 0 ? (
              <span className="shrink-0 text-subtle-foreground opacity-70">
                {attachmentCount === 1
                  ? "1 attachment"
                  : `${attachmentCount} attachments`}
              </span>
            ) : null}
            {isProcessing ? (
              <>
                <span className="shrink-0 text-muted-foreground">.</span>
                <span className="shrink-0 text-muted-foreground">
                  Sending...
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="ml-1 flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="link"
            className="h-auto px-0 pr-1 text-xs text-muted-foreground"
            disabled={sendDisabled || isProcessing}
            onClick={() => onSendImmediately(queuedMessage.id)}
            aria-label={isProcessing ? "Sending queued message" : "Send now"}
          >
            {isProcessing ? (
              "Sending..."
            ) : (
              <Icon name="Sent" className="size-4 shrink-0" aria-hidden />
            )}
          </Button>
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
            <Icon name="Edit" className="size-3.5" />
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
            <Icon name="Trash2" className="size-3.5" />
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
  onSendImmediately,
  onReorder,
  onEdit,
  onDelete,
}: QueuedMessagesListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const queuedMessageIds = useMemo(
    () => queuedMessages.map((queuedMessage) => queuedMessage.id),
    [queuedMessages],
  );
  const sortingDisabled =
    actionDisabled || processingMessageId !== null || queuedMessages.length < 2;
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!event.over) {
        return;
      }

      const reorderRequest = buildQueuedMessageReorderRequest({
        activeId: String(event.active.id),
        overId: String(event.over.id),
        queuedMessages,
      });
      if (!reorderRequest) {
        return;
      }

      onReorder(reorderRequest);
    },
    [onReorder, queuedMessages],
  );

  if (queuedMessages.length === 0) return null;

  return (
    <PromptStackCard ariaLabel="Queued messages" className="overflow-hidden">
      <div className="flex items-center justify-between px-2.5 pb-1 pt-2.5">
        <p className="text-xs text-muted-foreground">
          <span className="opacity-70">Queued</span>{" "}
          <span className="text-sm opacity-60">{queuedMessages.length}</span>
        </p>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={queuedMessageIds}
          strategy={verticalListSortingStrategy}
        >
          <ul>
            {queuedMessages.map((queuedMessage, index) => (
              <QueuedMessageRow
                key={queuedMessage.id}
                queuedMessage={queuedMessage}
                index={index}
                isProcessing={processingMessageId === queuedMessage.id}
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
    </PromptStackCard>
  );
}
