import { capitalize } from "@bb/thread-view";
import { useId, useState, type FormEvent, type RefObject } from "react";
import { Button } from "@bb/shared-ui/button";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Input } from "@bb/shared-ui/input";
import { useNameValidation } from "@bb/shared-ui/rename-dialog";

interface RenameDialogContentProps {
  entityLabel: string;
  initialName: string;
  pending: boolean;
  autoCapitalize: "words" | "sentences";
  compact?: boolean;
  onRename: (name: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function RenameDialogContent({
  entityLabel,
  initialName,
  pending,
  autoCapitalize,
  compact = false,
  onRename,
  inputRef,
}: RenameDialogContentProps) {
  const inputId = useId();
  const [nextName, setNextName] = useState(initialName);
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: `${capitalize(entityLabel)} name cannot be empty.`,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedName = validate(nextName);
    if (trimmedName === null) return;

    onRename(trimmedName);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename {entityLabel}</DialogTitle>
        <DialogDescription>
          Choose a new name for this {entityLabel}.
        </DialogDescription>
      </DialogHeader>
      <form
        className={compact ? "space-y-3" : "space-y-4"}
        onSubmit={handleSubmit}
      >
        <div className={compact ? "space-y-1.5" : "space-y-2"}>
          <Input
            ref={inputRef}
            id={inputId}
            aria-label={`${capitalize(entityLabel)} name`}
            value={nextName}
            autoCapitalize={autoCapitalize}
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
            Rename {entityLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
