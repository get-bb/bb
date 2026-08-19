import { useEffect } from "react";
import {
  applyOpenShadowSelectionPolicy,
  closestEventElement,
  findSelectAllScope,
  isEditableTarget,
  selectAllScopeContents,
} from "@/lib/select-all-scope";

function isSelectAllKey(event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === "a" ||
    (event.code === "KeyA" && !/^[a-z]$/i.test(event.key))
  );
}

export function AppSelectAllController() {
  useEffect(() => {
    let activeScope: HTMLElement | null = null;
    let activeSelectionRoot: Document | ShadowRoot | null = null;

    function handleSelectAll(event: KeyboardEvent) {
      const target = closestEventElement(
        event.composedPath()[0] ?? event.target,
      );
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        !isSelectAllKey(event) ||
        isEditableTarget(target)
      ) {
        return;
      }

      event.preventDefault();
      if (
        activeScope !== null &&
        activeScope.isConnected &&
        activeSelectionRoot !== null
      ) {
        selectAllScopeContents(activeScope, activeSelectionRoot);
      }
    }

    function updateActiveScope(event: Event) {
      const target = closestEventElement(
        event.composedPath()[0] ?? event.target,
      );
      if (target === null || isEditableTarget(target)) {
        activeScope = null;
        activeSelectionRoot = null;
        return;
      }
      activeScope = findSelectAllScope(event.composedPath());
      const selectionRoot = target.getRootNode();
      activeSelectionRoot =
        selectionRoot instanceof Document || selectionRoot instanceof ShadowRoot
          ? selectionRoot
          : null;
      if (activeScope !== null && selectionRoot instanceof ShadowRoot) {
        applyOpenShadowSelectionPolicy(selectionRoot);
      }
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
