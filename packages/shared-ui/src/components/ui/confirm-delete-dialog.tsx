import type { ReactNode } from "react";
import { Button, type ButtonProps } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog";

interface ConfirmDeleteDialogContentProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pending: boolean;
  confirmDisabled?: boolean;
  size?: ButtonProps["size"];
  onConfirm: () => void;
  onCancel?: () => void;
}

export function ConfirmDeleteDialogContent({
  title,
  description,
  confirmLabel,
  pending,
  confirmDisabled = false,
  size,
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
            size={size}
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="button"
          variant="destructive"
          size={size}
          disabled={pending || confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </>
  );
}

interface ConfirmDeleteDialogProps {
  className?: string;
  modal?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function ConfirmDeleteDialog({
  className,
  modal = true,
  open,
  onOpenChange,
  children,
}: ConfirmDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogContent className={className}>
        {open ? children : null}
      </DialogContent>
    </Dialog>
  );
}
