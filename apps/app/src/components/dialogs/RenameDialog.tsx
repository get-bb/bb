import { capitalize } from "@bb/thread-view";
import {
  useId,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
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

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Extra classes for the modal shell, e.g. the compact thread variant. */
  shellClassName?: string;
  /** Render the entity's rename content, wiring in the autofocus ref. */
  children: (inputRef: RefObject<HTMLInputElement | null>) => ReactNode;
}

/**
 * Modal shell shared by the entity rename dialogs. Owns the autofocus
 * behavior and hands the input ref to the content via a render prop.
 */
export function RenameDialog({
  open,
  onOpenChange,
  shellClassName,
  children,
}: RenameDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={shellClassName}
        onOpenAutoFocus={handleOpenAutoFocus}
      >
        {children(inputRef)}
      </DialogContent>
    </Dialog>
  );
}

interface RenameDialogContentProps {
  /** Lowercase noun ("project", "thread", …) used in the title and copy. */
  entityLabel: string;
  initialName: string;
  pending: boolean;
  /** Server-side error, shown when there is no validation message. */
  errorMessage?: string | null;
  placeholder?: string;
  /** Length cap; also sets the input's `maxLength` attribute. */
  maxLength?: { limit: number; message: string };
  autoCapitalize: "words" | "sentences";
  /** Tighter spacing for the compact thread variant. */
  compact?: boolean;
  /** Renders a secondary button (left of submit) when provided. */
  clearAction?: { label: string; onClear: () => void };
  onRename: (name: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Body of an entity rename dialog: header copy, validated name input, and
 * submit button, all derived from `entityLabel`. Split from the shell so
 * stories can render it without the modal overlay.
 */
export function RenameDialogContent({
  entityLabel,
  initialName,
  pending,
  errorMessage,
  placeholder,
  maxLength,
  autoCapitalize,
  compact = false,
  clearAction,
  onRename,
  inputRef,
}: RenameDialogContentProps) {
  const inputId = useId();
  const [nextName, setNextName] = useState(initialName);
  const { validationMessage, validate, clearMessage } = useNameValidation({
    emptyMessage: `${capitalize(entityLabel)} name cannot be empty.`,
    maxLength,
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedName = validate(nextName);
    if (trimmedName === null) return;

    onRename(trimmedName);
  };
  const displayedErrorMessage = validationMessage ?? errorMessage;

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
            placeholder={placeholder}
            maxLength={maxLength?.limit}
            autoCapitalize={autoCapitalize}
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
          {clearAction ? (
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={clearAction.onClear}
            >
              {clearAction.label}
            </Button>
          ) : null}
          <Button type="submit" disabled={pending}>
            Rename {entityLabel}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
