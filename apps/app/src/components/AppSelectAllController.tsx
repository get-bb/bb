import { useEffect } from "react";
import {
  closestEventElement,
  findSelectAllScope,
  preservesNativeSelectAll,
  selectAllScopeContents,
} from "@/lib/select-all-scope";

export function AppSelectAllController() {
  useEffect(() => {
    let activeScope: HTMLElement | null = null;

    function handleSelectAll(event: KeyboardEvent) {
      const target = closestEventElement(event.target);
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "a" ||
        preservesNativeSelectAll(target)
      ) {
        return;
      }

      event.preventDefault();
      if (activeScope !== null && activeScope.isConnected) {
        selectAllScopeContents(activeScope);
      }
    }

    function updateActiveScope(event: Event) {
      const target = closestEventElement(event.target);
      activeScope =
        target === null || preservesNativeSelectAll(target)
          ? null
          : findSelectAllScope(target);
    }

    window.addEventListener("pointerdown", updateActiveScope, true);
    window.addEventListener("focusin", updateActiveScope, true);
    window.addEventListener("keydown", handleSelectAll);
    return () => {
      window.removeEventListener("pointerdown", updateActiveScope, true);
      window.removeEventListener("focusin", updateActiveScope, true);
      window.removeEventListener("keydown", handleSelectAll);
    };
  }, []);

  return null;
}
