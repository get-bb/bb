import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
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
  const providers = await listSystemProviderInfos(deps, {
    hostId: args.hostId,
    capability: "installation",
  });
  const entries = await mapProviderMaintenanceRequests(
    providers,
    async (provider): Promise<[string, ProviderCliStatus] | null> => {
      const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, provider.id);
      if (bridgeLaunch === null) {
        deps.logger.warn(
          {
            failure: "bridge_unavailable",
            hostId: args.hostId,
            providerId: provider.id,
          },
          "Failed to load provider installation status; omitting provider",
        );
        return null;
      }
      const acpLaunchSpec = resolveAcpLaunchSpecForProviderId(
        deps,
        provider.id,
      );
      try {
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
        ];
      } catch {
        deps.logger.warn(
          {
            failure: "status_request_failed",
            hostId: args.hostId,
            providerId: provider.id,
          },
          "Failed to load provider installation status; omitting provider",
        );
        return null;
      }
    },
  );
  return Object.fromEntries(
    entries.filter(
      (entry): entry is [string, ProviderCliStatus] => entry !== null,
    ),
  );
}
