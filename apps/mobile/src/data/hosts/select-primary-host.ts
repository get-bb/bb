import type { Host } from "@bb/domain";

/**
 * The host bb defaults work to. The server-resolved `primaryHostId` is
 * authoritative; the connected-first heuristic only covers a null id (fresh
 * server, config still loading). A non-null id missing from the list means
 * the primary is not visible here: return null rather than promote another.
 */
export function selectPrimaryHost(
  hosts: readonly Host[] | undefined,
  primaryHostId: string | null,
): Host | null {
  if (!hosts || hosts.length === 0) return null;
  if (primaryHostId !== null) {
    return hosts.find((host) => host.id === primaryHostId) ?? null;
  }
  return hosts.find((host) => host.status === "connected") ?? hosts[0] ?? null;
}
