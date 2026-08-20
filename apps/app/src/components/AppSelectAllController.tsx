import { useEffect } from "react";
import {
  clearSelectAllHighlight,
  closestEventElement,
  findSelectAllScope,
  getSelectAllCopyText,
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
    interface CopyOverride {
      anchorNode: Node | null;
      anchorOffset: number;
      focusNode: Node | null;
      focusOffset: number;
      text: string;
      selectionKind: "native" | "logical";
    }

    let activeScope: HTMLElement | null = null;
    let activePreferredRoot: Document | ShadowRoot | null = null;
    let activeSelectionAnchor: Element | null = null;
    let copyOverride: CopyOverride | null = null;

    function selectionMatchesCopyOverride(override: CopyOverride): boolean {
      const selection = window.getSelection();
      return (
        override.selectionKind === "logical" ||
        (selection !== null &&
          selection.anchorNode === override.anchorNode &&
          selection.anchorOffset === override.anchorOffset &&
          selection.focusNode === override.focusNode &&
          selection.focusOffset === override.focusOffset)
      );
    }

    function captureCopyOverride(
      text: string | null,
      selectionKind: "native" | "logical" | null,
    ): void {
      const selection = window.getSelection();
      copyOverride =
        text !== null && selection !== null && selectionKind !== null
          ? {
              anchorNode: selection.anchorNode,
              anchorOffset: selection.anchorOffset,
              focusNode: selection.focusNode,
              focusOffset: selection.focusOffset,
              text,
              selectionKind,
            }
          : null;
    }

    function selectActiveScopeOrEditor(): boolean {
      copyOverride = null;
      clearSelectAllHighlight();
      const activeElement = getDeepActiveElement();
      if (activeElement instanceof HTMLIFrameElement) {
        return false;
      }
      if (activeElement !== null && isEditableTarget(activeElement)) {
        selectEditorContents(activeElement);
        return true;
      }
      if (
        activeScope !== null &&
        activeScope.isConnected &&
        activePreferredRoot !== null &&
        activeSelectionAnchor !== null &&
        activeSelectionAnchor.isConnected
      ) {
        const selectionRoot = resolveSelectAllRoot(
          activeScope,
          activePreferredRoot,
        );
        const selectedScope = selectAllScopeContents(
          activeScope,
          selectionRoot,
          activeSelectionAnchor,
        );
        const registeredCopyText = getSelectAllCopyText(activeScope);
        captureCopyOverride(
          selectedScope === null
            ? null
            : (registeredCopyText ?? selectedScope.fallbackCopyText),
          selectedScope?.kind ?? null,
        );
      }
      return true;
    }

    function handleCopy(event: ClipboardEvent) {
      const override = copyOverride;
      if (
        override === null ||
        !selectionMatchesCopyOverride(override) ||
        event.clipboardData === null
      ) {
        return;
      }
      event.clipboardData.setData("text/plain", override.text);
      event.preventDefault();
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
      if (event.repeat) return;
      selectActiveScopeOrEditor();
    }

    function updateActiveScope(event: Event) {
      copyOverride = null;
      clearSelectAllHighlight();
      const target = closestEventElement(
        event.composedPath()[0] ?? event.target,
      );
      if (target === null || isEditableTarget(target)) {
        activeScope = null;
        activePreferredRoot = null;
        activeSelectionAnchor = null;
        return;
      }
      activeScope = findSelectAllScope(event.composedPath());
      activeSelectionAnchor = target;
      const selectionRoot = target.getRootNode();
      activePreferredRoot =
        activeScope !== null &&
        (selectionRoot instanceof Document ||
          selectionRoot instanceof ShadowRoot)
          ? selectionRoot
          : null;
    }

    window.addEventListener("pointerdown", updateActiveScope, true);
    window.addEventListener("focusin", updateActiveScope, true);
    // Select All is a platform-reserved chord. Capture prevents descendant
    // controls that stop keydown propagation from falling back to document-wide
    // native selection; editable targets still return to native handling above.
    window.addEventListener("keydown", handleSelectAll, true);
    document.addEventListener("copy", handleCopy, true);
    const unsubscribeDesktopSelectAll = getBbDesktopInfo()?.onSelectAll?.(
      selectActiveScopeOrEditor,
    );
    return () => {
      window.removeEventListener("pointerdown", updateActiveScope, true);
      window.removeEventListener("focusin", updateActiveScope, true);
      window.removeEventListener("keydown", handleSelectAll, true);
      document.removeEventListener("copy", handleCopy, true);
      unsubscribeDesktopSelectAll?.();
      clearSelectAllHighlight();
    };
  }, []);

  return null;
}
