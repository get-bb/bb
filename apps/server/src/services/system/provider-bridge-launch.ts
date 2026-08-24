import { type HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { ProviderRegistration } from "../providers/provider-registry.js";
import type { AppDeps } from "../../types.js";

/**
 * The `bridgeLaunch` every bridge-bound command carries: which bridge to run
 * and the declared capabilities to run it with. Null means this provider id has
 * no bridge on this server at all — an unregistered id (its plugin is
 * disabled, or nothing ever declared it), or a plugin whose artifact has not
 * been recorded yet. A command
 * built from null would die on the daemon as an unsupported provider, so
 * callers must refuse instead of dispatching.
 */
export function resolveBridgeLaunchForProviderId(
  deps: Pick<AppDeps, "providerRegistry" | "pluginHostArtifacts">,
  providerId: string,
): HostDaemonBridgeLaunch | null {
  const registration = deps.providerRegistry.get(providerId);
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
  return {
    pluginId,
    source,
    providerOptions: { ...registration.bridgeOptions },
    // Declared daemon env the bridge may read, forwarded past the daemon's
    // `BB_*` spawn sanitization.
    envPassthrough: [...registration.envPassthrough],
    // The daemon has no registry: transport the validated declaration's
    // execution capabilities so its adapter accepts the same permission
    // modes and service tier the server already offered to clients. The wire
    // shares the declaration's nouns, so these carry over by name.
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

/**
 * {@link resolveBridgeLaunchForProviderId} for a command that cannot be built
 * without a bridge. Refusing here keeps the failure legible and server-side;
 * before `bridgeLaunch` was required, the command went out without one and the
 * daemon rejected the turn as an unsupported provider.
 */
export function requireBridgeLaunchForProviderId(
  deps: Pick<AppDeps, "providerRegistry" | "pluginHostArtifacts">,
  providerId: string,
): HostDaemonBridgeLaunch {
  const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, providerId);
  if (bridgeLaunch === null) {
    throw new ApiError(
      409,
      "provider_bridge_unavailable",
      `Provider "${providerId}" has no bridge to run on. Its plugin may be disabled or still building.`,
    );
  }
  return bridgeLaunch;
}

/**
 * The bridge that runs this provider: the plugin's live `bb.host` artifact.
 * A plugin whose artifact is still building (or failed to build) has no
 * bridge yet.
 */
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
