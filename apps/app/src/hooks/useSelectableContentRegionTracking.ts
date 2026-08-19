import { useEffect } from "react";

const SELECTABLE_CONTENT_REGION = "[data-selectable-content-region]";
const SELECTION_CONTROL = [
  "button",
  "select",
  '[role="button"]',
  '[role="checkbox"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="option"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
].join(", ");

function closestElement(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  return target instanceof Node ? target.parentElement : null;
}

function isEditableTarget(target: Element | null): boolean {
  return (
    target?.closest(
      'input, textarea, [contenteditable]:not([contenteditable="false"])',
    ) !== null
  );
}

function isSelectionControlTarget(target: Element | null): boolean {
  const control = target?.closest(SELECTION_CONTROL);
  if (control === null || control === undefined) return false;
  return !control.classList.contains("select-text");
}

function closestContentRegion(target: Element): HTMLElement | null {
  return (
    target.closest<HTMLElement>(SELECTABLE_CONTENT_REGION) ??
    target.closest<HTMLElement>(".select-text")
  );
}

function isSkippedSelectionSubtree(element: Element): boolean {
  return (
    isEditableTarget(element) ||
    isSelectionControlTarget(element) ||
    element.matches('script, style, template, [hidden], [aria-hidden="true"]')
  );
}

function getComposedChildren(node: Node): readonly Node[] {
  if (node instanceof HTMLSlotElement) {
    const assignedNodes = node.assignedNodes({ flatten: true });
    if (assignedNodes.length > 0) return assignedNodes;
  }
  if (node instanceof Element && node.shadowRoot !== null) {
    return Array.from(node.shadowRoot.childNodes);
  }
  return Array.from(node.childNodes);
}

function getComposedTextEndpoints(region: HTMLElement): {
  first: Text;
  last: Text;
} | null {
  let first: Text | null = null;
  let last: Text | null = null;

  function visit(node: Node) {
    if (node instanceof Text) {
      if (node.data.length === 0) return;
      first ??= node;
      last = node;
      return;
    }
    if (
      node !== region &&
      node instanceof Element &&
      isSkippedSelectionSubtree(node)
    ) {
      return;
    }
    for (const child of getComposedChildren(node)) visit(child);
  }

  visit(region);
  return first === null || last === null ? null : { first, last };
}

export function useSelectableContentRegionTracking() {
  useEffect(() => {
    let activeRegion: HTMLElement | null = null;

    function handleSelectAll(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "a" ||
        isEditableTarget(closestElement(event.target)) ||
        isSelectionControlTarget(closestElement(event.target))
      ) {
        return;
      }

      event.preventDefault();
      if (activeRegion === null || !activeRegion.isConnected) {
        return;
      }

      const endpoints = getComposedTextEndpoints(activeRegion);
      const selection = window.getSelection();
      if (endpoints === null || selection === null) return;
      selection.setBaseAndExtent(
        endpoints.first,
        0,
        endpoints.last,
        endpoints.last.data.length,
      );
    }

    function updateActiveRegion(event: Event) {
      const target = closestElement(event.target);
      if (
        target === null ||
        isEditableTarget(target) ||
        isSelectionControlTarget(target)
      ) {
        activeRegion = null;
        return;
      }
      activeRegion = closestContentRegion(target);
    }

    window.addEventListener("pointerdown", updateActiveRegion, true);
    window.addEventListener("focusin", updateActiveRegion, true);
    window.addEventListener("keydown", handleSelectAll);
    return () => {
      window.removeEventListener("pointerdown", updateActiveRegion, true);
      window.removeEventListener("focusin", updateActiveRegion, true);
      window.removeEventListener("keydown", handleSelectAll);
      activeRegion = null;
    };
  }, []);
}

export function SelectableContentRegionTracker() {
  useSelectableContentRegionTracking();
  return null;
}
