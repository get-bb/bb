import { useEffect, useSyncExternalStore } from "react";
import type { TerminalSession } from "@bb/server-contract";
import { getBbDesktopInfo } from "@/lib/bb-desktop";

type TerminalSessionStatus = TerminalSession["status"];

const ACTIVE_TERMINAL_SESSION_STATUSES: ReadonlySet<TerminalSessionStatus> =
  new Set(["running", "disconnected"]);

export function isActiveTerminalSessionForCloseGuard(
  status: TerminalSessionStatus,
): boolean {
  return ACTIVE_TERMINAL_SESSION_STATUSES.has(status);
}

const activeSessionCounts = new Map<string, number>();
const listeners = new Set<() => void>();
let activeSessionCount = 0;

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setTerminalSessionActive(
  sessionId: string,
  active: boolean,
): void {
  const previousCount = activeSessionCounts.get(sessionId) ?? 0;
  if (active) {
    activeSessionCounts.set(sessionId, previousCount + 1);
    activeSessionCount += 1;
  } else if (previousCount > 0) {
    if (previousCount === 1) {
      activeSessionCounts.delete(sessionId);
    } else {
      activeSessionCounts.set(sessionId, previousCount - 1);
    }
    activeSessionCount -= 1;
  } else {
    return;
  }
  notifyListeners();
}

export function hasActiveTerminalSession(): boolean {
  return activeSessionCount > 0;
}

function subscribeToActiveTerminalSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHasActiveTerminalSession(): boolean {
  return useSyncExternalStore(
    subscribeToActiveTerminalSessions,
    hasActiveTerminalSession,
    hasActiveTerminalSession,
  );
}

export function useRegisterActiveTerminalSession(
  session: TerminalSession | null,
): void {
  const sessionId = session?.id ?? null;
  const sessionStatus = session?.status ?? null;
  useEffect(() => {
    if (
      sessionId === null ||
      sessionStatus === null ||
      !isActiveTerminalSessionForCloseGuard(sessionStatus)
    ) {
      return;
    }
    setTerminalSessionActive(sessionId, true);
    return () => {
      setTerminalSessionActive(sessionId, false);
    };
  }, [sessionId, sessionStatus]);
}

export function useBeforeUnloadGuard(): void {
  const hasActiveTerminal = useHasActiveTerminalSession();
  const isBrowser = getBbDesktopInfo() === null;
  const shouldGuard = hasActiveTerminal && isBrowser;

  useEffect(() => {
    if (!shouldGuard) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "true";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [shouldGuard]);
}

export function resetTerminalCloseGuardForTest(): void {
  activeSessionCounts.clear();
  activeSessionCount = 0;
  notifyListeners();
}
