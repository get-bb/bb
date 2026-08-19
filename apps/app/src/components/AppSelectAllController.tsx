import { useEffect } from "react";
import {
  closestEventElement,
  findSelectAllScope,
  isEditableTarget,
  resolveSelectAllRoot,
  selectAllScopeContents,
} from "@/lib/select-all-scope";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

function getDeepActiveElement(): Element | null {
  let activeElement: Element | null = document.activeElement;
  while (activeElement?.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }
  return activeElement;
}

function selectEditorContents(editor: Element): void {
  if (
    editor instanceof HTMLInputElement ||
    editor instanceof HTMLTextAreaElement
  ) {
    editor.select();
    return;
  }
  document.execCommand("selectAll");
}

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
    let activeSelectionAnchor: Element | null = null;

    function selectActiveScopeOrEditor() {
      if (
        activeScope !== null &&
        activeScope.isConnected &&
        activeSelectionRoot !== null &&
        activeSelectionAnchor !== null
      ) {
        selectAllScopeContents(
          activeScope,
          activeSelectionRoot,
          activeSelectionAnchor,
        );
        return;
      }
      const activeElement = getDeepActiveElement();
      if (activeElement !== null && isEditableTarget(activeElement)) {
        selectEditorContents(activeElement);
      }
    }

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
      selectActiveScopeOrEditor();
    }

    function updateActiveScope(event: Event) {
      const target = closestEventElement(
        event.composedPath()[0] ?? event.target,
      );
      if (target === null || isEditableTarget(target)) {
        activeScope = null;
        activeSelectionRoot = null;
        activeSelectionAnchor = null;
        return;
      }
      activeScope = findSelectAllScope(event.composedPath());
      activeSelectionAnchor = target;
      const selectionRoot = target.getRootNode();
      activeSelectionRoot =
        activeScope !== null &&
        (selectionRoot instanceof Document ||
          selectionRoot instanceof ShadowRoot)
          ? resolveSelectAllRoot(activeScope, selectionRoot)
          : null;
    }

    window.addEventListener("pointerdown", updateActiveScope, true);
    window.addEventListener("focusin", updateActiveScope, true);
    window.addEventListener("keydown", handleSelectAll);
    const unsubscribeDesktopSelectAll = getBbDesktopInfo()?.onSelectAll?.(
      selectActiveScopeOrEditor,
    );
    return () => {
      window.removeEventListener("pointerdown", updateActiveScope, true);
      window.removeEventListener("focusin", updateActiveScope, true);
      window.removeEventListener("keydown", handleSelectAll);
      unsubscribeDesktopSelectAll?.();
    };
  }, []);

  return null;
}
