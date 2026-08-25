import type { BottomAnchorContextValue } from "@/components/ui/bottom-anchored-scroll-body";

export const TIMELINE_ROW_FLASH_CLASS_NAME = "bb-search-flash";
const TIMELINE_ROW_FLASH_DURATION_MS = 1700;

export function escapeTimelineRowId(rowId: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(rowId);
  }
  return rowId.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

/** Finds a row already rendered in the main timeline, if any. */
export function findRenderedTimelineRowElement(
  rowId: string,
): HTMLElement | null {
  const selector = `[data-timeline-row-id="${escapeTimelineRowId(rowId)}"]`;
  return document.querySelector<HTMLElement>(selector);
}

/** Briefly highlights a timeline row element so a jump-to-it action is legible. */
export function flashTimelineRowElement(element: HTMLElement): void {
  element.classList.add(TIMELINE_ROW_FLASH_CLASS_NAME);
  window.setTimeout(() => {
    element.classList.remove(TIMELINE_ROW_FLASH_CLASS_NAME);
  }, TIMELINE_ROW_FLASH_DURATION_MS);
}

export function scrollTimelineRowElementIntoView(
  element: HTMLElement,
  bottomAnchor: BottomAnchorContextValue | null,
  options: ScrollIntoViewOptions,
): void {
  if (bottomAnchor !== null) {
    // scrollElementIntoView suppresses stick-to-bottom so this wins over the
    // default open-at-bottom behavior.
    bottomAnchor.scrollElementIntoView({ element, options });
  } else {
    element.scrollIntoView(options);
  }
}

/**
 * Scrolls to and flashes a row already rendered in the main timeline.
 * Returns whether a matching row was found.
 */
export function revealRenderedTimelineRow(
  rowId: string,
  bottomAnchor: BottomAnchorContextValue | null,
): boolean {
  const element = findRenderedTimelineRowElement(rowId);
  if (element === null) {
    return false;
  }
  scrollTimelineRowElementIntoView(element, bottomAnchor, { block: "center" });
  flashTimelineRowElement(element);
  return true;
}
