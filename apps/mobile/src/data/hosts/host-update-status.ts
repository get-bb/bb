import type { Host } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract/protocol";

/**
 * Daemon self-update state derived from the host row (mirror of
 * apps/app/src/lib/host-update-status.ts). The protocol version compiled
 * into this app stands in for the server's: the two ship together on the
 * web, and on the phone the server still enforces the real rule (the retry
 * route answers 409 when no update is pending).
 */
export function hostNeedsUpdate(host: Host): boolean {
  return (
    host.status === "disconnected" &&
    host.lastRejectedProtocolVersion !== null &&
    host.lastRejectedProtocolVersion !== HOST_DAEMON_PROTOCOL_VERSION
  );
}

/** A retry only helps an older daemon; a newer one must wait for the server. */
export function hostCanRetryUpdate(host: Host): boolean {
  return (
    hostNeedsUpdate(host) &&
    host.lastRejectedProtocolVersion !== null &&
    host.lastRejectedProtocolVersion < HOST_DAEMON_PROTOCOL_VERSION
  );
}

export function formatHostUpdateStatus(host: Host): string | null {
  if (!hostNeedsUpdate(host)) return null;
  return `Needs update · daemon protocol ${host.lastRejectedProtocolVersion} · server protocol ${HOST_DAEMON_PROTOCOL_VERSION}`;
}
