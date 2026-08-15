import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@bb/shared-ui/lib/utils";

export interface InlineThreadTitleCommitResult {
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
  className?: string;
  value: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function InlineThreadTitleEditor({
  ariaLabel,
  className,
  value,
  onCancel,
  onChange,
  onSubmit,
}: InlineThreadTitleEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }
    input.focus();
    input.select();
  }, []);

  const closeOnce = useCallback((action: () => void) => {
    if (closedRef.current) {
      return;
    }
    closedRef.current = true;
    action();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      closeOnce(onSubmit);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeOnce(onCancel);
    }
  };

  return (
    <input
      ref={inputRef}
      aria-label={ariaLabel}
      autoCapitalize="sentences"
      autoCorrect="off"
      className={cn(
        // px-1 insets the glyphs. Pull the field back by that amount so the
        // text stays on the same origin as the display title. Use ring, not
        // border, so the chrome does not change the line box and can follow
        // the rounded corners.
        "relative z-10 box-border min-w-0 w-[calc(100%+0.5rem)] -mx-1 appearance-none rounded-sm border-0 bg-transparent px-1 py-0 text-sm font-normal leading-[inherit] outline-none ring-1 ring-ring",
        className,
      )}
      spellCheck={false}
      value={value}
      onBlur={() => {
        closeOnce(onSubmit);
      }}
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
  );
}

interface UseInlineThreadTitleArgs {
  inputClassName?: string;
  onCommit: (title: string) => void;
  /** Cancel an open edit when this identity changes (usually the thread id). */
  resetKey: string;
  title: string;
}

interface UseInlineThreadTitleResult {
  editor: ReactNode;
  isEditing: boolean;
  startEditing: () => void;
}

export function useInlineThreadTitle({
  inputClassName,
  onCommit,
  resetKey,
  title,
}: UseInlineThreadTitleArgs): UseInlineThreadTitleResult {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const titleAtStartRef = useRef(title);
  const onCommitAtStartRef = useRef(onCommit);
  const resetKeyRef = useRef(resetKey);

  useEffect(() => {
    if (resetKeyRef.current !== resetKey) {
      resetKeyRef.current = resetKey;
      setIsEditing(false);
      setDraft(title);
      return;
    }
    if (!isEditing) {
      setDraft(title);
    }
  }, [isEditing, resetKey, title]);

  const startEditing = useCallback(() => {
    titleAtStartRef.current = title;
    onCommitAtStartRef.current = onCommit;
    resetKeyRef.current = resetKey;
    setDraft(title);
    setIsEditing(true);
  }, [onCommit, resetKey, title]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setDraft(titleAtStartRef.current);
  }, []);

  const submitEditing = useCallback(() => {
    const result = resolveInlineThreadTitleCommit({
      currentTitle: titleAtStartRef.current,
      nextTitle: draft,
    });
    setIsEditing(false);
    setDraft(titleAtStartRef.current);
    if (result.kind === "commit" && result.title !== undefined) {
      onCommitAtStartRef.current(result.title);
    }
  }, [draft]);

  return {
    editor: isEditing ? (
      <InlineThreadTitleEditor
        ariaLabel="Thread name"
        className={inputClassName}
        value={draft}
        onCancel={cancelEditing}
        onChange={setDraft}
        onSubmit={submitEditing}
      />
    ) : null,
    isEditing,
    startEditing,
  };
}
