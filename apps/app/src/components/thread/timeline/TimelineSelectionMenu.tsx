import { useEffect, type MouseEvent } from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "../../ui/icon.js";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../../ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../ui/tooltip.js";
import { preventOverlayTriggerSelection } from "../../ui/overlay-trigger.js";
import type { MessageProseSelection } from "./SelectableMessageProse.js";

// Compact icon button matching the timeline hover-action affordance, but
// always visible while the menu is open (the floating menu is the affordance,
// so its buttons are not hover-revealed).
const SELECTION_ACTION_BUTTON_CLASS =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-recessed hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none";

interface SelectionAction {
  icon: IconName;
  label: string;
  onSelect: (text: string) => void;
}

export interface TimelineSelectionMenuProps {
  selection: MessageProseSelection | null;
  onAddToChat: (text: string) => void;
  onReplyInSideChat: (text: string) => void;
  onDismiss: () => void;
}

function ActionButton({
  action,
  text,
}: {
  action: SelectionAction;
  text: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={action.label}
          className={SELECTION_ACTION_BUTTON_CLASS}
          // Keep the text selection alive through the click so the action
          // still receives the selected text (and the menu stays anchored).
          onMouseDown={(event: MouseEvent) =>
            preventOverlayTriggerSelection(event)
          }
          onClick={() => action.onSelect(text)}
        >
          <Icon name={action.icon} className="size-4" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Floating horizontal menu shown above an agent-message text selection. Built
 * as a self-contained component driven by `selection` + callbacks; the
 * timeline controller that supplies them is wired separately.
 */
export function TimelineSelectionMenu({
  selection,
  onAddToChat,
  onReplyInSideChat,
  onDismiss,
}: TimelineSelectionMenuProps) {
  const open = selection !== null;

  // Dismiss on scroll/resize rather than re-anchoring: the captured rect goes
  // stale the moment the viewport moves, so closing is the honest behavior.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const dismiss = () => onDismiss();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [open, onDismiss]);

  if (!selection) return null;

  const actions: SelectionAction[] = [
    { icon: "MessageSquarePlus", label: "Add to chat", onSelect: onAddToChat },
    {
      icon: "MessageSquare",
      label: "Reply in side chat",
      onSelect: onReplyInSideChat,
    },
  ];

  const { rect, text } = selection;

  return (
    <Popover
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      {/* Zero-size anchor pinned to the selection rect (viewport coords). */}
      <PopoverAnchor asChild>
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            left: rect.left + rect.width / 2,
            top: rect.top,
            width: 0,
            height: 0,
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={6}
        mobileTitle="Selection actions"
        // Tight, horizontal, content-width row — override the default
        // wide popover padding/width.
        className={cn(
          "flex w-auto items-center gap-0.5 rounded-md border bg-popover p-1 shadow-md",
        )}
        mobileClassName="flex items-center justify-center gap-2"
        onEscapeKeyDown={() => onDismiss()}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <TooltipProvider delayDuration={300}>
          {actions.map((action) => (
            <ActionButton key={action.label} action={action} text={text} />
          ))}
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
