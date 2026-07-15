// OWNER: manage worker (create/edit dialogs + preset management). This file is
// a placeholder created by the app-shell worker (T3.1). Replace its contents
// with the real dialogs; the shell only depends on the exported component
// names and their props.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface NewTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected project, or null when opened from All tasks / Active. */
  projectId: string | null;
}

export function NewTaskDialog({
  open,
  onOpenChange,
  projectId,
}: NewTaskDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>
            Task creation coming soon · projectId={projectId ?? "none"}
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}

export interface NewProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewProjectDialog({ open, onOpenChange }: NewProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Project creation coming soon</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
