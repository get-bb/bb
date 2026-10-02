import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { CopyButton } from "../../ui/copy-button.js";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import { preventOverlayTriggerSelection } from "@bb/shared-ui/overlay-trigger";
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
import { usePortalScopeProps } from "@/lib/portal-scope";
import { PluginItemIcon, pluginIconName } from "@/components/plugin/PluginIcon";
import type { ThreadTimelinePluginMessageAction } from "./types.js";
import {
  useMessageExecutionLabel,
  type MessageExecutionMetadata,
} from "./message-execution-label.js";

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

export interface MessageMenuMetadata {
  timestamp: number;
  execution?: MessageExecutionMetadata;
}

interface MessageActionBarProps {
  metadata: MessageMenuMetadata;
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

function useTransientFlag(): [boolean, (flag: boolean) => void] {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    if (!flag) return;
    const timeoutId = window.setTimeout(() => setFlag(false), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [flag]);
  return [flag, setFlag];
}

const DESKTOP_ACTION_WIDTH_PX = 20;
const TOUCH_ACTION_WIDTH_PX = 28;
const ACTION_ROW_GAP_PX = 8;
const OVERFLOW_TRIGGER_GAP_PX = 4;
const OVERFLOW_TRIGGER_TIGHTEN_CLASS = "-ml-1";

function actionRowWidth(count: number, actionWidth: number): number {
  return count <= 0 ? 0 : count * actionWidth + (count - 1) * ACTION_ROW_GAP_PX;
}

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
  if (actionRowWidth(actionCount, actionWidth) <= availableWidth) {
    return { inlineCount: actionCount, overflowCount: 0 };
  }
  const inlineCount = Math.max(
    0,
    Math.min(
      actionCount - 1,
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

function useMeasuredWidth({ enabled }: { enabled: boolean }): {
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
      const observer = new ResizeObserver(([entry]) => {
        const inlineSize =
          entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        setWidth(Math.floor(inlineSize));
      });
      observer.observe(node);
      observerRef.current = observer;
    },
    [enabled],
  );
  return { measureRef, width };
}

interface MobileMessageOverflowPopoverProps {
  actions: readonly MessageOverflowAction[];
  alignment: MessageActionBarProps["alignment"];
  metadata: MessageMenuMetadata;
  triggerClassName?: string;
}

function MobileMessageOverflowPopover({
  actions,
  alignment,
  metadata,
  triggerClassName,
}: MobileMessageOverflowPopoverProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useTransientFlag();
  const portalScopeProps = usePortalScopeProps();
  const selectAction = useCallback((action: MessageOverflowAction) => {
    flushSync(() => setOpen(false));
    action.onSelect();
  }, []);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(MOBILE_OVERFLOW_TRIGGER_CLASS, triggerClassName)}
          aria-label="Message actions"
          data-no-sidebar-swipe=""
          onMouseDown={preventOverlayTriggerSelection}
        >
          <Icon
            name={copied ? "Check" : "MoreHorizontal"}
            className={cn(
              "size-3",
              copied && "animate-in zoom-in-50 duration-150",
            )}
          />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          {...portalScopeProps}
          side="top"
          align={alignment === "end" ? "end" : "start"}
          sideOffset={6}
          collisionPadding={8}
          className={MOBILE_OVERFLOW_CONTENT_CLASS}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {actions.map((action) => (
            <button
              key={action.key ?? action.label}
              type="button"
              className={MOBILE_OVERFLOW_ITEM_CLASS}
              disabled={action.disabled}
              onClick={() => {
                if (action.kind === "copy") {
                  void copyToClipboardWithToast(action.copyText ?? "", {
                    successMessage: null,
                    errorMessage: "Failed to copy",
                  }).then((didCopy) => {
                    if (!didCopy) return;
                    setCopied(true);
                    flushSync(() => setOpen(false));
                  });
                  return;
                }
                selectAction(action);
              }}
            >
              <MessageActionIcon
                action={action}
                className="size-3.5 shrink-0"
              />
              {action.label}
            </button>
          ))}
          <MessageMetadataFooter
            metadata={metadata}
            className="-mx-0.5 -mb-0.5"
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

const ACTION_BUTTON_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100";
const MOBILE_INLINE_ACTION_CLASS =
  "max-md:pointer-coarse:size-7 max-md:pointer-coarse:opacity-100 max-md:pointer-coarse:disabled:opacity-40 max-md:pointer-coarse:[&_[data-icon-root]]:size-4";
const MOBILE_OVERFLOW_TRIGGER_CLASS =
  "hidden size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground max-md:pointer-coarse:inline-flex max-md:pointer-coarse:[&_[data-icon-root]]:size-4";
const ACTION_TOOLTIP_SIDE = "bottom";
const MENU_CONTENT_WIDTH_CLASS = "max-w-[min(16rem,calc(100vw-1rem))]";
const MOBILE_OVERFLOW_CONTENT_CLASS =
  "z-50 flex max-h-[50dvh] w-max min-w-32 max-w-[min(15rem,calc(100vw-1.5rem))] flex-col gap-0.5 overflow-y-auto rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";
const MOBILE_OVERFLOW_ITEM_CLASS =
  "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:bg-state-active disabled:pointer-events-none disabled:opacity-40 select-none";

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

function MessageExecutionLine({
  execution,
}: {
  execution: MessageExecutionMetadata;
}) {
  const label = useMessageExecutionLabel(execution);
  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1"
      title="Model and reasoning requested for this turn"
    >
      <span className="break-all font-medium">{label.model}</span>
      <span>{label.reasoning}</span>
    </div>
  );
}

function MessageMetadataFooter({
  metadata,
  className,
}: {
  metadata: MessageMenuMetadata;
  className: string;
}) {
  const date = new Date(metadata.timestamp);
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
      className={cn(
        "mt-1 border-t border-border bg-surface-recessed px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
      data-message-metadata=""
    >
      <time dateTime={date.toISOString()} title={fullDate}>
        {formatMessageDay(date, new Date())}, {time}
      </time>
      {metadata.execution ? (
        <MessageExecutionLine execution={metadata.execution} />
      ) : null}
    </div>
  );
}

export function MessageActionBar({
  metadata,
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
  const useMobileOverflowPopover = isCompactViewport && isPointerCoarse;
  const showsInlineActions =
    !useMobileOverflowPopover || mobileActionDisplay === "inline";
  const hasCopy = messageText.length > 0 || copyImageUrl !== undefined;
  const hasAddToChat =
    (hasCopy || addToChatAttachments.length > 0) && onAddToChat !== undefined;
  const [collisionBoundary, setCollisionBoundary] = useState<
    HTMLElement | undefined
  >();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { measureRef, width: availableWidth } = useMeasuredWidth({
    enabled: showsInlineActions,
  });
  const slotRef = useCallback(
    (node: HTMLDivElement | null) => {
      measureRef(node);
      setCollisionBoundary(findMessageActionTooltipCollisionBoundary(node));
    },
    [measureRef],
  );
  const handleAddToChat = useCallback(() => {
    if (!onAddToChat) return;
    if (addToChatAttachments.length > 0) {
      onAddToChat(messageText, addToChatAttachments);
      return;
    }
    onAddToChat(messageText);
  }, [addToChatAttachments, messageText, onAddToChat]);
  const inlineActions: MessageOverflowAction[] = [
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
    ...pluginActions.map((action) => ({
      icon: "Copy" as const,
      plugin: { pluginId: action.pluginId, icon: action.icon },
      key: action.key,
      label: action.label,
      onSelect: action.onSelect,
    })),
  ];
  const menuActions: MessageOverflowAction[] = [
    ...(onCopyLink
      ? [
          {
            icon: "Link" as const,
            label: "Copy link to message",
            onSelect: onCopyLink,
          },
        ]
      : []),
    ...(hasAddToChat
      ? [
          {
            icon: "MessageSquarePlus" as const,
            label: "Add to chat",
            onSelect: handleAddToChat,
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
  const actionWidth = useMobileOverflowPopover
    ? TOUCH_ACTION_WIDTH_PX
    : DESKTOP_ACTION_WIDTH_PX;
  const inlineCount = showsInlineActions
    ? Math.min(
        inlineActions.length,
        computeMessageActionRowLayout({
          actionCount: inlineActions.length + 1,
          availableWidth,
          actionWidth,
        }).inlineCount,
      )
    : 0;
  const shownInline = inlineActions.slice(0, inlineCount);
  const overflowActions = [...inlineActions.slice(inlineCount), ...menuActions];
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

  if (useMobileOverflowPopover) {
    return (
      <div ref={slotRef} className={cn(slotClass, "h-7")}>
        <div className={rowClass}>
          {shownInline.length > 0 ? (
            <MobileInlineActions actions={shownInline} />
          ) : null}
          <MobileMessageOverflowPopover
            actions={overflowActions}
            alignment={alignment}
            metadata={metadata}
            triggerClassName={
              shownInline.length > 0
                ? OVERFLOW_TRIGGER_TIGHTEN_CLASS
                : undefined
            }
          />
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={slotRef} className={cn(slotClass, "h-5")}>
        <div className={rowClass} data-menu-open={isMenuOpen ? "" : undefined}>
          {shownInline.map((action) => (
            <DesktopMessageAction
              key={action.key ?? action.label}
              action={action}
              className={HOVER_REVEAL_CLASS}
              collisionBoundary={collisionBoundary}
            />
          ))}
          <DropdownMenu onOpenChange={setIsMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  ACTION_BUTTON_CLASS,
                  HOVER_REVEAL_CLASS,
                  shownInline.length > 0 && OVERFLOW_TRIGGER_TIGHTEN_CLASS,
                  "data-[state=open]:text-foreground data-[state=open]:opacity-100",
                )}
                aria-label="Message actions"
              >
                <Icon name="MoreHorizontal" className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align={alignment === "end" ? "end" : "start"}
              mobileTitle="Message actions"
              className={MENU_CONTENT_WIDTH_CLASS}
            >
              <MessageActionMenuItems actions={overflowActions} />
              <MessageMetadataFooter
                metadata={metadata}
                className="-mx-1 -mb-1"
              />
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
