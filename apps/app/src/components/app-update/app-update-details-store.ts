import type { SystemAppUpdateResult } from "@bb/server-contract";

type Listener = () => void;

let openResult: SystemAppUpdateResult | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function openAppUpdateResultDetails(
  result: SystemAppUpdateResult,
): void {
  openResult = result;
  emit();
}

export function closeAppUpdateResultDetails(): void {
  openResult = null;
  emit();
}

export function subscribeAppUpdateResultDetails(
  listener: Listener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAppUpdateResultDetailsSnapshot(): SystemAppUpdateResult | null {
  return openResult;
}
