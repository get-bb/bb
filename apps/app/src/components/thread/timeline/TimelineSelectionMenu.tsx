import { useCallback, useEffect, useState, type MouseEvent } from "react";
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
  selection,
}: {
  action: SelectionAction;
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

  // Constrain the floating menu to the thread column so it never overlaps the
  // sidebar or secondary panel. The anchor sits inside `[data-thread-window]`,
  // so resolve that ancestor as the Radix collision boundary.
  const [collisionBoundary, setCollisionBoundary] =
    useState<HTMLElement | null>(null);
  const anchorRef = useCallback((node: HTMLDivElement | null) => {
    setCollisionBoundary(
      node?.closest<HTMLElement>("[data-thread-window]") ?? null,
    );
  }, []);

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

  return (
    <PopoverPrimitive.Root
      open
      onOpenChange={(next) => {
        if (!next) onDismiss();
      }}
    >
      {/*
        Zero-size anchor pinned to the pointer release point and gesture side,
        falling back to the selection rect.
      */}
      <PopoverPrimitive.Anchor asChild>
        <div
          ref={anchorRef}
          aria-hidden="true"
          style={{
            position: "fixed",
            left: anchorLeft,
            top: anchorTop,
            width: 0,
            height: 0,
          }}
        />
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side={anchorSide}
          align="center"
          sideOffset={6}
          collisionBoundary={collisionBoundary}
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
              <ActionButton action={action} selection={selection} />
            </div>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
