import { useCallback, useRef } from "react";
import { usePointerCoarse } from "@/components/ui/hooks/use-pointer-coarse.js";

export interface RenameDialogAutoFocus {
  /** Attach to the rename `Input`. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** Pass to `DialogContent`'s `onOpenAutoFocus`. */
  handleOpenAutoFocus: (event: Event) => void;
}

/**
 * Radix focuses the dialog content container on open, which overrides the
 * `autoFocus` attribute on a child input. Prevent that default and focus the
 * rename input ourselves, selecting its prefilled text so typing replaces it.
 */
export function useRenameDialogAutoFocus(): RenameDialogAutoFocus {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isPointerCoarse = usePointerCoarse();
  const handleOpenAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      if (isPointerCoarse) return;

      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    },
    [isPointerCoarse],
  );
  return { inputRef, handleOpenAutoFocus };
}
