import type { toast } from "sonner";

type SonnerToast = typeof toast;

let attachedToast: SonnerToast | null = null;
const pendingCalls: Array<{
  id: string | number | null;
  run: (sonnerToast: SonnerToast) => void;
}> = [];
let toasterRequested = false;
const requestListeners = new Set<() => void>();
export function markToasterUnavailable(): void {
  pendingCalls.length = 0;
}

export function requestToaster(): void {
  if (toasterRequested) return;
  toasterRequested = true;
  for (const listener of requestListeners) listener();
}

export function subscribeToasterRequest(listener: () => void): () => void {
  requestListeners.add(listener);
  return () => requestListeners.delete(listener);
}

export function isToasterRequested(): boolean {
  return toasterRequested;
}

export function withSonnerToast(
  run: (sonnerToast: SonnerToast) => void,
  id: string | number | null = null,
): void {
  if (attachedToast !== null) {
    run(attachedToast);
    return;
  }
  pendingCalls.push({ id, run });
  requestToaster();
}

export function dismissSonnerToast(id?: string | number): void {
  for (let index = pendingCalls.length - 1; index >= 0; index -= 1) {
    if (id === undefined || pendingCalls[index]?.id === id) {
      pendingCalls.splice(index, 1);
    }
  }
  attachedToast?.dismiss(id);
}

export function attachSonnerToast(sonnerToast: SonnerToast): void {
  attachedToast = sonnerToast;
  for (const { run } of pendingCalls.splice(0)) run(sonnerToast);
}

let compactPlacementOverride: boolean | null = null;
const placementListeners = new Set<() => void>();

export function setToasterCompactPlacement(isCompact: boolean | null): void {
  if (compactPlacementOverride === isCompact) return;
  compactPlacementOverride = isCompact;
  for (const listener of placementListeners) listener();
}

export function subscribeToasterCompactPlacement(
  listener: () => void,
): () => void {
  placementListeners.add(listener);
  return () => placementListeners.delete(listener);
}

export function getToasterCompactPlacement(): boolean | null {
  return compactPlacementOverride;
}
