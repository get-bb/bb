import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { resolveAcpLaunchSpecForProviderId } from "./acp-launch-spec.js";
import { listSystemProviderInfos } from "./execution-options.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";
import { mapProviderMaintenanceRequests } from "./provider-maintenance-concurrency.js";

/** Aggregate provider-owned installation state in registry order. */
export async function getProviderInstallations(
  deps: AppDeps,
  args: { hostId: string },
): Promise<ProviderCliStatusResponse> {
  const providers = (
    await listSystemProviderInfos(deps, {
      hostId: args.hostId,
    })
  ).filter((provider) => provider.experimental_providerInstallation);
  const entries = await mapProviderMaintenanceRequests(
    providers,
    async (provider) => {
      const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, provider.id);
      if (bridgeLaunch === null) {
        throw new Error(`Provider bridge unavailable for ${provider.id}`);
      }
      const acpLaunchSpec = resolveAcpLaunchSpecForProviderId(
        deps,
        provider.id,
      );
      const status = await callHostRetryableOnlineRpc(deps, {
        hostId: args.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "provider.installation.status",
          providerId: provider.id,
          bridgeLaunch,
          ...(acpLaunchSpec === undefined ? {} : { acpLaunchSpec }),
        },
      });
      return [
        provider.id,
        { displayName: provider.displayName, ...status },
      ] as const;
    },
  );
  return Object.fromEntries(entries);
}
