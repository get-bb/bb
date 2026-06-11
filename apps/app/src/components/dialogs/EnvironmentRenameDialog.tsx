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

const ENVIRONMENT_NAME_MAX_LENGTH = 80;

export interface EnvironmentRenameDialogTarget {
  branchName?: string;
  canClearName: boolean;
  id: string;
  currentName: string;
}

interface EnvironmentRenameDialogProps {
  errorMessage?: string | null;
  target: EnvironmentRenameDialogTarget | null;
  pending?: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (environmentId: string, name: string | null) => void;
}

export interface EnvironmentRenameDialogContentProps {
  target: EnvironmentRenameDialogTarget;
  pending: boolean;
  errorMessage?: string | null;
  onRename: (environmentId: string, name: string | null) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function EnvironmentRenameDialog({
  errorMessage,
  target,
  pending = false,
  onOpenChange,
  onRename,
}: EnvironmentRenameDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {target ? (
          <EnvironmentRenameDialogContent
            key={target.id}
            target={target}
            pending={pending}
            errorMessage={errorMessage}
            onRename={onRename}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function EnvironmentRenameDialogContent({
  target,
  pending,
  errorMessage,
  onRename,
  inputRef,
}: EnvironmentRenameDialogContentProps) {
  const inputId = useId();
  const [nextName, setNextName] = useState(target.currentName);
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: "Environment name cannot be empty.",
    maxLength: {
      limit: ENVIRONMENT_NAME_MAX_LENGTH,
      message: `Environment name must be ${ENVIRONMENT_NAME_MAX_LENGTH} characters or fewer.`,
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedName = validate(nextName);
    if (trimmedName === null) return;

    onRename(target.id, trimmedName);
  };
  const displayedErrorMessage = validationMessage ?? errorMessage;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename environment</DialogTitle>
        <DialogDescription>
          Choose a new name for this environment.
        </DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label="Environment name"
            value={nextName}
            placeholder={target.branchName ?? "Environment name"}
            maxLength={ENVIRONMENT_NAME_MAX_LENGTH}
            autoCapitalize="sentences"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
            onChange={(event) => {
              setNextName(event.target.value);
              clearMessage();
            }}
          />
          {displayedErrorMessage ? (
            <p className="text-sm text-destructive">{displayedErrorMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          {target.canClearName ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => {
                onRename(target.id, null);
              }}
            >
              Use branch name
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            Rename environment
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
