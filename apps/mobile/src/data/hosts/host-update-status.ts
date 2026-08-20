import type { Host } from "@bb/domain";

/**
 * Daemon self-update state derived from the host row (mirror of
 * apps/app/src/lib/host-update-status.ts). Unlike the web app, which ships
 * with its server, the phone learns the server's protocol version at runtime
 * (`useServerProtocolVersion`, `GET /install/version`) and never compares
 * against the constant compiled into this build. The server sets
 * `lastRejectedProtocolVersion` only when it refused the daemon's session and
 * clears it on the next successful open, so a non-null value on its own means
 * "rejected by this server".
 */
export function hostNeedsUpdate(host: Host): boolean {
  return (
    host.status === "disconnected" && host.lastRejectedProtocolVersion !== null
  );
}

/**
 * A retry only helps an older daemon; a newer one must wait for the server.
 * Unknown server version (null): hide the action rather than offer one the
 * server may answer with 409 — the server enforces the real rule either way.
 */
export function hostCanRetryUpdate(
  host: Host,
  serverProtocolVersion: number | null,
): boolean {
  return (
    hostNeedsUpdate(host) &&
    host.lastRejectedProtocolVersion !== null &&
    serverProtocolVersion !== null &&
    host.lastRejectedProtocolVersion < serverProtocolVersion
  );
}

/** Null when the host is not stranded; the server number only once known. */
export function formatHostUpdateStatus(
  host: Host,
  serverProtocolVersion: number | null,
): string | null {
  if (!hostNeedsUpdate(host)) return null;
  const daemon = `Needs update · daemon protocol ${host.lastRejectedProtocolVersion}`;
  return serverProtocolVersion === null
    ? daemon
    : `${daemon} · server protocol ${serverProtocolVersion}`;
}
