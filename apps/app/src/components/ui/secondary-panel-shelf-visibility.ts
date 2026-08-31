let compactSecondaryPanelShelfShowing = false;
const listeners = new Set<() => void>();

export function isCompactSecondaryPanelShelfShowing(): boolean {
  return compactSecondaryPanelShelfShowing;
}

export function setCompactSecondaryPanelShelfShowing(showing: boolean): void {
  if (compactSecondaryPanelShelfShowing === showing) {
    return;
  }
  compactSecondaryPanelShelfShowing = showing;
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
