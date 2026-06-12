import { useEffect } from "react";

export interface UseEscapeToHideArgs {
  enabled: boolean;
  isEmpty: () => boolean;
  onHide: () => void;
}

export function useEscapeToHide({
  enabled,
  isEmpty,
  onHide,
}: UseEscapeToHideArgs): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape" || event.defaultPrevented || !isEmpty()) {
        return;
      }
      event.preventDefault();
      onHide();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, isEmpty, onHide]);
}
