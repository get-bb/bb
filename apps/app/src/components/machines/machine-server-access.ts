import type { ServerAccessStatus } from "@bb/server-contract";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";

export const MACHINE_SERVER_ACCESS_TITLE = "Machines cannot reach this bb yet";

export function machineServerAccessReady(
  access: ServerAccessStatus | undefined,
): boolean {
  if (access === undefined) return false;
  const provider = access.providers.find(
    (candidate) => candidate.id === access.defaultProviderId,
  );
  if (provider === undefined) return false;
  if (access.defaultProviderId !== "direct")
    return provider.availability?.status === "available";
  return access.effectiveUrl !== null && !isLocalOnlyUrl(access.effectiveUrl);
}

export const MACHINE_SERVER_ACCESS_UNSET_REASON =
  "Configure how machines should connect to this bb server.";

export function machineServerAccessBlockedReason(
  access: ServerAccessStatus | undefined,
  providerId = access?.defaultProviderId,
): string | null {
  if (access === undefined) return MACHINE_SERVER_ACCESS_UNSET_REASON;
  const selected = {
    ...access,
    defaultProviderId: providerId ?? access.defaultProviderId,
  };
  if (machineServerAccessReady(selected)) return null;
  const availability = access.providers.find(
    (provider) => provider.id === providerId,
  )?.availability;
  return availability && availability.status !== "available"
    ? availability.message
    : MACHINE_SERVER_ACCESS_UNSET_REASON;
}
