type BrowserChromeRevealListener = (isHeld: boolean) => void;

const listenersByTabId = new Map<string, Set<BrowserChromeRevealListener>>();
const heldTabIds = new Set<string>();

export function setBrowserChromeRevealHeld(
  tabId: string,
  isHeld: boolean,
): void {
  if (isHeld === heldTabIds.has(tabId)) {
    return;
  }
  if (isHeld) {
    heldTabIds.add(tabId);
  } else {
    heldTabIds.delete(tabId);
  }
  for (const listener of listenersByTabId.get(tabId) ?? []) {
    listener(isHeld);
  }
}

export function subscribeBrowserChromeReveal(
  tabId: string,
  listener: BrowserChromeRevealListener,
): () => void {
  const listeners = listenersByTabId.get(tabId) ?? new Set();
  listeners.add(listener);
  listenersByTabId.set(tabId, listeners);
  listener(heldTabIds.has(tabId));

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByTabId.delete(tabId);
    }
  };
}
