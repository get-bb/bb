import {
  createAsyncTtlMemo,
  type AsyncTtlMemo,
} from "../lib/async-ttl-memo.js";
import type {
  ProviderUsage,
  ProviderUsageResponse,
  HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";
import type { SystemUsageLimitsQuery } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../hosts/primary-host.js";
import { listSystemProviderInfos } from "./execution-options.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";
import { mapProviderMaintenanceRequests } from "./provider-maintenance-concurrency.js";

type UsageResult = HostDaemonOnlineRpcResult<"provider.usage">;
const usageCaches = new WeakMap<object, AsyncTtlMemo<string, UsageResult>>();

function providerUsageCache(deps: AppDeps) {
  let cache = usageCaches.get(deps.db);
  if (!cache) {
    cache = createAsyncTtlMemo<string, UsageResult>({
      maxEntries: 1_024,
      ttlMs: (result) =>
        result.supported && result.usage.status === "error" ? 0 : 10_000,
    });
    usageCaches.set(deps.db, cache);
    const hostCache = cache;
    deps.hub.onChangedMessage((message) => {
      if (
        message.entity === "host" &&
        message.changes.some(
          (change) =>
            change === "host-connected" || change === "host-disconnected",
        )
      ) {
        hostCache.invalidateWhere((key) => key.startsWith(`${message.id} `));
      }
    });
  }
  return cache;
}

export async function getProviderUsageLimits(
  deps: AppDeps,
  query: SystemUsageLimitsQuery,
): Promise<ProviderUsageResponse> {
  const hostId = query.hostId ?? requirePrimaryHostId(deps);
  assertUsableHostId(deps, { hostId });
  const providers = await listSystemProviderInfos(deps, {
    hostId,
    capability: "usage",
    onlyProviderId: query.providerId,
  });
  const entries = await mapProviderMaintenanceRequests(
    providers,
    async (provider): Promise<[string, ProviderUsage] | null> => {
      if (!provider.maintenance.usage) return null;
      const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, provider.id);
      if (bridgeLaunch === null) return null;
      try {
        const result = await providerUsageCache(deps).run(
          `${hostId} ${provider.id} ${deps.providerRegistry.getRegistrationRevision()} ${JSON.stringify(bridgeLaunch)}`,
          () =>
            callHostRetryableOnlineRpc(deps, {
              hostId,
              timeoutMs: COMMAND_TIMEOUT_MS,
              command: {
                type: "provider.usage",
                providerId: provider.id,
                bridgeLaunch,
              },
            }),
          query.refresh === "true",
        );
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
    },
  );
  return Object.fromEntries(
    entries.filter((entry): entry is [string, ProviderUsage] => entry !== null),
  );
}
