import { useEffect } from "react";

const SELECTABLE_CONTENT_REGION = "[data-selectable-content-region]";
const ACTIVE_ATTRIBUTE = "data-selection-active";
const MANAGED_TAB_INDEX_ATTRIBUTE = "data-selection-managed-tab-index";
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

export function useSelectableContentRegionTracking() {
  useEffect(() => {
    let activeRegion: HTMLElement | null = null;

    function handleRegionKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "a" ||
        isEditableTarget(closestElement(event.target)) ||
        isSelectionControlTarget(closestElement(event.target)) ||
        activeRegion === null
      ) {
        return;
      }

      event.preventDefault();
      const selection = window.getSelection();
      if (selection === null) return;
      const range = document.createRange();
      range.selectNodeContents(activeRegion);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function setActiveRegion(region: HTMLElement | null, focusRegion = false) {
      if (activeRegion === region) {
        if (
          focusRegion &&
          region !== null &&
          !region.contains(document.activeElement)
        ) {
          region.focus({ preventScroll: true });
        }
        return;
      }

      if (activeRegion !== null) {
        activeRegion.removeEventListener("keydown", handleRegionKeyDown);
        activeRegion.removeAttribute(ACTIVE_ATTRIBUTE);
        if (activeRegion.hasAttribute(MANAGED_TAB_INDEX_ATTRIBUTE)) {
          activeRegion.removeAttribute(MANAGED_TAB_INDEX_ATTRIBUTE);
          activeRegion.removeAttribute("tabindex");
        }
      }

      activeRegion = region;
      if (activeRegion === null) return;

      activeRegion.setAttribute(ACTIVE_ATTRIBUTE, "");
      if (!activeRegion.hasAttribute("tabindex")) {
        activeRegion.tabIndex = -1;
        activeRegion.setAttribute(MANAGED_TAB_INDEX_ATTRIBUTE, "");
      }
      activeRegion.addEventListener("keydown", handleRegionKeyDown);
      if (focusRegion) {
        activeRegion.focus({ preventScroll: true });
      }
    }

    function updateActiveRegion(event: Event) {
      const target = closestElement(event.target);
      if (
        target === null ||
        isEditableTarget(target) ||
        isSelectionControlTarget(target)
      ) {
        setActiveRegion(null);
        return;
      }
      setActiveRegion(
        closestContentRegion(target),
        event.type === "pointerdown",
      );
    }

    window.addEventListener("pointerdown", updateActiveRegion, true);
    window.addEventListener("focusin", updateActiveRegion, true);
    return () => {
      window.removeEventListener("pointerdown", updateActiveRegion, true);
      window.removeEventListener("focusin", updateActiveRegion, true);
      setActiveRegion(null);
    };
  }, []);
}
