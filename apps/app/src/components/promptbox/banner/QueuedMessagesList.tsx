import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Transform } from "@dnd-kit/utilities";
import type {
  PromptInput,
  PromptTextMention,
  ThreadQueuedMessage,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "@/components/promptbox/banner/PromptStackCard";
import { useScrollOverflowState } from "@/components/thread/timeline/useScrollOverflowState";
import { OverflowFade } from "@/components/ui/overflow-fade";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  countQueuedMessageAttachments,
  formatQueuedMessagePreview,
} from "@/views/thread-detail/threadQueuedMessages";
import type { QueuedMessageReorderRequest } from "@/lib/queued-message-reorder";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { shiftMentionsToTextRange } from "@/components/thread/timeline/ConversationMessageMentions";
import {
  buildPromptMentionComponent,
  remarkPromptMentions,
  substitutePromptMentions,
} from "@/components/ui/markdown-prompt-mentions";
import { normalizePromptBlockquoteBoundaries } from "@/components/ui/markdown-prompt-blockquote-boundaries";

/** Which in-flight action the processing message is running, for its label. */
export type QueuedMessageProcessingAction = "send" | "edit" | "delete";

export interface QueuedMessageGroupBoundaryRequest {
  expectedGroupedPrefixQueuedMessageIds: string[];
  groupBoundaryQueuedMessageId: string;
}

export interface QueuedMessageEditRequest {
  queuedMessageId: string;
  queuedMessageIndex: number;
}

export interface QueuedMessageInlineEditor {
  queuedMessageId: string;
  queuedMessageIndex: number;
  ready: boolean;
  onComposerTargetChange: (target: HTMLDivElement | null) => void;
  onDismiss: () => void;
}

export interface QueuedMessagesListProps {
  queuedMessages: readonly ThreadQueuedMessage[];
  resolveMentionLink?: PromptMentionLinkResolver;
  sendDisabled: boolean;
  actionDisabled: boolean;
  processingMessageId: string | null;
  processingAction: QueuedMessageProcessingAction | null;
  inlineEditor?: QueuedMessageInlineEditor;
  onSendImmediately: (id: string) => void;
  onReorder: (request: QueuedMessageReorderRequest) => void;
  onSetGroupBoundary: (request: QueuedMessageGroupBoundaryRequest) => void;
  onEdit: (request: QueuedMessageEditRequest) => void;
  onDelete: (id: string) => void;
}

interface QueuedMessagePreviewText {
  mentions: PromptTextMention[];
  text: string;
}

interface QueuedMessageRowProps {
  queuedMessage: ThreadQueuedMessage;
  resolveMentionLink?: PromptMentionLinkResolver;
  index: number;
  isProcessing: boolean;
  processingLabel: string;
  dragDisabled: boolean;
  sendDisabled: boolean;
  actionDisabled: boolean;
  onSendImmediately: (id: string) => void;
  onEdit: (request: QueuedMessageEditRequest) => void;
  onDelete: (id: string) => void;
  compact: boolean;
  isGroupBoundary: boolean;
}

const GROUP_DIVIDER_ID = "__queued_message_group_divider__";
const COLLAPSED_HEIGHT = 56;
const DRAWER_HEIGHT = 174;
const WORKSPACE_MIN_HEIGHT = 240;
const WORKSPACE_MAX_HEIGHT = 360;
const WORKSPACE_CHROME_HEIGHT = 56;
const WORKSPACE_ROW_HEIGHT = 40;
const INLINE_EDITOR_CHROME_HEIGHT = 200;
const SURFACE_DRAG_THRESHOLD = 72;
type QueueSurfaceMode = "collapsed" | "drawer" | "workspace";

function getWorkspaceHeight({
  inlineEditing,
  messageCount,
}: {
  inlineEditing: boolean;
  messageCount: number;
}): number {
  const estimatedHeight = inlineEditing
    ? INLINE_EDITOR_CHROME_HEIGHT +
      Math.max(0, messageCount - 1) * WORKSPACE_ROW_HEIGHT
    : WORKSPACE_CHROME_HEIGHT +
      Math.max(1, messageCount) * WORKSPACE_ROW_HEIGHT;
  return clamp(estimatedHeight, WORKSPACE_MIN_HEIGHT, WORKSPACE_MAX_HEIGHT);
}

function queuedMarkdownPreviewClass(compact: boolean): string {
  return cn(
    "min-w-0",
    compact
      ? "line-clamp-1 !text-xs !leading-4"
      : "line-clamp-2 !text-sm !leading-5",
  );
}

const QUEUED_MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkPromptMentions];

function compactInline(children: ReactNode): ReactElement {
  return <span>{children} </span>;
}

const QUEUED_MARKDOWN_COMPONENTS: Components = {
  a: ({ children }) => <span>{children}</span>,
  blockquote: ({ children }) => (
    <span className="inline border-l-2 border-surface-selected-border pl-2 text-muted-foreground">
      {children}
    </span>
  ),
  br: () => " ",
  code: ({ children }) => (
    <code className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-xs">
      {children}
    </code>
  ),
  h1: ({ children }) => (
    <span className="font-semibold text-foreground">{children} </span>
  ),
  h2: ({ children }) => (
    <span className="font-semibold text-foreground">{children} </span>
  ),
  h3: ({ children }) => (
    <span className="font-semibold text-foreground">{children} </span>
  ),
  h4: ({ children }) => (
    <span className="font-semibold text-foreground">{children} </span>
  ),
  h5: ({ children }) => (
    <span className="font-semibold text-foreground">{children} </span>
  ),
  h6: ({ children }) => (
    <span className="font-semibold text-foreground">{children} </span>
  ),
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  li: ({ children }) => <span>{children} </span>,
  ol: ({ children }) => <span>{children}</span>,
  p: ({ children }) => compactInline(children),
  pre: ({ children }) => <span>{children}</span>,
  table: ({ children }) => <span>{children}</span>,
  tbody: ({ children }) => <span>{children}</span>,
  td: ({ children }) => <span>{children} </span>,
  th: ({ children }) => <span>{children} </span>,
  thead: ({ children }) => <span>{children}</span>,
  tr: ({ children }) => <span>{children} </span>,
  ul: ({ children }) => <span>{children}</span>,
};

function CompactQueuedMarkdownPreview({
  compact,
  preview,
  resolveMentionLink,
}: {
  compact: boolean;
  preview: QueuedMessagePreviewText;
  resolveMentionLink?: PromptMentionLinkResolver;
}) {
  const promptMentionSubstitution = useMemo(
    () => substitutePromptMentions(preview.text, preview.mentions),
    [preview.mentions, preview.text],
  );
  const markdownContent = useMemo(
    () =>
      normalizePromptBlockquoteBoundaries(promptMentionSubstitution.content),
    [promptMentionSubstitution.content],
  );
  const components = useMemo<Components>(
    () => ({
      ...QUEUED_MARKDOWN_COMPONENTS,
      "bb-prompt-mention": buildPromptMentionComponent({
        mentions: promptMentionSubstitution.mentions,
        resolveMentionLink,
      }),
    }),
    [promptMentionSubstitution.mentions, resolveMentionLink],
  );

  return (
    <span className={queuedMarkdownPreviewClass(compact)}>
      <ReactMarkdown
        components={components}
        remarkPlugins={QUEUED_MARKDOWN_REMARK_PLUGINS}
      >
        {markdownContent}
      </ReactMarkdown>
    </span>
  );
}

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

export function clampQueuedMessageDragTransform({
  draggingNodeRect,
  listRect,
  scrollRect,
  transform,
}: {
  draggingNodeRect: ClientRect | null;
  listRect: ClientRect | null;
  scrollRect: ClientRect | null;
  transform: Transform;
}): Transform {
  if (!draggingNodeRect || (!listRect && !scrollRect)) {
    return { ...transform, x: 0 };
  }

  const boundsTop = Math.max(
    listRect?.top ?? Number.NEGATIVE_INFINITY,
    scrollRect?.top ?? Number.NEGATIVE_INFINITY,
  );
  const boundsBottom = Math.min(
    listRect?.bottom ?? Number.POSITIVE_INFINITY,
    scrollRect?.bottom ?? Number.POSITIVE_INFINITY,
  );
  const minY = boundsTop - draggingNodeRect.top;
  const maxY = boundsBottom - draggingNodeRect.bottom;

  return {
    ...transform,
    x: 0,
    y: Math.min(Math.max(transform.y, minY), maxY),
  };
}

export function snapGroupBoundaryDragTransform({
  activeId,
  activeNodeRect,
  overId,
  overRect,
  transform,
}: {
  activeId: string | null;
  activeNodeRect: ClientRect | null;
  overId: string | null;
  overRect: ClientRect | null;
  transform: Transform;
}): Transform {
  if (activeId !== GROUP_DIVIDER_ID || !activeNodeRect) {
    return transform;
  }
  if (overId === GROUP_DIVIDER_ID || !overRect) {
    return { ...transform, x: 0 };
  }

  const activeCenterY = activeNodeRect.top + activeNodeRect.height / 2;
  return {
    ...transform,
    x: 0,
    y: overRect.bottom - activeCenterY,
  };
}

function collisionDistance(collision: Collision): number {
  const value = collision.data?.value;
  return typeof value === "number" ? value : Number.POSITIVE_INFINITY;
}

export const queuedMessageCollisionDetection: CollisionDetection = (args) => {
  if (String(args.active.id) !== GROUP_DIVIDER_ID || !args.pointerCoordinates) {
    return closestCenter(args);
  }

  // Use the raw pointer position for the group boundary. The handle itself is
  // snapped by a modifier, so deriving collisions from its transformed rect
  // would create a feedback loop that can trap it on its current boundary.
  const collisions: Collision[] = [];
  for (const droppableContainer of args.droppableContainers) {
    if (String(droppableContainer.id) === GROUP_DIVIDER_ID) continue;
    const rect = args.droppableRects.get(droppableContainer.id);
    if (!rect) continue;
    collisions.push({
      id: droppableContainer.id,
      data: {
        droppableContainer,
        value: Math.abs(args.pointerCoordinates.y - rect.bottom),
      },
    });
  }
  return collisions.sort(
    (left, right) => collisionDistance(left) - collisionDistance(right),
  );
};

export function queuedMessageSortingStrategy(
  sortableIds: readonly string[],
  args: Parameters<SortingStrategy>[0],
): ReturnType<SortingStrategy> {
  const activeId = sortableIds[args.activeIndex];
  if (activeId === GROUP_DIVIDER_ID && args.index !== args.activeIndex) {
    return null;
  }
  return verticalListSortingStrategy(args);
}

function visibleQueuedMessageTextChunks(
  input: readonly PromptInput[],
): Extract<PromptInput, { type: "text" }>[] {
  return input.filter(
    (chunk): chunk is Extract<PromptInput, { type: "text" }> =>
      chunk.type === "text" && chunk.visibility !== "agent-only",
  );
}

function shiftMentionsBy(
  mentions: readonly PromptTextMention[],
  offset: number,
): PromptTextMention[] {
  if (offset === 0) return [...mentions];
  return mentions.map((mention) => ({
    ...mention,
    start: mention.start + offset,
    end: mention.end + offset,
  }));
}

function trimQueuedMessagePreviewTextRange({
  mentions,
  rangeEnd,
  rangeStart,
  text,
}: {
  mentions: readonly PromptTextMention[];
  rangeEnd: number;
  rangeStart: number;
  text: string;
}): QueuedMessagePreviewText | null {
  const rawText = text.slice(rangeStart, rangeEnd);
  const leadingWhitespaceLength = rawText.length - rawText.trimStart().length;
  const trimmedRelativeEnd = rawText.trimEnd().length;
  if (trimmedRelativeEnd <= leadingWhitespaceLength) {
    return null;
  }

  const trimmedStart = rangeStart + leadingWhitespaceLength;
  const trimmedEnd = rangeStart + trimmedRelativeEnd;
  return {
    text: text.slice(trimmedStart, trimmedEnd),
    mentions: shiftMentionsToTextRange({
      mentions,
      rangeStart: trimmedStart,
      rangeEnd: trimmedEnd,
    }),
  };
}

function buildQueuedMessagePreviewText(
  input: readonly PromptInput[],
): QueuedMessagePreviewText {
  let text = "";
  const mentions: PromptTextMention[] = [];

  for (const chunk of visibleQueuedMessageTextChunks(input)) {
    const trimmedChunk = trimQueuedMessagePreviewTextRange({
      text: chunk.text,
      mentions: chunk.mentions,
      rangeStart: 0,
      rangeEnd: chunk.text.length,
    });
    if (!trimmedChunk) continue;

    const separator = text.length > 0 ? "\n\n" : "";
    const offset = text.length + separator.length;
    text += separator + trimmedChunk.text;
    mentions.push(...shiftMentionsBy(trimmedChunk.mentions, offset));
  }

  return { text, mentions };
}

function QueuedMessagePreview({
  compact,
  queuedMessage,
  resolveMentionLink,
}: {
  compact: boolean;
  queuedMessage: ThreadQueuedMessage;
  resolveMentionLink?: PromptMentionLinkResolver;
}) {
  const preview = useMemo(
    () =>
      formatQueuedMessagePreview(queuedMessage.content, {
        truncate: false,
      }),
    [queuedMessage.content],
  );
  const markdownPreview = useMemo(
    () => buildQueuedMessagePreviewText(queuedMessage.content),
    [queuedMessage.content],
  );

  return (
    <div
      className="fade-clip-right min-w-0 flex-1 overflow-hidden text-foreground"
      title={preview}
    >
      {markdownPreview.text.length > 0 ? (
        <CompactQueuedMarkdownPreview
          compact={compact}
          preview={markdownPreview}
          resolveMentionLink={resolveMentionLink}
        />
      ) : (
        <span className={queuedMarkdownPreviewClass(compact)}>{preview}</span>
      )}
    </div>
  );
}

const QueuedMessageRow = memo(function QueuedMessageRow({
  queuedMessage,
  resolveMentionLink,
  index,
  isProcessing,
  processingLabel,
  dragDisabled,
  sendDisabled,
  actionDisabled,
  onSendImmediately,
  onEdit,
  onDelete,
  compact,
  isGroupBoundary,
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
      data-queued-message-group-boundary-row={isGroupBoundary ? "" : undefined}
      className={cn(
        "group/row relative border-b border-border/35 px-2.5 py-0.5",
        !isGroupBoundary && "last:border-b-0",
        isDragging &&
          "z-20 rounded-lg border border-border bg-background opacity-90 shadow-lift",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Button
          ref={setActivatorNodeRef}
          type="button"
          variant="ghost"
          className={cn(
            "-ml-2 flex h-7 w-5 shrink-0 touch-none items-center justify-center rounded-md px-0.5 text-muted-foreground",
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
              !dragDisabled &&
                "group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100",
              isDragging && "opacity-100",
            )}
            aria-hidden="true"
          />
        </Button>
        <div className="min-w-0 flex-1 py-1">
          <div
            className={cn(
              "min-w-0",
              compact ? "flex items-center gap-1" : "space-y-0.5",
            )}
          >
            <QueuedMessagePreview
              compact={compact}
              queuedMessage={queuedMessage}
              resolveMentionLink={resolveMentionLink}
            />
            {attachmentCount > 0 ? (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 text-2xs text-subtle-foreground opacity-70"
                role="img"
                aria-label={
                  attachmentCount === 1
                    ? "1 attachment"
                    : `${attachmentCount} attachments`
                }
              >
                <Icon name="FileAttachment" className="size-3.5" aria-hidden />
                <span aria-hidden>{attachmentCount}</span>
              </span>
            ) : null}
          </div>
        </div>
        {isProcessing ? (
          <span className="whitespace-nowrap px-1 text-xs text-muted-foreground">
            {processingLabel}
          </span>
        ) : (
          <>
            <div
              className={cn(
                "pointer-events-none hidden shrink-0 items-center gap-0.5 opacity-0 transition-opacity md:flex",
                "group-hover/row:pointer-events-auto group-hover/row:opacity-100",
                "group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
              )}
            >
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn(
                  "shrink-0 text-muted-foreground",
                  compact ? "size-7" : "size-8",
                )}
                disabled={actionDisabled || sendDisabled}
                onClick={() => onSendImmediately(queuedMessage.id)}
                aria-label={`Send queued message ${index + 1} now`}
              >
                <Icon name="Sent" className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn(
                  "shrink-0 text-muted-foreground",
                  compact ? "size-7" : "size-8",
                )}
                disabled={actionDisabled}
                onClick={() =>
                  onEdit({
                    queuedMessageId: queuedMessage.id,
                    queuedMessageIndex: index,
                  })
                }
                aria-label={`Edit queued message ${index + 1}`}
              >
                <Icon name="Edit" className="size-4" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className={cn(
                  "shrink-0 text-muted-foreground hover:text-destructive",
                  compact ? "size-7" : "size-8",
                )}
                disabled={actionDisabled}
                onClick={() => onDelete(queuedMessage.id)}
                aria-label={`Delete queued message ${index + 1}`}
              >
                <Icon name="Trash2" className="size-4" aria-hidden />
              </Button>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className={cn(
                    "pointer-events-none shrink-0 text-muted-foreground opacity-0 transition-opacity md:hidden",
                    "group-hover/row:pointer-events-auto group-hover/row:opacity-100",
                    "group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100",
                    "data-[state=open]:pointer-events-auto data-[state=open]:opacity-100",
                    "[@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
                    compact ? "size-7" : "size-8",
                  )}
                  disabled={actionDisabled}
                  aria-label={`Queued message ${index + 1} actions`}
                >
                  <Icon name="MoreHorizontal" className="size-4" aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[7rem]">
                <DropdownMenuItem
                  disabled={sendDisabled}
                  onSelect={() => onSendImmediately(queuedMessage.id)}
                >
                  <Icon name="Sent" aria-hidden />
                  Send now
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    onEdit({
                      queuedMessageId: queuedMessage.id,
                      queuedMessageIndex: index,
                    })
                  }
                >
                  <Icon name="Edit" aria-hidden />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => onDelete(queuedMessage.id)}
                >
                  <Icon name="Trash2" aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </li>
  );
});

function SortableGroupBoundaryHandle({ disabled }: { disabled: boolean }) {
  const {
    active,
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: GROUP_DIVIDER_ID, disabled });
  const anotherItemIsDragging =
    active !== null && active.id !== GROUP_DIVIDER_ID;

  return (
    <li
      ref={setNodeRef}
      data-queued-message-group-divider=""
      style={{
        transform: isDragging ? CSS.Translate.toString(transform) : undefined,
        transition: isDragging ? transition : undefined,
      }}
      className="pointer-events-none relative z-10 h-0 list-none"
    >
      <div className="absolute left-1/2 top-[-0.5px] -translate-x-1/2 -translate-y-1/2">
        <div className="pointer-events-none">
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  ref={setActivatorNodeRef}
                  type="button"
                  className={cn(
                    "pointer-events-auto flex size-6 shrink-0 touch-none select-none items-center justify-center rounded-full border border-transparent bg-transparent text-muted-foreground transition-[background-color,border-color,box-shadow,color] focus-visible:border-border focus-visible:bg-background focus-visible:shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-has-[[data-queued-message-group-boundary-row]:hover]/queue:border-border group-has-[[data-queued-message-group-boundary-row]:hover]/queue:bg-background group-has-[[data-queued-message-group-boundary-row]:hover]/queue:shadow-sm group-has-[[data-queued-message-group-boundary-row]:focus-within]/queue:border-border group-has-[[data-queued-message-group-boundary-row]:focus-within]/queue:bg-background group-has-[[data-queued-message-group-boundary-row]:focus-within]/queue:shadow-sm hover:border-border hover:bg-background hover:shadow-sm [@media(hover:none)]:border-border [@media(hover:none)]:bg-background [@media(hover:none)]:shadow-sm",
                    anotherItemIsDragging
                      ? "pointer-events-none opacity-0"
                      : "opacity-100",
                    !disabled && "cursor-grab active:cursor-grabbing",
                    isDragging &&
                      "pointer-events-auto cursor-grabbing border-border bg-background text-foreground opacity-100 shadow-sm",
                  )}
                  disabled={disabled}
                  aria-label="Messages above send together"
                  {...attributes}
                  {...listeners}
                >
                  <Icon
                    name="DragDropHorizontal"
                    className="size-3.5 opacity-55 transition-opacity group-has-[[data-queued-message-group-boundary-row]:hover]/queue:opacity-100 group-has-[[data-queued-message-group-boundary-row]:focus-within]/queue:opacity-100 [@media(hover:none)]:opacity-100"
                    aria-hidden="true"
                  />
                </button>
              </TooltipTrigger>
              <TooltipContent>Messages above send together</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
    </li>
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function QueuedMessageInlineEditorSlot({
  editor,
}: {
  editor: QueuedMessageInlineEditor;
}) {
  return (
    <li
      data-queued-message-inline-editor=""
      className="relative z-10 border-b border-border/35 px-2.5 py-1 last:border-b-0"
    >
      <OverflowFade placement="above" tone="surface-raised" className="z-10" />
      <div className="relative z-20">
        <div className="mb-1.5 flex min-h-7 items-center gap-1.5 pl-1 text-xs text-subtle-foreground">
          <Icon name="Edit" className="size-3.5" aria-hidden />
          <span>Editing queued message {editor.queuedMessageIndex + 1}</span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="ml-auto size-6 text-subtle-foreground"
            onClick={editor.onDismiss}
            aria-label="Move editor back to the prompt box"
          >
            <Icon name="X" className="size-3" aria-hidden />
          </Button>
        </div>
        {editor.ready ? (
          <div
            ref={editor.onComposerTargetChange}
            className="relative min-h-28 duration-200 animate-in fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
            data-queued-message-composer-target=""
          />
        ) : (
          <div className="flex min-h-28 items-center justify-center rounded-xl border border-border bg-background text-xs text-muted-foreground shadow-lift">
            Opening editor…
          </div>
        )}
      </div>
      <OverflowFade placement="below" tone="surface-raised" className="z-10" />
    </li>
  );
}

export function QueuedMessagesList({
  queuedMessages,
  resolveMentionLink,
  sendDisabled,
  actionDisabled,
  processingMessageId,
  processingAction,
  inlineEditor,
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
  const [mode, setMode] = useState<QueueSurfaceMode>("drawer");
  const [surfaceDragging, setSurfaceDragging] = useState(false);
  const [surfaceDragOffset, setSurfaceDragOffset] = useState(0);
  const surfaceDragStartYRef = useRef(0);
  const surfaceDragOffsetRef = useRef(0);
  const surfaceDraggingRef = useRef(false);
  const wasInlineEditingRef = useRef(false);
  const inlineEditorDismissModeRef = useRef<QueueSurfaceMode | null>(null);
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
        `${queuedMessage.id}:${queuedMessage.groupWithNext ? "1" : "0"}:${queuedMessage.updatedAt}`,
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
  const sortableIds = useMemo(
    () =>
      inlineEditor
        ? combinedIds.filter((id) => id !== inlineEditor.queuedMessageId)
        : combinedIds,
    [combinedIds, inlineEditor],
  );
  const sortingStrategy = useCallback<SortingStrategy>(
    (args) => queuedMessageSortingStrategy(sortableIds, args),
    [sortableIds],
  );
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
  // Keep a dragged row inside both the visible viewport and the rendered list:
  // short queues should not gain scrollable overflow below the final row.
  const listRef = useRef<HTMLUListElement>(null);
  const restrictToListBounds = useCallback<Modifier>(
    ({ draggingNodeRect, transform }) => {
      return clampQueuedMessageDragTransform({
        draggingNodeRect,
        listRect: listRef.current?.getBoundingClientRect() ?? null,
        scrollRect: scrollRef.current?.getBoundingClientRect() ?? null,
        transform,
      });
    },
    [scrollRef],
  );
  const snapGroupBoundaryToRowStroke = useCallback<Modifier>(
    ({ active, activeNodeRect, over, transform }) =>
      snapGroupBoundaryDragTransform({
        activeId: active ? String(active.id) : null,
        activeNodeRect,
        overId: over ? String(over.id) : null,
        overRect: over?.rect ?? null,
        transform,
      }),
    [],
  );

  useEffect(() => {
    if (inlineEditor) {
      if (!wasInlineEditingRef.current) {
        inlineEditorDismissModeRef.current = null;
      }
      setMode("workspace");
    } else if (wasInlineEditingRef.current) {
      setMode(inlineEditorDismissModeRef.current ?? "drawer");
      inlineEditorDismissModeRef.current = null;
    }
    wasInlineEditingRef.current = inlineEditor !== undefined;
  }, [inlineEditor]);

  const openWorkspace = useCallback(() => {
    setMode("workspace");
    setSurfaceDragOffset(0);
    surfaceDragOffsetRef.current = 0;
  }, []);
  const dockWorkspace = useCallback(() => {
    setMode("drawer");
    inlineEditorDismissModeRef.current = "drawer";
    inlineEditor?.onDismiss();
    setSurfaceDragOffset(0);
    surfaceDragOffsetRef.current = 0;
  }, [inlineEditor]);
  const collapseDrawer = useCallback(() => {
    setMode("collapsed");
    inlineEditorDismissModeRef.current = "collapsed";
    inlineEditor?.onDismiss();
    setSurfaceDragOffset(0);
    surfaceDragOffsetRef.current = 0;
  }, [inlineEditor]);
  const showDrawer = useCallback(() => {
    setMode("drawer");
    setSurfaceDragOffset(0);
    surfaceDragOffsetRef.current = 0;
  }, []);
  const handleEdit = useCallback(
    (request: QueuedMessageEditRequest) => {
      openWorkspace();
      onEdit(request);
    },
    [onEdit, openWorkspace],
  );
  const handleSurfacePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      surfaceDragStartYRef.current = event.clientY;
      surfaceDragOffsetRef.current = 0;
      setSurfaceDragOffset(0);
      surfaceDraggingRef.current = true;
      setSurfaceDragging(true);
    },
    [],
  );
  const handleSurfacePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!surfaceDraggingRef.current) return;
      const offset = surfaceDragStartYRef.current - event.clientY;
      surfaceDragOffsetRef.current = offset;
      setSurfaceDragOffset(offset);
    },
    [],
  );
  const finishSurfaceDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!surfaceDraggingRef.current) return;
      const offset =
        event.type === "pointerup"
          ? surfaceDragStartYRef.current - event.clientY
          : surfaceDragOffsetRef.current;
      surfaceDraggingRef.current = false;
      setSurfaceDragging(false);
      setSurfaceDragOffset(0);
      surfaceDragOffsetRef.current = 0;

      if (mode !== "workspace" && offset >= SURFACE_DRAG_THRESHOLD) {
        openWorkspace();
      } else if (mode === "workspace" && offset <= -SURFACE_DRAG_THRESHOLD) {
        dockWorkspace();
      } else if (mode === "drawer" && offset <= -SURFACE_DRAG_THRESHOLD) {
        collapseDrawer();
      }
    },
    [collapseDrawer, dockWorkspace, mode, openWorkspace],
  );
  const handleSurfaceKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        event.preventDefault();
        if (mode === "collapsed") showDrawer();
        else openWorkspace();
      } else if (event.key === "ArrowDown" || event.key === "Escape") {
        event.preventDefault();
        if (mode === "workspace") dockWorkspace();
        else collapseDrawer();
      }
    },
    [collapseDrawer, dockWorkspace, mode, openWorkspace, showDrawer],
  );

  const baseSurfaceHeight =
    inlineEditor || mode === "workspace"
      ? getWorkspaceHeight({
          inlineEditing: inlineEditor !== undefined,
          messageCount: queuedMessages.length,
        })
      : mode === "drawer"
        ? Math.min(DRAWER_HEIGHT, 57 + Math.max(1, queuedMessages.length) * 33)
        : COLLAPSED_HEIGHT;
  const surfaceHeight = surfaceDragging
    ? clamp(
        baseSurfaceHeight + surfaceDragOffset,
        COLLAPSED_HEIGHT,
        WORKSPACE_MAX_HEIGHT + 22,
      )
    : baseSurfaceHeight;

  const queueItems: ReactNode[] = [];
  let messageIndex = 0;
  let inlineEditorInserted = false;
  for (const id of combinedIds) {
    if (id === GROUP_DIVIDER_ID) {
      queueItems.push(
        <SortableGroupBoundaryHandle
          key={GROUP_DIVIDER_ID}
          disabled={sortingDisabled || inlineEditor !== undefined}
        />,
      );
      continue;
    }
    const queuedMessage = orderedMessages.find((message) => message.id === id);
    if (!queuedMessage) continue;
    if (
      inlineEditor &&
      !inlineEditorInserted &&
      queuedMessage.id === inlineEditor.queuedMessageId
    ) {
      queueItems.push(
        <QueuedMessageInlineEditorSlot
          key={`inline-editor:${inlineEditor.queuedMessageId}`}
          editor={inlineEditor}
        />,
      );
      inlineEditorInserted = true;
    }
    if (queuedMessage.id !== inlineEditor?.queuedMessageId) {
      queueItems.push(
        <QueuedMessageRow
          key={queuedMessage.id}
          queuedMessage={queuedMessage}
          resolveMentionLink={resolveMentionLink}
          index={messageIndex}
          isProcessing={processingMessageId === queuedMessage.id}
          processingLabel={processingLabel}
          dragDisabled={sortingDisabled || inlineEditor !== undefined}
          sendDisabled={sendDisabled}
          actionDisabled={actionDisabled}
          compact={mode !== "workspace"}
          isGroupBoundary={messageIndex === groupBoundaryIndex}
          onSendImmediately={onSendImmediately}
          onEdit={handleEdit}
          onDelete={onDelete}
        />,
      );
    }
    messageIndex += 1;
  }
  if (inlineEditor && !inlineEditorInserted) {
    queueItems.push(
      <QueuedMessageInlineEditorSlot
        key={`inline-editor:${inlineEditor.queuedMessageId}`}
        editor={inlineEditor}
      />,
    );
  }

  if (queuedMessages.length === 0 && !inlineEditor) return null;

  return (
    <PromptStackCard
      ariaLabel="Queued messages"
      style={{ height: surfaceHeight }}
      className={cn(
        "relative z-10 flex min-h-0 flex-col overflow-hidden bg-surface-raised-solid shadow-lift",
        inlineEditor
          ? "mb-0 rounded-xl pb-4"
          : "-mb-5 rounded-xl rounded-b-none border-b-0 pb-3",
        !surfaceDragging &&
          "transition-[height,margin,border-radius,padding] duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
      )}
    >
      <header
        className={cn(
          "flex h-9 shrink-0 items-center gap-2 px-2",
          mode !== "collapsed" && "border-b border-border/35",
        )}
        data-queued-messages-mode={mode}
      >
        <div className="flex min-w-20 items-baseline gap-1.5 pl-1">
          <span className="text-xs font-medium text-foreground">Queued</span>
          <span className="text-2xs text-subtle-foreground">
            {queuedMessages.length}
          </span>
        </div>
        <button
          type="button"
          className={cn(
            "group/handle flex h-full min-w-24 flex-1 touch-none cursor-ns-resize select-none items-center justify-center focus-visible:rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            surfaceDragging && "cursor-grabbing",
          )}
          aria-label={
            mode === "workspace"
              ? "Drag down to dock the queue"
              : "Drag up to open the queue workspace"
          }
          onPointerDown={handleSurfacePointerDown}
          onPointerMove={handleSurfacePointerMove}
          onPointerUp={finishSurfaceDrag}
          onPointerCancel={finishSurfaceDrag}
          onKeyDown={handleSurfaceKeyDown}
        >
          <span className="h-1 w-10 rounded-full bg-border transition-colors group-hover/handle:bg-muted-foreground/45" />
        </button>
        <div className="flex min-w-20 items-center justify-end">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7 text-muted-foreground"
            onClick={
              mode === "workspace"
                ? collapseDrawer
                : mode === "drawer"
                  ? openWorkspace
                  : showDrawer
            }
            aria-label={
              mode === "workspace"
                ? "Collapse queued messages"
                : mode === "drawer"
                  ? "Expand queued messages"
                  : "Show queued messages"
            }
            aria-expanded={mode !== "collapsed"}
          >
            <Icon
              name={mode === "workspace" ? "ChevronDown" : "ChevronUp"}
              className="size-4 text-subtle-foreground opacity-60"
              aria-hidden
            />
          </Button>
        </div>
      </header>
      <div
        className="relative min-h-0 flex-1"
        data-queued-messages-scroll-frame=""
        aria-hidden={mode === "collapsed"}
        inert={mode === "collapsed" ? true : undefined}
      >
        <div
          ref={scrollRef}
          data-queued-messages-scroll=""
          className="h-full min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain"
          tabIndex={mode === "collapsed" ? -1 : 0}
        >
          <div ref={topSentinelRef} aria-hidden className="h-px w-full" />
          <DndContext
            sensors={sensors}
            collisionDetection={queuedMessageCollisionDetection}
            modifiers={[restrictToListBounds, snapGroupBoundaryToRowStroke]}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={sortableIds} strategy={sortingStrategy}>
              <ul ref={listRef} className="group/queue py-1">
                {queueItems}
              </ul>
            </SortableContext>
          </DndContext>
          <div ref={bottomSentinelRef} aria-hidden className="h-px w-full" />
        </div>
        {aboveOverflow && mode !== "collapsed" ? (
          <OverflowFade
            placement="above"
            tone="surface-raised"
            inset
            className="z-10"
          />
        ) : null}
        {belowOverflow && mode !== "collapsed" ? (
          <OverflowFade
            placement="below"
            tone="surface-raised"
            inset
            className="z-10"
          />
        ) : null}
      </div>
    </PromptStackCard>
  );
}
