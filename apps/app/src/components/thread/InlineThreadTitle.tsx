import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";

const SAVE_ERROR_MESSAGE = "Could not save the name. Try again.";

interface InlineThreadTitleCommitResult {
  kind: "cancel" | "commit";
  title?: string;
}

export function resolveInlineThreadTitleCommit(args: {
  currentTitle: string;
  nextTitle: string;
}): InlineThreadTitleCommitResult {
  const title = args.nextTitle.trim();
  if (title.length === 0 || title === args.currentTitle) {
    return { kind: "cancel" };
  }
  return { kind: "commit", title };
}

interface InlineThreadTitleEditorProps {
  ariaLabel: string;
  error: string | null;
  isSaving: boolean;
  value: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

function InlineThreadTitleEditor({
  ariaLabel,
  error,
  isSaving,
  value,
  onCancel,
  onChange,
  onSubmit,
}: InlineThreadTitleEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <span className="relative inline-flex min-w-0 max-w-full">
      <input
        ref={inputRef}
        aria-label={ariaLabel}
        aria-busy={isSaving}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        autoCapitalize="sentences"
        autoCorrect="off"
        className={cn(
          "relative z-10 min-w-0 max-w-full appearance-none border-0 bg-transparent px-0 py-0 [font:inherit] outline-none field-sizing-content",
          isSaving && "animate-shine motion-reduce:opacity-60",
        )}
        readOnly={isSaving}
        spellCheck={false}
        value={value}
        onBlur={onSubmit}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
      />
      {isSaving ? (
        <span role="status" aria-label="Saving name" className="sr-only">
          Saving name
        </span>
      ) : null}
      {error === null ? null : (
        <span
          id={errorId}
          role="alert"
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-40 rounded-md border border-border bg-popover px-2 py-1 text-xs text-destructive shadow-md whitespace-normal"
        >
          {error}
        </span>
      )}
    </span>
  );
}

interface UseInlineThreadTitleArgs {
  onCommit: (title: string) => Promise<void>;
  resetKey: string;
  title: string;
}

interface UseInlineThreadTitleResult {
  editor: ReactNode;
  isEditing: boolean;
  startEditing: () => void;
}

export function useInlineThreadTitle({
  onCommit,
  resetKey,
  title,
}: UseInlineThreadTitleArgs): UseInlineThreadTitleResult {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(title);
  const titleAtStartRef = useRef(title);
  const onCommitAtStartRef = useRef(onCommit);
  const resetKeyRef = useRef(resetKey);
  const sessionRef = useRef(0);
  const closedRef = useRef(true);
  const savingRef = useRef(false);

  const close = useCallback(() => {
    sessionRef.current += 1;
    closedRef.current = true;
    savingRef.current = false;
    setIsEditing(false);
    setIsSaving(false);
    setError(null);
    setDraft(titleAtStartRef.current);
  }, []);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      titleAtStartRef.current = title;
      close();
      return;
    }
    if (!isEditing) {
      setDraft(title);
    }
  }, [close, isEditing, resetKey, title]);

  const startEditing = useCallback(() => {
    sessionRef.current += 1;
    closedRef.current = false;
    savingRef.current = false;
    titleAtStartRef.current = title;
    onCommitAtStartRef.current = onCommit;
    resetKeyRef.current = resetKey;
    setDraft(title);
    setError(null);
    setIsSaving(false);
    setIsEditing(true);
  }, [onCommit, resetKey, title]);

  const cancelEditing = useCallback(() => {
    if (closedRef.current || savingRef.current) {
      return;
    }
    close();
  }, [close]);

  const changeDraft = useCallback((value: string) => {
    if (savingRef.current) {
      return;
    }
    setDraft(value);
    setError(null);
  }, []);

  const submitEditing = useCallback(() => {
    if (closedRef.current || savingRef.current) {
      return;
    }
    const result = resolveInlineThreadTitleCommit({
      currentTitle: titleAtStartRef.current,
      nextTitle: draft,
    });
    if (result.kind !== "commit" || result.title === undefined) {
      close();
      return;
    }
    const session = sessionRef.current;
    savingRef.current = true;
    setIsSaving(true);
    setError(null);
    onCommitAtStartRef.current(result.title).then(
      () => {
        if (sessionRef.current === session) {
          close();
        }
      },
      () => {
        if (sessionRef.current !== session) {
          return;
        }
        savingRef.current = false;
        setIsSaving(false);
        setError(SAVE_ERROR_MESSAGE);
      },
    );
  }, [close, draft]);

  return {
    editor: isEditing ? (
      <InlineThreadTitleEditor
        ariaLabel="Thread name"
        error={error}
        isSaving={isSaving}
        value={draft}
        onCancel={cancelEditing}
        onChange={changeDraft}
        onSubmit={submitEditing}
      />
    ) : null,
    isEditing,
    startEditing,
  };
}
