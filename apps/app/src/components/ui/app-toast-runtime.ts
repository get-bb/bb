import type { toast } from "sonner";

type SonnerToast = typeof toast;

let attachedToast: SonnerToast | null = null;
const pendingCalls: Array<(sonnerToast: SonnerToast) => void> = [];
let toasterRequested = false;
const requestListeners = new Set<() => void>();
let toasterSettled = false;
const settleWaiters: Array<() => void> = [];

function settleToaster(): void {
  toasterSettled = true;
  for (const resolve of settleWaiters.splice(0)) resolve();
}

export function whenToasterSettled(): Promise<void> {
  requestToaster();
  if (toasterSettled) return Promise.resolve();
  return new Promise((resolve) => settleWaiters.push(resolve));
}

export function markToasterUnavailable(): void {
  pendingCalls.length = 0;
  settleToaster();
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

export function withSonnerToast(run: (sonnerToast: SonnerToast) => void): void {
  if (attachedToast !== null) {
    run(attachedToast);
    return;
  }
  pendingCalls.push(run);
  requestToaster();
}

export function attachSonnerToast(sonnerToast: SonnerToast): void {
  attachedToast = sonnerToast;
  for (const run of pendingCalls.splice(0)) run(sonnerToast);
  settleToaster();
}
