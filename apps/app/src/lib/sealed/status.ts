import { useSyncExternalStore } from "react";
import type { SealedConnection, SealedState } from "./connection";

let active: SealedConnection | null = null;
let readableReason: string | null = null;
const listeners = new Set<() => void>();
let unsubscribeActive: (() => void) | null = null;

function notify(): void {
  for (const listener of [...listeners]) listener();
}

export function setActiveSealedConnection(
  connection: SealedConnection | null,
): void {
  unsubscribeActive?.();
  unsubscribeActive = null;
  active = connection;
  if (connection !== null) unsubscribeActive = connection.subscribe(notify);
  notify();
}

export function getActiveSealedConnection(): SealedConnection | null {
  return active;
}

export function setReadableConnectionReason(reason: string | null): void {
  readableReason = reason;
  notify();
}

export function useReadableConnectionReason(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => readableReason,
    () => null,
  );
}

const IDLE: SealedState = { kind: "idle" };

export function useSealedState(): SealedState | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => (active === null ? null : active.getState()),
    () => (active === null ? null : IDLE),
  );
}
