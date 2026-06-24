import { capitalize } from "@bb/thread-view";
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
import { useNameValidation } from "./useNameValidation.js";
import { useRenameDialogAutoFocus } from "./useRenameDialogAutoFocus.js";

export const THREAD_RENAME_DIALOG_SHELL_CLASS =
  "max-w-[24rem] sm:gap-3 sm:p-5";

export interface ThreadRenameDialogTarget {
  id: string;
  currentTitle: string;
}

export interface ThreadRenameDialogPayload {
  title: string;
}

interface ThreadRenameDialogProps {
  target: ThreadRenameDialogTarget | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (threadId: string, payload: ThreadRenameDialogPayload) => void;
}

export function ThreadRenameDialog({
  target,
  pending = false,
  onOpenChange,
  onRename,
}: ThreadRenameDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className={THREAD_RENAME_DIALOG_SHELL_CLASS}
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        {target ? (
          <ThreadRenameDialogContent
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

export interface ThreadRenameDialogContentProps {
  target: ThreadRenameDialogTarget;
  pending: boolean;
  onRename: (threadId: string, payload: ThreadRenameDialogPayload) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function ThreadRenameDialogContent({
  target,
  pending,
  onRename,
  inputRef,
}: ThreadRenameDialogContentProps) {
  const inputId = useId();
  const [nextTitle, setNextTitle] = useState(target.currentTitle);
  const label = "thread";
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: `${capitalize(label)} name cannot be empty.`,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedTitle = validate(nextTitle);
    if (trimmedTitle === null) return;

    onRename(target.id, { title: trimmedTitle });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename {label}</DialogTitle>
        <DialogDescription>
          Choose a new name for this {label}.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-3" onSubmit={handleSubmit}>
        <div className="space-y-1.5">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label={`${capitalize(label)} name`}
            value={nextTitle}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setNextTitle(event.target.value);
              clearMessage();
            }}
          />
          {validationMessage ? (
            <p className="text-sm text-destructive">{validationMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            Rename {label}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
