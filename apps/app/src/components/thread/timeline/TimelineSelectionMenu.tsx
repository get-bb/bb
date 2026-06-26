import { useEffect, useRef, type MouseEvent } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Icon, type IconName } from "../../ui/icon.js";
import { preventOverlayTriggerSelection } from "../../ui/overlay-trigger.js";
import type { MessageProseSelection } from "./SelectableMessageProse.js";

// Labeled horizontal action button for the floating selection menu. Unlike the
// hover-revealed icon-only `MessageActionBar` buttons, the floating menu IS the
// affordance, so each action shows its label (matching the approved mock).
const SELECTION_ACTION_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-xs text-foreground transition-colors hover:bg-surface-recessed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none";
const SELECTION_MENU_CONTENT_CLASS =
  "z-50 flex w-auto items-center gap-0.5 rounded-md border bg-popover p-0.5 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

interface SelectionAction {
  icon: IconName;
  label: string;
  onSelect: (selection: MessageProseSelection) => void;
}

export interface TimelineSelectionMenuProps {
  selection: MessageProseSelection | null;
  onAddToChat?: (text: string) => void;
  onReplyInSideChat?: (selection: MessageProseSelection) => void;
  onDismiss: () => void;
}

function ActionButton({
  action,
  onDismiss,
  selection,
}: {
  action: SelectionAction;
  onDismiss: () => void;
  selection: MessageProseSelection;
}) {
  return (
    <button
      type="button"
      className={SELECTION_ACTION_BUTTON_CLASS}
      // Keep the text selection alive through the click so the action still
      // receives the selected text (and the menu stays anchored).
      onMouseDown={(event: MouseEvent) => preventOverlayTriggerSelection(event)}
      onClick={() => {
        action.onSelect(selection);
        // Clear the lingering highlight so the source text doesn't read as
        // "still selected" after the quote/side-chat has been created.
        window.getSelection()?.removeAllRanges();
        onDismiss();
      }}
    >
      <Icon
        name={action.icon}
        className="size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      {action.label}
    </button>
  );
}

/**
 * Floating horizontal menu shown near an agent-message text selection. Built as
 * a self-contained component driven by `selection` + callbacks; the timeline
 * controller that supplies them is wired separately.
 */
export function TimelineSelectionMenu({
  selection,
  onAddToChat,
  onReplyInSideChat,
  onDismiss,
}: TimelineSelectionMenuProps) {
  const open = selection !== null;
  const virtualAnchorRef = useRef({
    getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
  });

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
    ...(onAddToChat
      ? [
          {
            icon: "MessageSquarePlus" as const,
            label: "Add to chat",
            onSelect: (currentSelection: MessageProseSelection) =>
              onAddToChat(currentSelection.text),
          },
        ]
      : []),
    ...(onReplyInSideChat
      ? [
          {
            icon: "SideChat" as const,
            label: "Reply in side chat",
            onSelect: onReplyInSideChat,
          },
        ]
      : []),
  ];
  if (actions.length === 0) return null;

  const { anchorPoint, rect } = selection;
  const anchorLeft = anchorPoint?.x ?? rect.left + rect.width / 2;
  const anchorTop = anchorPoint?.y ?? rect.top;
  const anchorSide = selection.anchorSide ?? "top";
  virtualAnchorRef.current.getBoundingClientRect = () =>
    new DOMRect(anchorLeft, anchorTop, 0, 0);

  return (
    <PopoverPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      {/*
        Use a virtual viewport anchor. A real fixed-position anchor can be
        distorted by transformed ancestors in diff/preview panels.
      */}
      <PopoverPrimitive.Anchor virtualRef={virtualAnchorRef} />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={anchorSide}
          align="center"
          sideOffset={6}
          collisionPadding={8}
          className={SELECTION_MENU_CONTENT_CLASS}
          onEscapeKeyDown={() => onDismiss()}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {actions.map((action, index) => (
            <div key={action.label} className="flex items-center">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className="mx-0.5 h-4 w-px bg-border"
                />
              ) : null}
              <ActionButton
                action={action}
                onDismiss={onDismiss}
                selection={selection}
              />
            </div>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
