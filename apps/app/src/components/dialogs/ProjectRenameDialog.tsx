import { useId, useState, type FormEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useNameValidation } from "./useNameValidation.js";
import { useRenameDialogAutoFocus } from "./useRenameDialogAutoFocus.js";

export interface ProjectRenameDialogTarget {
  id: string;
  currentName: string;
}

interface ProjectRenameDialogProps {
  target: ProjectRenameDialogTarget | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (projectId: string, name: string) => void;
}

export interface ProjectRenameDialogContentProps {
  target: ProjectRenameDialogTarget;
  pending: boolean;
  onRename: (projectId: string, name: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function ProjectRenameDialog({
  target,
  pending = false,
  onOpenChange,
  onRename,
}: ProjectRenameDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {target ? (
          <ProjectRenameDialogContent
            key={target.id}
            target={target}
            pending={pending}
            onRename={onRename}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ProjectRenameDialogContent({
  target,
  pending,
  onRename,
  inputRef,
}: ProjectRenameDialogContentProps) {
  const inputId = useId();
  const [nextName, setNextName] = useState(target.currentName);
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: "Project name cannot be empty.",
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedName = validate(nextName);
    if (trimmedName === null) return;

    onRename(target.id, trimmedName);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename project</DialogTitle>
        <DialogDescription>
          Choose a new name for this project.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label="Project name"
            value={nextName}
            autoCapitalize="words"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setNextName(event.target.value);
              clearMessage();
            }}
          />
          {validationMessage ? (
            <p className="text-sm text-destructive">{validationMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            Rename project
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
