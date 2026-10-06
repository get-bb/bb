import { isActiveTerminalSessionStatus } from "@bb/domain";
import type { TerminalSession } from "@bb/server-contract";

export function isVisibleTerminalSession(session: TerminalSession): boolean {
  return (
    isActiveTerminalSessionStatus(session.status) ||
    session.status === "disconnected"
  );
}
