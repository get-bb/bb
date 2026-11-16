import { HOST_RECONNECT_GRACE_MS } from "../../constants.js";
import { getMachineProvider } from "../plugins/plugin-machine-provider-registry.js";

export const MAX_HOST_RECONNECT_GRACE_MS = 15 * 60_000;

export function hostReconnectGraceMsForMachineProvider(
  machineProviderId: string | null | undefined,
): number {
  const configured =
    machineProviderId === null || machineProviderId === undefined
      ? undefined
      : getMachineProvider(machineProviderId)?.provider.hostReconnectGraceMs;
  if (configured === undefined || configured === null) {
    return HOST_RECONNECT_GRACE_MS;
  }
  return Math.min(
    MAX_HOST_RECONNECT_GRACE_MS,
    Math.max(HOST_RECONNECT_GRACE_MS, configured),
  );
}
