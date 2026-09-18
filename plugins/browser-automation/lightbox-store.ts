import { useSyncExternalStore } from "react";
import type { PreviewFrame } from "./contracts.js";

export interface LightboxTarget {
  threadId: string;
  sessionId: string;
  frame: PreviewFrame | null;
}

let target: LightboxTarget | null = null;
const listeners = new Set<() => void>();

function publish(next: LightboxTarget | null) {
  target = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openLightbox(next: LightboxTarget): void {
  publish(next);
}

export function closeLightbox(): void {
  if (target !== null) publish(null);
}

export function useLightboxTarget(): LightboxTarget | null {
  return useSyncExternalStore(
    subscribe,
    () => target,
    () => null,
  );
}
