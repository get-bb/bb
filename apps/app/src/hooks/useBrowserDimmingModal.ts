import { useEffect, useSyncExternalStore } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";

const browserDimmingModalCountAtom = atom(0);
const pluginPortalSelector = "[data-bb-plugin-root][data-bb-portaled-overlay]";
const pluginDialogSelector = [
  `${pluginPortalSelector}[role="dialog"][data-state="open"]:not([data-side]):not([data-persistent-drawer-content])`,
  `${pluginPortalSelector}[data-persistent-drawer-content][aria-describedby][data-state="open"]`,
  `${pluginPortalSelector}[role="alertdialog"][data-state="open"]`,
].join(", ");
const pluginDialogListeners = new Set<() => void>();
let pluginDialogObserver: MutationObserver | null = null;

function affectsPluginDialog(records: MutationRecord[]): boolean {
  for (const record of records) {
    if (record.type === "attributes") {
      if (
        record.attributeName === "data-bb-plugin-root" ||
        record.attributeName === "data-bb-portaled-overlay" ||
        (record.target instanceof Element &&
          record.target.matches(pluginPortalSelector))
      ) {
        return true;
      }
      continue;
    }
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (
        node instanceof Element &&
        (node.matches(pluginPortalSelector) ||
          node.querySelector(pluginPortalSelector) !== null)
      ) {
        return true;
      }
    }
  }
  return false;
}

function subscribeToPluginDialogs(listener: () => void): () => void {
  pluginDialogListeners.add(listener);
  if (pluginDialogObserver === null && typeof document !== "undefined") {
    pluginDialogObserver = new MutationObserver((records) => {
      if (!affectsPluginDialog(records)) return;
      for (const notify of pluginDialogListeners) notify();
    });
    pluginDialogObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-bb-plugin-root",
        "data-bb-portaled-overlay",
        "data-state",
        "role",
      ],
    });
  }
  return () => {
    pluginDialogListeners.delete(listener);
    if (pluginDialogListeners.size === 0) {
      pluginDialogObserver?.disconnect();
      pluginDialogObserver = null;
    }
  };
}

function isPluginDialogOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.querySelector(pluginDialogSelector) !== null
  );
}

export function useBrowserDimmingOverlay(active: boolean): void {
  const setCount = useSetAtom(browserDimmingModalCountAtom);
  useEffect(() => {
    if (!active) {
      return;
    }
    setCount((count) => count + 1);
    return () => setCount((count) => count - 1);
  }, [active, setCount]);
}

export function useBrowserDimmingModal(active: boolean): void {
  useBrowserDimmingOverlay(active);
}

export function useIsBrowserDimmingModalOpen(): boolean {
  const appDialogOpen = useAtomValue(browserDimmingModalCountAtom) > 0;
  const pluginDialogOpen = useSyncExternalStore(
    subscribeToPluginDialogs,
    isPluginDialogOpen,
    () => false,
  );
  return appDialogOpen || pluginDialogOpen;
}
