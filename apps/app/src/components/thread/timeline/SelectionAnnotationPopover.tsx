import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { preventOverlayTriggerSelection } from "@/components/ui/overlay-trigger.js";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse.js";
import { useSoftKeyboardInset } from "@/components/ui/hooks/use-soft-keyboard-inset.js";
import type { MessageProseSelection } from "./SelectableMessageProse.js";

// Mirrors the shared PopoverContent tokens (components/ui/popover.tsx), sized
// for a compact comment box that fits a phone viewport.
const ANNOTATION_POPOVER_CONTENT_CLASS =
  "z-50 flex w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95";

export interface SelectionAnnotationPopoverProps {
  selection: MessageProseSelection | null;
  locationLabel: string;
  onSubmit: (comment: string) => void;
  onDismiss: () => void;
  /**
   * Portal target. On touch the diff renders inside a vaul modal drawer that
   * `aria-hidden`s everything outside its subtree, so a popover portaled to
   * `<body>` renders but is hidden and non-interactive. Passing the drawer
   * element keeps the popover inside it.
   */
  portalContainer?: HTMLElement | null;
}

/**
 * Inline comment box shown when a line range is selected. Confirming turns the
 * range + comment into a pending annotation chip in the composer.
 */
export function SelectionAnnotationPopover({
  selection,
  locationLabel,
  onSubmit,
  onDismiss,
  portalContainer,
}: SelectionAnnotationPopoverProps) {
  const open = selection !== null;
  const [comment, setComment] = useState("");
  const isCoarsePointer = usePointerCoarse();
  const keyboardInset = useSoftKeyboardInset();
  const virtualAnchorRef = useRef({
    getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
  });

  useEffect(() => {
    if (!open) {
      setComment("");
    }
  }, [open]);

  if (!selection) return null;

  const submit = () => {
    onSubmit(comment.trim());
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

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
      <PopoverPrimitive.Anchor virtualRef={virtualAnchorRef} />
      <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
        <PopoverPrimitive.Content
          side={anchorSide}
          align="center"
          sideOffset={6}
          collisionPadding={{
            top: 8,
            left: 8,
            right: 8,
            bottom: 8 + keyboardInset,
          }}
          className={ANNOTATION_POPOVER_CONTENT_CLASS}
          onEscapeKeyDown={() => onDismiss()}
          // On touch, autofocusing the textarea opens the soft keyboard, whose
          // animation reflows this box out from under a finger tap (matching the
          // drawer shell's coarse-pointer guard). Let the user tap to type.
          onOpenAutoFocus={(event) => {
            if (isCoarsePointer) {
              event.preventDefault();
            }
          }}
        >
          <p className="truncate text-xs font-medium text-muted-foreground">
            {locationLabel}
          </p>
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            enterKeyHint="send"
            placeholder="Add a comment…"
            className="min-h-16 text-sm"
          />
          <div className="flex justify-end gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              // mousedown fires before the textarea blurs, so preventing its
              // default keeps focus (and the keyboard) put — the box doesn't
              // reflow and the click lands. Same pattern as TimelineSelectionMenu.
              onMouseDown={preventOverlayTriggerSelection}
              onClick={() => onDismiss()}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onMouseDown={preventOverlayTriggerSelection}
              onClick={submit}
            >
              Add to chat
            </Button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
