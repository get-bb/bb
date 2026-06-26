import { isActiveTerminalSessionStatus } from "@bb/domain";
import type { TerminalSession } from "@bb/server-contract";

interface RetainedTerminalSessionArgs {
  retainedTerminalId: string | null;
  session: TerminalSession;
}

export function shouldShowRetainedTerminalSession({
  retainedTerminalId,
  session,
}: RetainedTerminalSessionArgs): boolean {
  return (
    isActiveTerminalSessionStatus(session.status) ||
    (session.status === "disconnected" && session.id === retainedTerminalId)
  );
}

export function shouldCloseUnretainedDisconnectedTerminalSession({
  retainedTerminalId,
  session,
}: RetainedTerminalSessionArgs): boolean {
  return session.status === "disconnected" && session.id !== retainedTerminalId;
}
