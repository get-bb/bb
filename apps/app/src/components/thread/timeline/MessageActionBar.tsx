import { CopyButton } from "../../ui/copy-button.js";
import { Icon } from "@/components/ui/icon.js";
import { cn } from "@/lib/utils";

interface MessageActionBarProps {
  messageText: string;
  alignment: "start" | "end";
  onFork?: () => void;
  onSideChat?: () => void;
  disabled?: boolean;
}

// Shared hover-reveal classes for every action in the bar: hidden until the
// surrounding `group` row is hovered or the control is keyboard-focused. The
// fork/side-chat buttons mirror CopyButton's own classes so all three read as
// one consistent affordance.
const ACTION_BUTTON_CLASS =
  "inline-flex size-5 items-center justify-center text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
const HOVER_REVEAL_CLASS =
  "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100";

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
  disabled,
}: MessageActionBarProps) {
  const hasCopy = messageText.length > 0;
  if (!hasCopy && !onFork && !onSideChat) {
    return null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2",
        alignment === "end" ? "justify-end" : "justify-start",
      )}
    >
      {hasCopy ? (
        <CopyButton
          text={messageText}
          label="Copy message"
          className={HOVER_REVEAL_CLASS}
        />
      ) : null}
      {onFork ? (
        <button
          type="button"
          className={cn(ACTION_BUTTON_CLASS, HOVER_REVEAL_CLASS)}
          onClick={onFork}
          disabled={disabled}
          aria-label="Fork into new thread"
          title="Fork into new thread"
        >
          <Icon name="Fork" className="size-3" />
        </button>
      ) : null}
      {onSideChat ? (
        <button
          type="button"
          className={cn(ACTION_BUTTON_CLASS, HOVER_REVEAL_CLASS)}
          onClick={onSideChat}
          disabled={disabled}
          aria-label="Open side chat"
          title="Open side chat"
        >
          <Icon name="SideChat" className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
