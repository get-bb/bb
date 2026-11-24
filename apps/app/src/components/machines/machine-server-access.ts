import type { ServerAccessStatus } from "@bb/server-contract";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";

export const MACHINE_SERVER_ACCESS_TITLE = "Machines cannot reach this bb yet";

type ServerAccessProvider = ServerAccessStatus["providers"][number];

function providerReachable(provider: ServerAccessProvider): boolean {
  if (provider.availability.status !== "available") return false;
  if (provider.urls.length === 0) return provider.pluginId !== null;
  return provider.urls.some((url) => !isLocalOnlyUrl(url));
}

export function machineServerAccessReady(
  access: ServerAccessStatus | undefined,
): boolean {
  return access !== undefined && access.providers.some(providerReachable);
}

export const MACHINE_SERVER_ACCESS_UNSET_REASON =
  "Configure how machines should connect to this bb server.";

export function machineServerAccessBlockedReason(
  access: ServerAccessStatus | undefined,
): string | null {
  if (access === undefined) return MACHINE_SERVER_ACCESS_UNSET_REASON;
  if (machineServerAccessReady(access)) return null;
  for (const provider of access.providers) {
    if (
      provider.routeKind === "local-network" &&
      provider.availability.status === "setup-required"
    )
      continue;
    if (provider.availability.status !== "available")
      return provider.availability.message;
  }
  return MACHINE_SERVER_ACCESS_UNSET_REASON;
}
