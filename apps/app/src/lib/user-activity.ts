import { useSyncExternalStore } from "react";

export const USER_ACTIVITY_WINDOW_MS = 15_000;

const listeners = new Set<() => void>();
let active = false;
let lastInputAt = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function setActive(next: boolean): void {
  if (active === next) return;
  active = next;
  for (const listener of listeners) {
    listener();
  }
}

function checkIdle(): void {
  idleTimer = null;
  const remaining = lastInputAt + USER_ACTIVITY_WINDOW_MS - Date.now();
  if (remaining > 0) {
    idleTimer = setTimeout(checkIdle, remaining);
    return;
  }
  setActive(false);
}

function becomeIdle(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  setActive(false);
}

function recordInput(): void {
  if (document.visibilityState !== "visible") return;
  lastInputAt = Date.now();
  if (idleTimer === null) {
    idleTimer = setTimeout(checkIdle, USER_ACTIVITY_WINDOW_MS);
  }
  setActive(true);
}

function recordFocusedInput(): void {
  if (document.hasFocus()) recordInput();
}

function recordPointerMove(event: PointerEvent): void {
  if (event.movementX === 0 && event.movementY === 0) return;
  recordFocusedInput();
}

function handleBlur(): void {
  setTimeout(() => {
    if (!document.hasFocus()) becomeIdle();
  }, 0);
}

function handleVisibilityChange(): void {
  if (document.visibilityState !== "visible") becomeIdle();
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  const options = { capture: true, passive: true };
  window.addEventListener("keydown", recordInput, options);
  window.addEventListener("pointerdown", recordInput, options);
  window.addEventListener("touchstart", recordInput, options);
  window.addEventListener("wheel", recordFocusedInput, options);
  window.addEventListener("pointermove", recordPointerMove, options);
  window.addEventListener("blur", handleBlur);
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function subscribeToUserActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isUserActive(): boolean {
  return active;
}

export function useUserActive(): boolean {
  return useSyncExternalStore(
    subscribeToUserActivity,
    isUserActive,
    () => false,
  );
}
