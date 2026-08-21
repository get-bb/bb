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
import { useNameValidation } from "./useNameValidation.js";
import { useRenameDialogAutoFocus } from "./useRenameDialogAutoFocus.js";

interface ThreadSectionCreateDialogProps {
  errorMessage?: string | null;
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
}

export interface ThreadSectionRenameDialogTarget {
  id: string;
  name: string;
}

interface ThreadSectionRenameDialogProps {
  errorMessage?: string | null;
  target: ThreadSectionRenameDialogTarget | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (id: string, name: string) => void;
}

interface ThreadSectionDialogContentProps {
  description: string;
  errorMessage?: string | null;
  initialName: string;
  pending: boolean;
  submitLabel: string;
  title: string;
  onSubmit: (name: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function ThreadSectionCreateDialog({
  errorMessage,
  open,
  pending = false,
  onOpenChange,
  onCreate,
}: ThreadSectionCreateDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {open ? (
          <ThreadSectionDialogContent
            description="Create a section for threads."
            errorMessage={errorMessage}
            initialName=""
            pending={pending}
            submitLabel="Create section"
            title="New section"
            onSubmit={onCreate}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function ThreadSectionRenameDialog({
  errorMessage,
  target,
  pending = false,
  onOpenChange,
  onRename,
}: ThreadSectionRenameDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {target ? (
          <ThreadSectionDialogContent
            key={target.id}
            description="Choose a new name for this section."
            errorMessage={errorMessage}
            initialName={target.name}
            pending={pending}
            submitLabel="Rename section"
            title="Rename section"
            onSubmit={(name) => onRename(target.id, name)}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ThreadSectionDialogContent({
  description,
  errorMessage,
  initialName,
  pending,
  submitLabel,
  title,
  onSubmit,
  inputRef,
}: ThreadSectionDialogContentProps) {
  const inputId = useId();
  const [name, setName] = useState(initialName);
  const [hiddenErrorMessage, setHiddenErrorMessage] = useState<string | null>(
    null,
  );
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: "Section name cannot be empty.",
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedName = validate(name);
    if (trimmedName === null) return;

    setHiddenErrorMessage(null);
    onSubmit(trimmedName);
  };
  const displayedServerMessage =
    errorMessage && hiddenErrorMessage !== errorMessage ? errorMessage : null;
  const displayedMessage = validationMessage ?? displayedServerMessage;

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
            aria-label="Section name"
            value={name}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setName(event.target.value);
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
