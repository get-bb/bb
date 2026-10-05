import { createContext, useCallback, useRef, useState } from "react";
import { CopyButton } from "../../ui/copy-button.js";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import type { PromptDraftAttachment } from "@bb/client-core";
import { PluginItemIcon, pluginIconName } from "@/components/plugin/PluginIcon";
import type { ThreadTimelinePluginMessageAction } from "./types.js";

function PluginActionIcon({
  pluginId,
  icon,
  className,
}: {
  pluginId: string | null;
  icon: string | null;
  className?: string;
}) {
  return pluginId === null ? (
    <Icon
      name={pluginIconName(icon)}
      className={cn("size-4 shrink-0", className)}
      aria-hidden="true"
    />
  ) : (
    <PluginItemIcon pluginId={pluginId} icon={icon} className={className} />
  );
}

interface MessageActionBarProps {
  timestamp: number;
  messageText: string;
  alignment: "start" | "end";
  mobileActionDisplay: "inline" | "overflow";
  addToChatAttachments?: readonly PromptDraftAttachment[];
  copyImageUrl?: string;
  onAddToChat?: (
    text: string,
    attachments?: readonly PromptDraftAttachment[],
  ) => void;
  onCopyLink?: () => void;
  onEdit?: () => void;
  onFork?: () => void;
  onSendToMain?: () => void;
  disabled?: boolean;
  pluginActions?: readonly ThreadTimelinePluginMessageAction[];
}

interface MessageOverflowAction {
  icon:
    | "Copy"
    | "Link"
    | "Edit"
    | "MessageSquarePlus"
    | "Fork"
    | "ArrowTurnBackward";
  plugin?: { pluginId: string | null; icon: string | null };
  key?: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  copyText?: string;
  copyImageUrl?: string;
  kind?: "copy";
}

function MessageActionIcon({
  action,
  className,
  ariaHidden,
}: {
  action: MessageOverflowAction;
  className?: string;
  ariaHidden?: "true";
}) {
  return action.plugin ? (
    <PluginActionIcon
      pluginId={action.plugin.pluginId}
      icon={action.plugin.icon}
      className={className}
    />
  ) : (
    <Icon name={action.icon} className={className} aria-hidden={ariaHidden} />
  );
}

const DESKTOP_ACTION_WIDTH_PX = 20;
const TOUCH_ACTION_WIDTH_PX = 28;
const ACTION_ROW_GAP_PX = 8;
const OVERFLOW_TRIGGER_GAP_PX = 4;
const OVERFLOW_TRIGGER_TIGHTEN_CLASS = "-ml-1";

interface MessageActionRowLayout {
  inlineCount: number;
  overflowCount: number;
}

export function computeMessageActionRowLayout({
  actionCount,
  availableWidth,
  actionWidth,
}: {
  actionCount: number;
  availableWidth: number | undefined;
  actionWidth: number;
}): MessageActionRowLayout {
  if (actionCount <= 0) {
    return { inlineCount: 0, overflowCount: 0 };
  }
  if (availableWidth === undefined) {
    return { inlineCount: actionCount, overflowCount: 0 };
  }
  const inlineCount = Math.max(
    0,
    Math.min(
      actionCount,
      Math.floor(
        (availableWidth -
          actionWidth -
          OVERFLOW_TRIGGER_GAP_PX +
          ACTION_ROW_GAP_PX) /
          (actionWidth + ACTION_ROW_GAP_PX),
      ),
    ),
  );
  return { inlineCount, overflowCount: actionCount - inlineCount };
}

export function useMeasuredWidth({
  enabled,
  resolveTarget,
}: {
  enabled: boolean;
  resolveTarget?: (node: HTMLElement) => Element | null;
}): {
  measureRef: (node: HTMLElement | null) => void;
  width: number | undefined;
} {
  const [width, setWidth] = useState<number | undefined>(undefined);
  const observerRef = useRef<ResizeObserver | null>(null);
  const measureRef = useCallback(
    (node: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!enabled || node === null || typeof ResizeObserver === "undefined") {
        return;
      }
      const target = resolveTarget ? resolveTarget(node) : node;
      if (target === null) {
        return;
      }
      const observer = new ResizeObserver(([entry]) => {
        const inlineSize =
          entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setWidth(Math.floor(inlineSize));
      });
      observer.observe(target);
      observerRef.current = observer;
    },
    [enabled, resolveTarget],
  );
  return { measureRef, width };
}

export interface SharedMessageColumnWidth {
  width: number | undefined;
}

export const MessageColumnWidthContext =
  createContext<SharedMessageColumnWidth | null>(null);

const ACTION_BUTTON_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100";
const MOBILE_INLINE_ACTION_CLASS =
  "max-md:pointer-coarse:size-7 max-md:pointer-coarse:opacity-100 max-md:pointer-coarse:disabled:opacity-40 max-md:pointer-coarse:[&_[data-icon-root]]:size-4";
const MOBILE_OVERFLOW_ACTION_CLASS = "max-md:pointer-coarse:hidden";
const ACTION_TOOLTIP_SIDE = "bottom";
const MENU_CONTENT_WIDTH_CLASS = "max-w-[min(16rem,calc(100vw-1rem))]";

const ACTION_ROW_CLASS =
  "absolute top-0 flex max-w-full items-center gap-2 overflow-hidden data-[menu-open]:[&_button]:opacity-100";

const BUBBLE_ALIGN_INSET_CLASS = "pr-[13px] max-md:pointer-coarse:pr-[11px]";
const BUBBLE_ALIGN_OFFSET_CLASS =
  "right-[13px] max-md:pointer-coarse:right-[11px]";
const PROSE_ALIGN_INSET_CLASS = "-ml-1 max-md:pointer-coarse:-ml-1.5";
export const PROSE_COLUMN_INSET_CLASS = "px-2";

export function findMessageActionTooltipCollisionBoundary(
  node: HTMLElement | null,
): HTMLElement | undefined {
  return node?.closest<HTMLElement>("[data-thread-window]") ?? undefined;
}

function DesktopMessageAction({
  action,
  className,
  collisionBoundary,
}: {
  action: MessageOverflowAction;
  className: string;
  collisionBoundary: HTMLElement | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {action.kind === "copy" ? (
          <CopyButton
            text={action.copyText ?? ""}
            imageUrl={action.copyImageUrl}
            label={action.label}
            className={className}
          />
        ) : (
          <button
            type="button"
            className={cn(ACTION_BUTTON_CLASS, className)}
            onClick={action.onSelect}
            disabled={action.disabled}
            aria-label={action.label}
          >
            <MessageActionIcon action={action} className="size-3" />
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent
        side={ACTION_TOOLTIP_SIDE}
        collisionBoundary={collisionBoundary}
      >
        {action.label}
      </TooltipContent>
    </Tooltip>
  );
}

function MessageActionMenuItems({
  actions,
}: {
  actions: readonly MessageOverflowAction[];
}) {
  return actions.map((action) => (
    <DropdownMenuItem
      key={action.key ?? action.label}
      disabled={action.disabled}
      onSelect={action.onSelect}
      textValue={action.label}
    >
      <MessageActionIcon action={action} ariaHidden="true" />
      {action.label}
    </DropdownMenuItem>
  ));
}

function formatMessageDay(date: Date, now: Date): string {
  if (date.toDateString() === now.toDateString()) {
    return "Today";
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function formatShortMessageTime(timestamp: number, now: Date): string {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return date.toDateString() === now.toDateString()
    ? time
    : `${formatMessageDay(date, now)}, ${time}`;
}

function MessageTimestampFooter({ timestamp }: { timestamp: number }) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const fullDate = date.toLocaleString(undefined, {
    dateStyle: "full",
    timeStyle: "long",
  });
  return (
    <div
      className="mt-1 border-t border-border px-2 pt-2 pb-1 text-xs text-subtle-foreground"
      data-message-metadata=""
    >
      <time dateTime={date.toISOString()} title={fullDate}>
        {formatMessageDay(date, new Date())}, {time}
      </time>
    </div>
  );
}

export function MessageActionBar({
  timestamp,
  messageText,
  alignment,
  mobileActionDisplay,
  addToChatAttachments = [],
  copyImageUrl,
  onAddToChat,
  onCopyLink,
  onEdit,
  onFork,
  onSendToMain,
  disabled,
  pluginActions = [],
}: MessageActionBarProps) {
  const isCompactViewport = useIsCompactViewport();
  const isPointerCoarse = usePointerCoarse();
  const hasCopy = messageText.length > 0 || copyImageUrl !== undefined;
  const hasAddToChat =
    (hasCopy || addToChatAttachments.length > 0) && onAddToChat !== undefined;
  const [collisionBoundary, setCollisionBoundary] = useState<
    HTMLElement | undefined
  >();
  const isCompactTouch = isCompactViewport && isPointerCoarse;
  const { measureRef, width: availableWidth } = useMeasuredWidth({
    enabled: !(isCompactTouch && mobileActionDisplay === "overflow"),
  });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const slotRef = useCallback(
    (node: HTMLDivElement | null) => {
      measureRef(node);
      setCollisionBoundary(findMessageActionTooltipCollisionBoundary(node));
    },
    [measureRef],
  );
  const mobileDirectActionClass =
    mobileActionDisplay === "inline"
      ? MOBILE_INLINE_ACTION_CLASS
      : MOBILE_OVERFLOW_ACTION_CLASS;
  const handleAddToChat = useCallback(() => {
    if (!onAddToChat) return;
    if (addToChatAttachments.length > 0) {
      onAddToChat(messageText, addToChatAttachments);
      return;
    }
    onAddToChat(messageText);
  }, [addToChatAttachments, messageText, onAddToChat]);
  const inlineCandidates: MessageOverflowAction[] = [
    ...(hasCopy
      ? [
          {
            icon: "Copy" as const,
            label: "Copy message",
            onSelect: () => {
              void copyToClipboardWithToast(messageText, {
                errorMessage: "Failed to copy",
                imageUrl: copyImageUrl,
              });
            },
            copyText: messageText,
            copyImageUrl,
            kind: "copy" as const,
          },
        ]
      : []),
    ...(onEdit
      ? [
          {
            icon: "Edit" as const,
            label: "Edit message",
            onSelect: onEdit,
          },
        ]
      : []),
    ...(onSendToMain
      ? [
          {
            icon: "ArrowTurnBackward" as const,
            label: "Send to main thread",
            onSelect: onSendToMain,
          },
        ]
      : []),
    ...pluginActions.map((action) => ({
      icon: "Copy" as const,
      plugin: { pluginId: action.pluginId, icon: action.icon },
      key: action.key,
      label: action.label,
      onSelect: action.onSelect,
    })),
  ];
  const trailingMenuActions: MessageOverflowAction[] = [
    ...(hasAddToChat
      ? [
          {
            icon: "MessageSquarePlus" as const,
            label: "Add to chat",
            onSelect: handleAddToChat,
          },
        ]
      : []),
    ...(onFork
      ? [
          {
            icon: "Fork" as const,
            label: "Fork into new thread",
            onSelect: onFork,
            disabled,
          },
        ]
      : []),
  ];
  const layout = computeMessageActionRowLayout({
    actionCount: inlineCandidates.length,
    availableWidth,
    actionWidth: isCompactTouch
      ? TOUCH_ACTION_WIDTH_PX
      : DESKTOP_ACTION_WIDTH_PX,
  });
  const inlineCount =
    isCompactTouch && mobileActionDisplay === "overflow"
      ? 0
      : layout.inlineCount;
  const menuActions = [
    ...(onCopyLink
      ? [
          {
            icon: "Link" as const,
            label: "Copy link",
            onSelect: onCopyLink,
          },
        ]
      : []),
    ...inlineCandidates.slice(isCompactViewport ? 0 : inlineCount),
    ...trailingMenuActions,
  ];

  const rowClass = cn(
    ACTION_ROW_CLASS,
    alignment === "end"
      ? BUBBLE_ALIGN_OFFSET_CLASS
      : cn("left-0", PROSE_ALIGN_INSET_CLASS),
  );
  const slotClass = cn(
    "relative w-full",
    alignment === "end" && BUBBLE_ALIGN_INSET_CLASS,
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={slotRef}
        className={cn(slotClass, "h-5 max-md:pointer-coarse:h-7")}
      >
        <div className={rowClass} data-menu-open={isMenuOpen ? "" : undefined}>
          {isCompactTouch ? (
            <MobileInlineActions
              actions={inlineCandidates.slice(0, inlineCount)}
            />
          ) : (
            inlineCandidates
              .slice(0, inlineCount)
              .map((action) => (
                <DesktopMessageAction
                  key={action.key ?? action.label}
                  action={action}
                  className={cn(HOVER_REVEAL_CLASS, mobileDirectActionClass)}
                  collisionBoundary={collisionBoundary}
                />
              ))
          )}
          <DropdownMenu onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  ACTION_BUTTON_CLASS,
                  HOVER_REVEAL_CLASS,
                  MOBILE_INLINE_ACTION_CLASS,
                  inlineCount > 0 && OVERFLOW_TRIGGER_TIGHTEN_CLASS,
                  "data-[state=open]:text-foreground data-[state=open]:opacity-100",
                )}
                aria-label="Message actions"
                data-no-sidebar-swipe=""
              >
                <Icon name="MoreHorizontal" className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align={alignment === "end" ? "end" : "start"}
              mobileTitle="Message actions"
              className={MENU_CONTENT_WIDTH_CLASS}
            >
              <MessageActionMenuItems actions={menuActions} />
              <MessageTimestampFooter timestamp={timestamp} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
}

function MobileInlineActions({
  actions,
}: {
  actions: readonly MessageOverflowAction[];
}) {
  return actions.map((action) =>
    action.kind === "copy" ? (
      <CopyButton
        key={action.key ?? action.label}
        text={action.copyText ?? ""}
        imageUrl={action.copyImageUrl}
        label={action.label}
        className={cn(HOVER_REVEAL_CLASS, MOBILE_INLINE_ACTION_CLASS)}
      />
    ) : (
      <button
        key={action.key ?? action.label}
        type="button"
        className={cn(
          ACTION_BUTTON_CLASS,
          HOVER_REVEAL_CLASS,
          MOBILE_INLINE_ACTION_CLASS,
        )}
        onClick={action.onSelect}
        disabled={action.disabled}
        aria-label={action.label}
      >
        <MessageActionIcon action={action} className="size-3" />
      </button>
    ),
  );
}
