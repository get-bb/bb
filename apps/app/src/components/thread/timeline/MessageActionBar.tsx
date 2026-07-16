import { useCallback, useEffect, useState } from "react";
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
import type { PromptDraftAttachment } from "@/lib/prompt-draft";

interface MessageActionBarProps {
  messageText: string;
  alignment: "start" | "end";
  mobileActionDisplay: "inline" | "overflow";
  addToChatAttachments?: readonly PromptDraftAttachment[];
  onAddToChat?: (
    text: string,
    attachments?: readonly PromptDraftAttachment[],
  ) => void;
  onFork?: () => void;
  onSideChat?: () => void;
  /**
   * Hand this message back to the main thread. Supplied only inside a side chat
   * (the main timeline has no main thread to send to). Not gated by `disabled`,
   * which only greys the child-spawning fork/side-chat actions.
   */
  onSendToMain?: () => void;
  disabled?: boolean;
}

interface MessageOverflowAction {
  icon:
    | "Copy"
    | "MessageSquarePlus"
    | "Fork"
    | "SideChat"
    | "ArrowTurnBackward";
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  copyText?: string;
  kind?: "copy";
}

interface MobileMessageOverflowPopoverProps {
  actions: readonly MessageOverflowAction[];
  alignment: MessageActionBarProps["alignment"];
}

function MobileMessageOverflowPopover({
  actions,
  alignment,
}: MobileMessageOverflowPopoverProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timeoutId = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timeoutId);
  }, [copied]);
  const selectAction = useCallback((action: MessageOverflowAction) => {
    // Close before an action navigates or replaces the active panel.
    flushSync(() => setOpen(false));
    action.onSelect();
  }, []);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={MOBILE_OVERFLOW_TRIGGER_CLASS}
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
              key={action.label}
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
              <Icon name={action.icon} className="size-3.5 shrink-0" />
              {action.label}
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

// Shared hover-reveal classes for every action in the bar: hidden until the
// surrounding named `group/message` row is hovered or a child control takes
// keyboard focus (`group-focus-within`, matching disclosure.tsx so tabbing onto
// an action button reveals the bar). The fork/side-chat buttons mirror
// CopyButton's own classes so all three read as one consistent affordance.
const ACTION_BUTTON_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100";
const MOBILE_INLINE_ACTION_CLASS =
  "max-md:pointer-coarse:size-7 max-md:pointer-coarse:opacity-100 max-md:pointer-coarse:disabled:opacity-40 max-md:pointer-coarse:[&_svg]:size-4";
const MOBILE_OVERFLOW_ACTION_CLASS = "max-md:pointer-coarse:hidden";
const MOBILE_OVERFLOW_TRIGGER_CLASS =
  "hidden size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground max-md:pointer-coarse:inline-flex max-md:pointer-coarse:[&_svg]:size-4";
const ACTION_TOOLTIP_SIDE = "bottom";
const MOBILE_OVERFLOW_CONTENT_CLASS =
  "z-50 flex max-h-[50dvh] w-44 flex-col gap-0.5 overflow-y-auto rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";
const MOBILE_OVERFLOW_ITEM_CLASS =
  "flex min-h-8 w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-xs text-foreground transition-colors hover:bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:bg-state-active disabled:pointer-events-none disabled:opacity-40 select-none";

export function findMessageActionTooltipCollisionBoundary(
  node: HTMLElement | null,
): HTMLElement | undefined {
  return node?.closest<HTMLElement>("[data-thread-window]") ?? undefined;
}

/**
 * Hover-revealed footer of per-message actions. Renders an action only when it
 * is meaningful: copy when there is text, add-to-chat when a composer owns the
 * draft, and fork/side-chat when their handlers are supplied. `disabled` greys
 * the fork/side-chat buttons (e.g. at the depth cap) while leaving copy and
 * add-to-chat usable.
 */
export function MessageActionBar({
  messageText,
  alignment,
  mobileActionDisplay,
  addToChatAttachments = [],
  onAddToChat,
  onFork,
  onSideChat,
  onSendToMain,
  disabled,
}: MessageActionBarProps) {
  const isCompactViewport = useIsCompactViewport();
  const isPointerCoarse = usePointerCoarse();
  const hasCopy = messageText.length > 0;
  const hasAddToChat =
    (hasCopy || addToChatAttachments.length > 0) && onAddToChat !== undefined;
  const [collisionBoundary, setCollisionBoundary] = useState<
    HTMLElement | undefined
  >();
  const mobileDirectActionClass =
    mobileActionDisplay === "inline"
      ? MOBILE_INLINE_ACTION_CLASS
      : MOBILE_OVERFLOW_ACTION_CLASS;
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setCollisionBoundary(findMessageActionTooltipCollisionBoundary(node));
  }, []);
  const handleAddToChat = useCallback(() => {
    if (!onAddToChat) return;
    if (addToChatAttachments.length > 0) {
      onAddToChat(messageText, addToChatAttachments);
      return;
    }
    onAddToChat(messageText);
  }, [addToChatAttachments, messageText, onAddToChat]);
  const handleSideChat = useCallback(() => {
    if (!onSideChat) return;
    onSideChat();
  }, [onSideChat]);
  const overflowActions: MessageOverflowAction[] = [
    ...(hasCopy
      ? [
          {
            icon: "Copy" as const,
            label: "Copy message",
            onSelect: () => {
              void copyToClipboardWithToast(messageText, {
                errorMessage: "Failed to copy",
              });
            },
            copyText: messageText,
            kind: "copy" as const,
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
    ...(onSideChat
      ? [
          {
            icon: "SideChat" as const,
            label: "Reply in side chat",
            onSelect: handleSideChat,
            disabled,
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
  ];
  const useMobileOverflowPopover = isCompactViewport && isPointerCoarse;

  if (!hasCopy && !hasAddToChat && !onFork && !onSideChat && !onSendToMain) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        ref={containerRef}
        className={cn(
          "flex items-center gap-2",
          alignment === "end" ? "justify-end" : "justify-start",
        )}
      >
        {hasCopy ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <CopyButton
                text={messageText}
                label="Copy message"
                className={cn(HOVER_REVEAL_CLASS, mobileDirectActionClass)}
              />
            </TooltipTrigger>
            <TooltipContent
              side={ACTION_TOOLTIP_SIDE}
              collisionBoundary={collisionBoundary}
            >
              Copy message
            </TooltipContent>
          </Tooltip>
        ) : null}
        {hasAddToChat ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  ACTION_BUTTON_CLASS,
                  HOVER_REVEAL_CLASS,
                  mobileDirectActionClass,
                )}
                onClick={handleAddToChat}
                aria-label="Add to chat"
              >
                <Icon name="MessageSquarePlus" className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side={ACTION_TOOLTIP_SIDE}
              collisionBoundary={collisionBoundary}
            >
              Add to chat
            </TooltipContent>
          </Tooltip>
        ) : null}
        {onFork ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  ACTION_BUTTON_CLASS,
                  HOVER_REVEAL_CLASS,
                  mobileDirectActionClass,
                )}
                onClick={onFork}
                disabled={disabled}
                aria-label="Fork into new thread"
              >
                <Icon name="Fork" className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side={ACTION_TOOLTIP_SIDE}
              collisionBoundary={collisionBoundary}
            >
              Fork into new thread
            </TooltipContent>
          </Tooltip>
        ) : null}
        {onSideChat ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  ACTION_BUTTON_CLASS,
                  HOVER_REVEAL_CLASS,
                  mobileDirectActionClass,
                )}
                onClick={handleSideChat}
                disabled={disabled}
                aria-label="Reply in side chat"
              >
                <Icon name="SideChat" className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side={ACTION_TOOLTIP_SIDE}
              collisionBoundary={collisionBoundary}
            >
              Reply in side chat
            </TooltipContent>
          </Tooltip>
        ) : null}
        {onSendToMain ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  ACTION_BUTTON_CLASS,
                  HOVER_REVEAL_CLASS,
                  mobileDirectActionClass,
                )}
                onClick={onSendToMain}
                aria-label="Send to main thread"
              >
                <Icon name="ArrowTurnBackward" className="size-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side={ACTION_TOOLTIP_SIDE}
              collisionBoundary={collisionBoundary}
            >
              Send to main thread
            </TooltipContent>
          </Tooltip>
        ) : null}
        {mobileActionDisplay === "overflow" ? (
          useMobileOverflowPopover ? (
            <MobileMessageOverflowPopover
              actions={overflowActions}
              alignment={alignment}
            />
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={MOBILE_OVERFLOW_TRIGGER_CLASS}
                  aria-label="Message actions"
                  data-no-sidebar-swipe=""
                >
                  <Icon name="MoreHorizontal" className="size-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={alignment === "end" ? "end" : "start"}
                mobileTitle="Message actions"
                className="w-48"
              >
                {overflowActions.map((action) => (
                  <DropdownMenuItem
                    key={action.label}
                    disabled={action.disabled}
                    onSelect={action.onSelect}
                    textValue={action.label}
                  >
                    <Icon name={action.icon} aria-hidden="true" />
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        ) : null}
      </div>
    </TooltipProvider>
  );
}
