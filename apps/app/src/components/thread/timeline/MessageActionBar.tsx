import { CopyButton } from "../../ui/copy-button.js";
import { Icon } from "@/components/ui/icon.js";
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

// Shared hover-reveal classes for every action in the bar: hidden until the
// surrounding named `group/message` row is hovered or a child control takes
// keyboard focus (`group-focus-within`, matching disclosure.tsx so tabbing onto
// an action button reveals the bar). The fork/side-chat buttons mirror
// CopyButton's own classes so all three read as one consistent affordance.
const ACTION_BUTTON_CLASS =
  "inline-flex size-5 items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40 max-md:pointer-coarse:size-9 max-md:pointer-coarse:[&_svg]:size-5";
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 max-md:pointer-coarse:opacity-100";

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
  onFork,
  onSideChat,
  onSendToMain,
  disabled,
}: MessageActionBarProps) {
  const hasCopy = messageText.length > 0;
  if (!hasCopy && !onFork && !onSideChat && !onSendToMain) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
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
                  "max-md:pointer-coarse:size-9 max-md:pointer-coarse:[&_svg]:size-5",
                )}
              />
            </TooltipTrigger>
            <TooltipContent>Copy message</TooltipContent>
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
            <TooltipContent>Fork into new thread</TooltipContent>
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
            <TooltipContent>Reply in side chat</TooltipContent>
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
            <TooltipContent>Send to main thread</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
