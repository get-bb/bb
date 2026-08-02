type BrowserChromeRevealListener = () => void;

const listenersByTabId = new Map<string, Set<BrowserChromeRevealListener>>();

export function requestBrowserChromeReveal(tabId: string): void {
  for (const listener of listenersByTabId.get(tabId) ?? []) {
    listener();
  }
}

export function subscribeBrowserChromeReveal(
  tabId: string,
  listener: BrowserChromeRevealListener,
): () => void {
  const listeners = listenersByTabId.get(tabId) ?? new Set();
  listeners.add(listener);
  listenersByTabId.set(tabId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByTabId.delete(tabId);
    }
  };
}
