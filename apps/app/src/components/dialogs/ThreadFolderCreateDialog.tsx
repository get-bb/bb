import { useId, useState, type FormEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { normalizeFolderPath } from "@/components/sidebar/folderPath";
import { useNameValidation } from "./useNameValidation.js";
import { useRenameDialogAutoFocus } from "./useRenameDialogAutoFocus.js";

interface ThreadFolderCreateDialogProps {
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (path: string) => void;
}

export interface ThreadFolderRenameDialogTarget {
  path: string;
}

interface ThreadFolderRenameDialogProps {
  target: ThreadFolderRenameDialogTarget | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (path: string, newPath: string) => void;
}

interface ThreadFolderDialogContentProps {
  description: string;
  initialPath: string;
  inputLabel: string;
  pending: boolean;
  submitLabel: string;
  title: string;
  onSubmit: (path: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function ThreadFolderCreateDialog({
  open,
  pending = false,
  onOpenChange,
  onCreate,
}: ThreadFolderCreateDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {open ? (
          <ThreadFolderDialogContent
            description="Create a folder for threads."
            initialPath=""
            inputLabel="Folder name"
            pending={pending}
            submitLabel="Create folder"
            title="New folder"
            onSubmit={onCreate}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ThreadFolderRenameDialog({
  target,
  pending = false,
  onOpenChange,
  onRename,
}: ThreadFolderRenameDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {target ? (
          <ThreadFolderDialogContent
            key={target.path}
            description="Choose a new path for this folder."
            initialPath={target.path}
            inputLabel="Folder path"
            pending={pending}
            submitLabel="Rename folder"
            title="Rename folder"
            onSubmit={(newPath) => onRename(target.path, newPath)}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ThreadFolderDialogContent({
  description,
  initialPath,
  inputLabel,
  pending,
  submitLabel,
  title,
  onSubmit,
  inputRef,
}: ThreadFolderDialogContentProps) {
  const inputId = useId();
  const [path, setPath] = useState(initialPath);
  const [folderPathMessage, setFolderPathMessage] = useState<string | null>(
    null,
  );
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: "Folder name cannot be empty.",
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedPath = validate(path);
    if (trimmedPath === null) return;
    const normalizedPath = normalizeFolderPath(trimmedPath);
    if (normalizedPath === null) {
      setFolderPathMessage("Folder name cannot be empty.");
      return;
    }

    onSubmit(normalizedPath);
  };
  const displayedMessage = validationMessage ?? folderPathMessage;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label={inputLabel}
            value={path}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setPath(event.target.value);
              setFolderPathMessage(null);
              clearMessage();
            }}
          />
          {displayedMessage ? (
            <p className="text-sm text-destructive">{displayedMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
