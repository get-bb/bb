const PENDING_CLOSE_TTL_MS = 5000;

interface PendingClose {
  threadId: string;
  nextThreadId: string;
  expiresAt: number;
}

let pending: PendingClose | null = null;

export function deferCloseUntilOpen(
  threadId: string,
  nextThreadId: string,
  now: number = Date.now(),
): void {
  pending = { threadId, nextThreadId, expiresAt: now + PENDING_CLOSE_TTL_MS };
}

export function takePendingClose(
  threadId: string,
  activeThreadId: string | null,
  now: number = Date.now(),
): boolean {
  if (pending === null) return false;
  if (pending.expiresAt < now) {
    pending = null;
    return false;
  }
  if (
    pending.threadId !== threadId ||
    pending.nextThreadId !== activeThreadId
  ) {
    return false;
  }
  pending = null;
  return true;
}
