import type { HostDaemonSessionRow } from "@bb/db";
import { hostReconnectGraceMsForMachineProvider } from "./host-reconnect-grace.js";

export function isHostDisconnectHidden(
  latestClosedSession: HostDaemonSessionRow | null,
  now: number,
  machineProviderId?: string | null,
): boolean {
  return (
    latestClosedSession !== null &&
    latestClosedSession.closeReason === "daemon-disconnect" &&
    latestClosedSession.closedAt !== null &&
    latestClosedSession.closedAt +
        hostReconnectGraceMsForMachineProvider(machineProviderId) >
      now
  );
}
