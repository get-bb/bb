import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Button } from "@/components/ui/button.js";
import { Textarea } from "@/components/ui/textarea.js";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse.js";
import { useSoftKeyboardInset } from "@/components/ui/hooks/use-soft-keyboard-inset.js";
import { createPortal } from "react-dom";
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

interface AnnotationCommentFormProps {
  locationLabel: string;
  comment: string;
  onCommentChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  autoFocus: boolean;
}

function AnnotationCommentForm({
  locationLabel,
  comment,
  onCommentChange,
  onSubmit,
  onCancel,
  autoFocus,
}: AnnotationCommentFormProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) {
      textareaRef.current?.focus();
    }
  }, [autoFocus]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  };

  return (
    <>
      <p className="truncate text-xs font-medium text-muted-foreground">
        {locationLabel}
      </p>
      <Textarea
        ref={textareaRef}
        value={comment}
        onChange={(event) => onCommentChange(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={2}
        enterKeyHint="send"
        placeholder="Add a comment…"
        className="min-h-16 text-sm"
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={onSubmit}>
          Add to chat
        </Button>
      </div>
    </>
  );
}

/**
 * Inline comment box shown when a line range is selected. Confirming turns the
 * range + comment into a pending annotation chip in the composer.
 *
 * On touch it renders as a bottom sheet that tracks the soft keyboard as a
 * single unit: anchoring a floating popover over the keyboard is fragile —
 * autofocus opens the keyboard, which reflows the box out from under a finger
 * tap. Desktop keeps the anchored popover.
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

  const form = (
    <AnnotationCommentForm
      locationLabel={locationLabel}
      comment={comment}
      onCommentChange={setComment}
      onSubmit={submit}
      onCancel={onDismiss}
      autoFocus
    />
  );

  if (isCoarsePointer) {
    // Stable bottom sheet, lifted above the keyboard by its inset. Portaled into
    // the drawer so it isn't aria-hidden; the drawer's bottom is the screen
    // bottom, so `fixed` positioning here sits just above the keyboard.
    const sheet = (
      <div
        className="fixed inset-x-0 z-50 flex flex-col gap-2 border-t border-border bg-popover p-3 text-popover-foreground shadow-md"
        style={{ bottom: keyboardInset }}
      >
        {form}
      </div>
    );
    return createPortal(sheet, portalContainer ?? document.body);
  }

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
          collisionPadding={8}
          className={ANNOTATION_POPOVER_CONTENT_CLASS}
          onEscapeKeyDown={() => onDismiss()}
        >
          {form}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
