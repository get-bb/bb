import {
  DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS,
  type HostDaemonBridgeLaunch,
} from "@bb/host-daemon-contract";
import {
  ACP_TIER_CAPABILITIES,
  getAcpProviderServerCapabilities,
  isAcpProviderId,
} from "../providers/acp-provider-tier.js";
import { ApiError } from "../../errors.js";
import type { ProviderRegistration } from "../providers/provider-registry.js";
import type { AppDeps } from "../../types.js";

/**
 * The `bridgeLaunch` every bridge-bound command carries: which bridge to run
 * and the declared capabilities to run it with. Null means this provider id has
 * no bridge on this server at all — an unregistered id (its plugin is
 * disabled, or nothing ever declared it), or a plugin whose artifact has not
 * been recorded yet and which is not one of the daemon-bundled ids. A command
 * built from null would die on the daemon as an unsupported provider, so
 * callers must refuse instead of dispatching.
 */
export function resolveBridgeLaunchForProviderId(
  deps: Pick<AppDeps, "providerRegistry" | "pluginHostArtifacts">,
  providerId: string,
): HostDaemonBridgeLaunch | null {
  const registration = resolveBridgeRegistration(deps, providerId);
  if (registration === null) {
    return null;
  }
  const source = resolveBridgeSource(deps, registration, providerId);
  if (source === null) {
    return null;
  }
  const pluginId = registration.source.pluginId;
  // The dynamic ACP tier has no registration to read capabilities from, so it
  // answers from the shared ACP capability set — the same source every other
  // ACP policy accessor on the registry falls back to.
  const isOwnRegistration = registration.info.id === providerId;
  const {
    supportsServiceTier,
    supportsThreadArchive,
    supportsThreadRename,
    permissionModes,
  } = isOwnRegistration
    ? registration.info.capabilities
    : ACP_TIER_CAPABILITIES;
  const fork = isOwnRegistration
    ? registration.serverCapabilities.fork
    : getAcpProviderServerCapabilities(providerId).fork;
  return {
    pluginId,
    source,
    providerOptions: { ...registration.bridgeOptions },
    // Declared daemon env the bridge may read, forwarded past the daemon's
    // `BB_*` spawn sanitization. The dynamic ACP tier borrows the ACP
    // plugin's declaration along with its artifact.
    envPassthrough: [...registration.envPassthrough],
    // The daemon has no registry: transport the validated declaration's
    // execution capabilities so its adapter accepts the same permission
    // modes and service tier the server already offered to clients. The wire
    // shares the declaration's nouns, so these carry over by name.
    capabilities: {
      experimental_providerInstallation: isOwnRegistration
        ? registration.info.experimental_providerInstallation
        : false,
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
 * Which of the two delivery paths runs this provider's bridge. The plugin's
 * live `bb.host` artifact wins: it is the graduated path, and a plugin that
 * has one is not relying on the daemon bundle. Otherwise the id must be one the daemon bundles
 * (the same rule `assertProviderRegistrable` accepted the declaration under);
 * anything else has no bridge.
 */
function resolveBridgeSource(
  deps: Pick<AppDeps, "pluginHostArtifacts">,
  registration: ProviderRegistration & { source: { kind: "plugin" } },
  providerId: string,
): HostDaemonBridgeLaunch["source"] | null {
  const artifact = deps.pluginHostArtifacts.get(registration.source.pluginId);
  if (artifact !== undefined) {
    return {
      kind: "artifact",
      digest: artifact.digest,
      byteLength: artifact.byteLength,
    };
  }
  return DAEMON_BUNDLED_PROVIDER_BRIDGE_IDS.includes(providerId)
    ? { kind: "daemon-bundled", id: providerId }
    : null;
}

/**
 * Whether the ACP tier has a plugin behind it. User-configured ACP ids are
 * dynamic and run on the bridge of whichever plugin declares the ACP tier.
 * With that plugin disabled or unloaded there is no ACP bridge anywhere, so
 * those agents cannot run and must not be offered.
 */
export function isAcpProviderTierRegistered(
  deps: Pick<AppDeps, "providerRegistry">,
): boolean {
  return findAcpTierRegistration(deps) !== null;
}

/**
 * The plugin whose bridge artifact runs this provider id.
 *
 * Normally that is the provider's own registration. User-configured ACP ids
 * are the exception: they are resolved from config at request time and borrow
 * the artifact of whichever plugin declares the ACP tier. Built-in ACP ids
 * have their own registrations and static bridge options.
 */
function resolveBridgeRegistration(
  deps: Pick<AppDeps, "providerRegistry">,
  providerId: string,
): (ProviderRegistration & { source: { kind: "plugin" } }) | null {
  const registration = deps.providerRegistry.get(providerId);
  if (registration !== null) {
    return registration.source.kind === "plugin" ? registration : null;
  }
  if (!isAcpProviderId(providerId)) {
    return null;
  }
  return findAcpTierRegistration(deps);
}

function findAcpTierRegistration(
  deps: Pick<AppDeps, "providerRegistry">,
): (ProviderRegistration & { source: { kind: "plugin" } }) | null {
  for (const entry of deps.providerRegistry.list()) {
    if (!isAcpProviderId(entry.info.id)) {
      continue;
    }
    if (entry.source.kind === "plugin") {
      return entry;
    }
  }
  return null;
}
