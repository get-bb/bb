import { useEffect, useId, useRef } from "react";
import { BbHttpError } from "@bb/sdk/browser";
import { cn } from "@bb/shared-ui/lib/utils";
import type { RenameSession, RenameController } from "./SidebarInlineRename";

export function renameError(error: unknown) {
  if (error instanceof BbHttpError) {
    if (error.status === 404 || error.status === 410) {
      return { error: "This item no longer exists.", cannotRetry: true };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        error: "You do not have permission to rename this item.",
        cannotRetry: true,
      };
    }
  }
  return { error: "Could not save the name. Try again.", cannotRetry: false };
}

export default function SidebarRenameEditor({
  session,
  controller,
}: {
  session: RenameSession;
  controller: RenameController;
}) {
  const isPending = Boolean(session.pending);
  const inputRef = useRef<HTMLInputElement>(null);
  const groupRef = useRef<HTMLSpanElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef(false);
  const composingRef = useRef(false);
  const openingRef = useRef(true);
  const errorId = useId();

  useEffect(() => {
    const input = inputRef.current;
    const row = input?.closest("[data-sidebar-rename-row]");
    anchorRef.current =
      row?.querySelector<HTMLElement>("[data-sidebar-rename-anchor]") ?? null;
    const frame = requestAnimationFrame(() => {
      input?.focus({ preventScroll: true });
      input?.select();
      openingRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const restoreFocus = () => {
    const anchor = anchorRef.current;
    requestAnimationFrame(() => {
      if (
        anchor?.isConnected &&
        (document.activeElement === document.body ||
          groupRef.current?.contains(document.activeElement))
      ) {
        anchor.focus({ preventScroll: true });
      }
    });
  };

  const submit = async (restore: boolean) => {
    restoreFocusRef.current = restore;
    const input = inputRef.current;
    input?.setSelectionRange(input.value.length, input.value.length);
    const saved = await controller.save();
    if (saved && restoreFocusRef.current) restoreFocus();
  };

  const cancel = (restore: boolean) => {
    if (isPending) return;
    controller.cancel();
    if (restore) restoreFocus();
  };

  return (
    <span
      ref={groupRef}
      data-sidebar-rename-editor=""
      className="relative z-50 flex min-w-0 flex-1 items-center gap-1"
      aria-busy={isPending}
      onBlur={(event) => {
        if (openingRef.current) return;
        restoreFocusRef.current = false;
        if (!isPending) void submit(false);
      }}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || composingRef.current) return;
        if (event.key === "Escape") {
          event.preventDefault();
          cancel(true);
        } else if (event.key === "Enter" && event.target === inputRef.current) {
          event.preventDefault();
          void submit(true);
        }
      }}
    >
      <input
        ref={inputRef}
        aria-label={session.label}
        aria-invalid={Boolean(session.error)}
        aria-describedby={session.error ? errorId : undefined}
        autoCapitalize="sentences"
        autoCorrect="off"
        className={cn(
          "min-w-0 flex-1 appearance-none border-0 bg-transparent px-0 py-0 [font:inherit] outline-none field-sizing-content",
          isPending && "animate-shine motion-reduce:opacity-60",
        )}
        spellCheck={false}
        value={session.draft}
        placeholder={session.placeholder}
        readOnly={isPending || session.cannotRetry}
        onChange={(event) => controller.change(event.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
      />
      {isPending && (
        <span role="status" aria-label="Saving name" className="sr-only">
          Saving name
        </span>
      )}
      {session.error && (
        <span
          id={errorId}
          role="alert"
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-40 rounded-md border border-border bg-popover px-2 py-1 text-xs text-destructive shadow-md whitespace-normal"
        >
          {session.error}
        </span>
      )}
    </span>
  );
}
