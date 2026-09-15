import { capitalize } from "@bb/thread-view";
import {
  useCallback,
  useId,
  useRef,
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
  shellClassName?: string;
  children: (inputRef: RefObject<HTMLInputElement | null>) => ReactNode;
}

export function RenameDialog({
  open,
  onOpenChange,
  shellClassName,
  children,
}: RenameDialogProps) {
  const { inputRef, handleOpenAutoFocus: focusInputOnOpen } =
    useRenameDialogAutoFocus();
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const capturedOpenFocusRef = useRef(false);
  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      if (!capturedOpenFocusRef.current) {
        const activeElement = document.activeElement;
        returnFocusRef.current =
          activeElement instanceof HTMLElement &&
          activeElement !== document.body
            ? activeElement
            : null;
        capturedOpenFocusRef.current = true;
      }
      focusInputOnOpen(event);
    },
    [focusInputOnOpen],
  );
  const handleAfterCloseAutoFocus = useCallback(() => {
    const returnFocus = returnFocusRef.current;
    returnFocusRef.current = null;
    capturedOpenFocusRef.current = false;
    if (
      returnFocus?.isConnected &&
      returnFocus.closest('[aria-hidden="true"], [inert]') === null
    ) {
      returnFocus.focus({ preventScroll: true });
    }
  }, []);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={shellClassName}
        onOpenAutoFocus={handleOpenAutoFocus}
        onAfterCloseAutoFocus={handleAfterCloseAutoFocus}
      >
        {children(inputRef)}
      </DialogContent>
    </Dialog>
  );
}

interface RenameDialogContentProps {
  entityLabel: string;
  initialName: string;
  pending: boolean;
  errorMessage?: string | null;
  placeholder?: string;
  inputDetails?: ReactNode;
  maxLength?: { limit: number; message: string };
  autoCapitalize: "words" | "sentences";
  compact?: boolean;
  clearAction?: { label: string; onClear: () => void };
  onRename: (name: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function RenameDialogContent({
  entityLabel,
  initialName,
  pending,
  errorMessage,
  placeholder,
  inputDetails,
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
          {inputDetails}
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
