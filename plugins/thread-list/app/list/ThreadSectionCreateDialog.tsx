import { useId, useState, type FormEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RenameDialog, useNameValidation } from "../ui/RenameDialog.js";

interface ThreadSectionCreateDialogProps {
  errorMessage?: string | null;
  open: boolean;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
}

interface ThreadSectionDialogContentProps {
  errorMessage?: string | null;
  pending: boolean;
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
  return (
    <RenameDialog open={open} onOpenChange={onOpenChange}>
      {(inputRef) =>
        open ? (
          <ThreadSectionDialogContent
            errorMessage={errorMessage}
            pending={pending}
            onSubmit={onCreate}
            inputRef={inputRef}
          />
        ) : null
      }
    </RenameDialog>
  );
}

function ThreadSectionDialogContent({
  errorMessage,
  pending,
  onSubmit,
  inputRef,
}: ThreadSectionDialogContentProps) {
  const inputId = useId();
  const [name, setName] = useState("");
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
        <DialogTitle>New section</DialogTitle>
        <DialogDescription>Create a section for threads.</DialogDescription>
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
            Create section
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
