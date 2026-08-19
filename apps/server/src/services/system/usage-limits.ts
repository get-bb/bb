import type {
  ProviderUsage,
  ProviderUsageResponse,
} from "@bb/host-daemon-contract";
import type { SystemUsageLimitsQuery } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../hosts/primary-host.js";
import { resolveAcpLaunchSpecForProviderId } from "./acp-launch-spec.js";
import { listSystemProviderInfos } from "./execution-options.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";

/**
 * Reads live subscription usage from every provider bridge that implements
 * provider/usage. The server owns aggregation and host routing; credentials,
 * provider APIs, and normalization stay inside the provider plugin.
 */
export async function getProviderUsageLimits(
  deps: AppDeps,
  query: SystemUsageLimitsQuery,
): Promise<ProviderUsageResponse> {
  const hostId = query.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  const providers = await listSystemProviderInfos(deps, { hostId });
  const entries = await Promise.all(
    providers.map(async (provider): Promise<[string, ProviderUsage] | null> => {
      const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, provider.id);
      if (bridgeLaunch === null) return null;
      const acpLaunchSpec = resolveAcpLaunchSpecForProviderId(
        deps,
        provider.id,
      );
      try {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "provider.usage",
            providerId: provider.id,
            bridgeLaunch,
            ...(acpLaunchSpec === undefined ? {} : { acpLaunchSpec }),
          },
        });
        return result.supported ? [provider.id, result.usage] : null;
      } catch {
        return [
          provider.id,
          {
            status: "error",
            message: "Provider usage could not be loaded.",
            planLabel: null,
            accountEmail: null,
          },
        ];
      }
    }),
  );
  return Object.fromEntries(
    entries.filter((entry): entry is [string, ProviderUsage] => entry !== null),
  );
}
