import { useSyncExternalStore } from "react";

export type CompactSecondaryPanelPresentation = "closed" | "full";

export const COMPACT_SHELF_HIDDEN_FIXED_CHROME_CLASS =
  "data-[panel-shelf=full]:invisible";

let compactSecondaryPanelPresentation: CompactSecondaryPanelPresentation =
  "closed";
let compactSecondaryPanelSwipeOpening = false;
const listeners = new Set<() => void>();

export function isCompactSecondaryPanelSwipeOpening(): boolean {
  return compactSecondaryPanelSwipeOpening;
}

export function setCompactSecondaryPanelSwipeOpening(opening: boolean): void {
  compactSecondaryPanelSwipeOpening = opening;
}

export function getCompactSecondaryPanelPresentation(): CompactSecondaryPanelPresentation {
  return compactSecondaryPanelPresentation;
}

export function setCompactSecondaryPanelPresentation(
  presentation: CompactSecondaryPanelPresentation,
): void {
  if (compactSecondaryPanelPresentation === presentation) {
    return;
  }
  compactSecondaryPanelPresentation = presentation;
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeCompactSecondaryPanelShelfShowing(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePanelShelfState({
  isCompactViewport,
  isSidebarDrawerOpen,
}: {
  isCompactViewport: boolean;
  isSidebarDrawerOpen: boolean;
}): CompactSecondaryPanelPresentation | undefined {
  const presentation = useSyncExternalStore(
    subscribeCompactSecondaryPanelShelfShowing,
    getCompactSecondaryPanelPresentation,
    () => "closed" as const,
  );
  return isCompactViewport && !isSidebarDrawerOpen ? presentation : undefined;
}
