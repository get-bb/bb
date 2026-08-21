import type { RefObject } from "react";
import { RenameDialog, RenameDialogContent } from "./RenameDialog";

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

interface ProjectRenameDialogContentProps {
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
  return (
    <RenameDialog open={target !== null} onOpenChange={onOpenChange}>
      {(inputRef) =>
        target ? (
          <ProjectRenameDialogContent
            key={target.id}
            target={target}
            pending={pending}
            onRename={onRename}
            inputRef={inputRef}
          />
        ) : null
      }
    </RenameDialog>
  );
}

export function ProjectRenameDialogContent({
  target,
  pending,
  onRename,
  inputRef,
}: ProjectRenameDialogContentProps) {
  return (
    <RenameDialogContent
      entityLabel="project"
      initialName={target.currentName}
      pending={pending}
      autoCapitalize="words"
      onRename={(name) => onRename(target.id, name)}
      inputRef={inputRef}
    />
  );
}
