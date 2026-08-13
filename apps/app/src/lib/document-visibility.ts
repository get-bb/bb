import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  document.addEventListener("visibilitychange", notifyListeners);
  window.addEventListener("pageshow", notifyListeners);
  window.addEventListener("focus", notifyListeners);
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
    typeof document === "undefined" || document.visibilityState === "visible"
  );
}

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeToDocumentVisibility,
    isDocumentVisible,
    isDocumentVisible,
  );
}
