import { useLayoutEffect, useSyncExternalStore } from "react";

const countKey = Symbol.for("bb.browser-dimming-modal-count.v1");
const changeEvent = "bb:browser-dimming-modal-change";

function changeCount(delta: number): void {
  const owner: Window & { [countKey]?: number } = window;
  owner[countKey] = (owner[countKey] ?? 0) + delta;
  window.dispatchEvent(new Event(changeEvent));
}

function isOpen(): boolean {
  const owner: Window & { [countKey]?: number } = window;
  return (owner[countKey] ?? 0) > 0;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(changeEvent, listener);
  return () => window.removeEventListener(changeEvent, listener);
}

export function useBrowserDimmingModal(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    changeCount(1);
    return () => changeCount(-1);
  }, [active]);
}

export function useIsBrowserDimmingModalOpen(): boolean {
  return useSyncExternalStore(subscribe, isOpen, () => false);
}
