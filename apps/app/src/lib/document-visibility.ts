import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let revision = 0;

function notifyListeners(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

if (globalThis.document !== undefined && globalThis.window !== undefined) {
  globalThis.document.addEventListener("visibilitychange", notifyListeners);
  globalThis.window.addEventListener("pageshow", notifyListeners);
  globalThis.window.addEventListener("focus", notifyListeners);
}

export function subscribeToDocumentVisibility(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isDocumentVisible(): boolean {
  return (
    globalThis.document === undefined ||
    globalThis.document.visibilityState === "visible"
  );
}

export function useDocumentVisibilityRevision(): number {
  return useSyncExternalStore(
    subscribeToDocumentVisibility,
    () => revision,
    () => revision,
  );
}
