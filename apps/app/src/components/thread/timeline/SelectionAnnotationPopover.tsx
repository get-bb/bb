import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useSoftKeyboardInset } from "@/components/ui/hooks/use-soft-keyboard-inset.js";
import type { MessageProseSelection } from "./SelectableMessageProse.js";

const ANNOTATION_POPOVER_CONTENT_CLASS =
  "z-50 flex w-[min(20rem,calc(100vw-1rem))] flex-col gap-2 rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0";

export interface SelectionAnnotationPopoverProps {
  selection: MessageProseSelection | null;
  locationLabel: string;
  onSubmit: (comment: string) => void;
  onDismiss: () => void;
  /**
   * Portal target. On touch the diff renders inside a vaul modal drawer that
   * `aria-hidden`s everything outside its subtree, so a popover portaled to
   * `<body>` renders but is hidden and non-interactive. Passing the drawer
   * element keeps the popover inside it; the drawer's transform is `none` once
   * settled, so viewport-anchored positioning stays correct.
   */
  portalContainer?: HTMLElement | null;
}

/**
 * Inline comment box shown when a line range is selected. Confirming turns the
 * range + comment into a pending annotation chip in the composer. Anchored via a
 * virtual viewport rect (a real anchor can be distorted by transformed diff
 * ancestors) and lifted above the soft keyboard through collision padding.
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
  const keyboardInset = useSoftKeyboardInset();
  const virtualAnchorRef = useRef({
    getBoundingClientRect: () => new DOMRect(0, 0, 0, 0),
  });

  useEffect(() => {
    if (!open) {
      setComment("");
    }
  }, [open]);

  // Intentionally no scroll-to-dismiss: unlike the transient add-to-chat menu,
  // this is a text box the user types into (and may scroll while doing so). On
  // touch the drag-select's settle-scroll fires right after open, so dismissing
  // on scroll made the box flash and vanish. Escape / click-outside still close.

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
        >
          <p className="truncate text-xs font-medium text-muted-foreground">
            {locationLabel}
          </p>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            enterKeyHint="send"
            placeholder="Add a comment…"
            className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onDismiss()}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-surface-recessed max-md:pointer-coarse:py-1.5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 max-md:pointer-coarse:py-1.5"
            >
              Add to chat
            </button>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
