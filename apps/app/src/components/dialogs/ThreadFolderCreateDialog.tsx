import { useId, useState, type FormEvent, type RefObject } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { normalizeFolderName } from "@/components/sidebar/folderKeys";
import { useNameValidation } from "./useNameValidation.js";
import { useRenameDialogAutoFocus } from "./useRenameDialogAutoFocus.js";

interface ThreadFolderCreateDialogProps {
  errorMessage?: string | null;
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
}

export interface ThreadFolderRenameDialogTarget {
  id: string;
  name: string;
}

interface ThreadFolderRenameDialogProps {
  errorMessage?: string | null;
  target: ThreadFolderRenameDialogTarget | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (id: string, name: string) => void;
}

interface ThreadFolderDialogContentProps {
  description: string;
  errorMessage?: string | null;
  initialName: string;
  inputLabel: string;
  pending: boolean;
  submitLabel: string;
  title: string;
  onSubmit: (name: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function ThreadFolderCreateDialog({
  errorMessage,
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
            errorMessage={errorMessage}
            initialName=""
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
  errorMessage,
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
            key={target.id}
            description="Choose a new name for this folder."
            errorMessage={errorMessage}
            initialName={target.name}
            inputLabel="Folder name"
            pending={pending}
            submitLabel="Rename folder"
            title="Rename folder"
            onSubmit={(name) => onRename(target.id, name)}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ThreadFolderDialogContent({
  description,
  errorMessage,
  initialName,
  inputLabel,
  pending,
  submitLabel,
  title,
  onSubmit,
  inputRef,
}: ThreadFolderDialogContentProps) {
  const inputId = useId();
  const [name, setName] = useState(initialName);
  const [folderNameMessage, setFolderNameMessage] = useState<string | null>(
    null,
  );
  const [hiddenErrorMessage, setHiddenErrorMessage] = useState<string | null>(
    null,
  );
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: "Folder name cannot be empty.",
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedName = validate(name);
    if (trimmedName === null) return;
    const normalizedName = normalizeFolderName(trimmedName);
    if (normalizedName === null) {
      setFolderNameMessage("Folder name cannot be empty.");
      return;
    }

    setHiddenErrorMessage(null);
    onSubmit(normalizedName);
  };
  const displayedServerMessage =
    errorMessage && hiddenErrorMessage !== errorMessage ? errorMessage : null;
  const displayedMessage =
    validationMessage ?? folderNameMessage ?? displayedServerMessage;

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
            value={name}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setName(event.target.value);
              setFolderNameMessage(null);
              setHiddenErrorMessage(errorMessage ?? null);
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
