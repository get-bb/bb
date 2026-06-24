import { useCallback, useState } from "react";
import { CopyButton } from "../../ui/copy-button.js";
import { Icon } from "@/components/ui/icon.js";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { cn } from "@/lib/utils";

interface MessageActionBarProps {
  messageText: string;
  alignment: "start" | "end";
  onAddToChat?: (text: string) => void;
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
}

// Shared hover-reveal classes for every action in the bar: hidden until the
// surrounding named `group/message` row is hovered or a child control takes
// keyboard focus (`group-focus-within`, matching disclosure.tsx so tabbing onto
// an action button reveals the bar). The fork/side-chat buttons mirror
// CopyButton's own classes so all three read as one consistent affordance.
const ACTION_BUTTON_CLASS =
  "inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40 max-md:pointer-coarse:hidden";
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100";
const MOBILE_OVERFLOW_TRIGGER_CLASS =
  "hidden size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground max-md:pointer-coarse:inline-flex max-md:pointer-coarse:[&_svg]:size-5";
const ACTION_TOOLTIP_SIDE = "bottom";

export function findMessageActionTooltipCollisionBoundary(
  node: HTMLElement | null,
): HTMLElement | undefined {
  return node?.closest<HTMLElement>("[data-thread-window]") ?? undefined;
}

/**
 * Hover-revealed footer of per-message actions (copy, and — when wired —
 * fork / side chat). Renders an action only when it is meaningful: copy when
 * there is text to copy, fork/side chat only when their handlers are supplied.
 * S3/S4 supply `onFork` / `onSideChat`; until then the agent footer shows copy
 * alone. `disabled` greys the fork/side-chat buttons (e.g. at the depth cap)
 * while leaving copy usable.
 */
export function MessageActionBar({
  messageText,
  alignment,
  onAddToChat,
  onFork,
  onSideChat,
  onSendToMain,
  disabled,
}: MessageActionBarProps) {
  const hasCopy = messageText.length > 0;
  const hasAddToChat = hasCopy && onAddToChat !== undefined;
  const [collisionBoundary, setCollisionBoundary] =
    useState<HTMLElement | undefined>();
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setCollisionBoundary(findMessageActionTooltipCollisionBoundary(node));
  }, []);
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
          },
        ]
      : []),
    ...(hasAddToChat
      ? [
          {
            icon: "MessageSquarePlus" as const,
            label: "Add to chat",
            onSelect: () => onAddToChat(messageText),
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
            onSelect: onSideChat,
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
                // The design-system tooltip replaces the native one below.
                title={undefined}
                className={cn(
                  HOVER_REVEAL_CLASS,
                  "max-md:pointer-coarse:hidden",
                )}
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
                className={cn(ACTION_BUTTON_CLASS, HOVER_REVEAL_CLASS)}
                onClick={() => onAddToChat(messageText)}
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
                className={cn(ACTION_BUTTON_CLASS, HOVER_REVEAL_CLASS)}
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
                className={cn(ACTION_BUTTON_CLASS, HOVER_REVEAL_CLASS)}
                onClick={onSideChat}
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
                className={cn(ACTION_BUTTON_CLASS, HOVER_REVEAL_CLASS)}
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={MOBILE_OVERFLOW_TRIGGER_CLASS}
              aria-label="Message actions"
              title="Message actions"
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
      </div>
    </TooltipProvider>
  );
}
