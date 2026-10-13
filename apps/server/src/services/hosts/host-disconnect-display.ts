import type { HostDaemonSessionRow } from "@bb/db";
import { HOST_RECONNECT_GRACE_MS } from "../../constants.js";

export function isHostDisconnectHidden(
  latestClosedSession: HostDaemonSessionRow | null,
  now: number,
): boolean {
  return (
    latestClosedSession !== null &&
    latestClosedSession.closeReason === "daemon-disconnect" &&
    latestClosedSession.closedAt !== null &&
    latestClosedSession.closedAt + HOST_RECONNECT_GRACE_MS > now
  );
}
