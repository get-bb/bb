import {
  ACCESS_CREDENTIAL_REQUIRES_HTTPS_ERROR_CODE,
  ACCESS_UNAUTHENTICATED_ERROR_CODE,
  APP_SHELL_ACCESS_ELEMENT_ID,
  appShellAccessStateSchema,
} from "@bb/server-contract";
import { useSyncExternalStore } from "react";
import { asHttpError } from "./http-error";

export const PAIR_ROUTE_PATH = "/pair";

export type AccessSignOutReason =
  | typeof ACCESS_UNAUTHENTICATED_ERROR_CODE
  | typeof ACCESS_CREDENTIAL_REQUIRES_HTTPS_ERROR_CODE;

export type AccessState =
  | { signedIn: true }
  | { signedIn: false; reason: AccessSignOutReason };

let state: AccessState = { signedIn: true };
const listeners = new Set<() => void>();

function setAccessState(next: AccessState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getAccessState(): AccessState {
  return state;
}

export type AppShellAccess = "signed-in" | "signed-out" | "unknown";

export function readAccessStateFromAppShell(doc: Document): AppShellAccess {
  const element = doc.getElementById(APP_SHELL_ACCESS_ELEMENT_ID);
  if (element === null) return "unknown";
  element.remove();
  let parsed: ReturnType<typeof appShellAccessStateSchema.safeParse>;
  try {
    parsed = appShellAccessStateSchema.safeParse(
      JSON.parse(element.textContent ?? ""),
    );
  } catch {
    console.warn("bb: ignoring an unreadable access state in the app shell");
    return "unknown";
  }
  if (!parsed.success) return "unknown";
  if (parsed.data.authenticated) return "signed-in";
  setAccessState({
    signedIn: false,
    reason: ACCESS_UNAUTHENTICATED_ERROR_CODE,
  });
  return "signed-out";
}

export function showPairingScreen(): void {
  setAccessState({
    signedIn: false,
    reason: ACCESS_UNAUTHENTICATED_ERROR_CODE,
  });
}

function errorCode(error: unknown): string | null {
  const httpError = asHttpError(error);
  if (httpError === null || httpError.status !== 401) return null;
  return httpError.code ?? null;
}

export function reportAccessError(error: unknown): void {
  const code = errorCode(error);
  if (
    state.signedIn &&
    (code === ACCESS_UNAUTHENTICATED_ERROR_CODE ||
      code === ACCESS_CREDENTIAL_REQUIRES_HTTPS_ERROR_CODE)
  ) {
    setAccessState({ signedIn: false, reason: code });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAccessState(): AccessState {
  return useSyncExternalStore(subscribe, getAccessState, getAccessState);
}
