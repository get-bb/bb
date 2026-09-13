import { getHost } from "@bb/db";
import { resolveExecutionProvider } from "../hosts/execution-integration.js";
import { type HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { ProviderRegistration } from "../providers/provider-registry.js";
import type { AppDeps } from "../../types.js";

export function resolveBridgeLaunchForProviderId(
  deps: Pick<AppDeps, "db" | "providerRegistry" | "pluginHostArtifacts">,
  providerId: string,
  hostId?: string,
): HostDaemonBridgeLaunch | null {
  const registration = resolveExecutionProvider(deps, providerId, hostId);
  if (registration === null) {
    return null;
  }
  const source = resolveBridgeSource(deps, registration);
  if (source === null) {
    return null;
  }
  const pluginId = registration.pluginId;
  const {
    supportsServiceTier,
    supportsThreadArchive,
    supportsThreadRename,
    permissionModes,
  } = registration.info.capabilities;
  const fork = registration.serverCapabilities.fork;
  const integrationId =
    hostId === undefined
      ? null
      : (getHost(deps.db, hostId)?.executionIntegration?.id ?? null);
  return {
    pluginId,
    ...(integrationId === null
      ? {}
      : { executionIntegrationId: integrationId }),
    source,
    providerOptions: { ...registration.bridgeOptions },
    envPassthrough: [...registration.envPassthrough],
    capabilities: {
      providerInstallation: registration.info.maintenance.installation,
      supportsServiceTier,
      supportsThreadArchive,
      supportsThreadRename,
      permissionModes: [...permissionModes],
      fork,
    },
  };
}

export function requireBridgeLaunchForProviderId(
  deps: Pick<AppDeps, "db" | "providerRegistry" | "pluginHostArtifacts">,
  providerId: string,
  hostId?: string,
): HostDaemonBridgeLaunch {
  const bridgeLaunch = resolveBridgeLaunchForProviderId(
    deps,
    providerId,
    hostId,
  );
  if (bridgeLaunch === null) {
    const binding =
      hostId === undefined
        ? null
        : getHost(deps.db, hostId)?.executionIntegration;
    if (binding != null) {
      throw new ApiError(
        409,
        "execution_integration_unavailable",
        `Required execution integration "${binding.displayName}" (${binding.id}) has no available bridge`,
      );
    }
    throw new ApiError(
      409,
      "provider_bridge_unavailable",
      `Provider "${providerId}" has no bridge to run on. Its plugin may be disabled or still building.`,
    );
  }
  return bridgeLaunch;
}

function resolveBridgeSource(
  deps: Pick<AppDeps, "pluginHostArtifacts">,
  registration: ProviderRegistration,
): HostDaemonBridgeLaunch["source"] | null {
  const artifact = deps.pluginHostArtifacts.get(registration.pluginId);
  if (artifact === undefined) {
    return null;
  }
  return {
    kind: "artifact",
    digest: artifact.digest,
    byteLength: artifact.byteLength,
  };
}
