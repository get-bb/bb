import type { ReactNode } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";

interface ConfirmDeleteDialogContentProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  /** Renders a Cancel button (left of the destructive action) when provided. */
  onCancel?: () => void;
}

/**
 * Body of a destructive-confirmation dialog: title, description, and a
 * destructive action button with an optional Cancel. Split from the dialog
 * shell so stories can render it without the modal overlay.
 */
export function ConfirmDeleteDialogContent({
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
  onCancel,
}: ConfirmDeleteDialogContentProps) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * Modal shell for a destructive-confirmation dialog. Pair with
 * {@link ConfirmDeleteDialogContent}, rendered only while `open`.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  children,
}: ConfirmDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>{open ? children : null}</DialogContent>
    </Dialog>
  );
}
