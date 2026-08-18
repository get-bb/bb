import type { Host } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract/protocol";

export function hostNeedsUpdate(host: Host): boolean {
  return (
    host.status === "disconnected" &&
    host.lastRejectedProtocolVersion !== null &&
    host.lastRejectedProtocolVersion !== HOST_DAEMON_PROTOCOL_VERSION
  );
}

export function hostCanRetryUpdate(host: Host): boolean {
  return (
    hostNeedsUpdate(host) &&
    host.lastRejectedProtocolVersion !== null &&
    host.lastRejectedProtocolVersion < HOST_DAEMON_PROTOCOL_VERSION
  );
}

export function formatHostUpdateStatus(host: Host): string | null {
  if (!hostNeedsUpdate(host)) {
    return null;
  }
  return `Needs update · daemon protocol ${host.lastRejectedProtocolVersion} · server protocol ${HOST_DAEMON_PROTOCOL_VERSION}`;
}
