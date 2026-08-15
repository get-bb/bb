import type { HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import {
  buildAcpProviderInfo,
  isAcpProviderId,
} from "../providers/acp-provider-tier.js";
import type { ProviderRegistration } from "../providers/provider-registry.js";
import type { AppDeps } from "../../types.js";

/**
 * The `bridgeLaunch` attach point: present when the thread's provider resolves
 * to a plugin that recorded a built provider-bridge artifact. Every
 * first-party bridge except Pi's now arrives here, so absence means Pi (the
 * one bridge still delivered inside the daemon bundle).
 */
export function resolveBridgeLaunchForProviderId(
  deps: Pick<AppDeps, "providerRegistry" | "providerBridgeArtifacts">,
  providerId: string,
): HostDaemonBridgeLaunch | undefined {
  const registration = resolveBridgeRegistration(deps, providerId);
  if (registration === null) {
    return undefined;
  }
  const artifact = deps.providerBridgeArtifacts.getForPlugin(
    registration.source.pluginId,
  );
  if (artifact === undefined) {
    return undefined;
  }
  // The dynamic ACP tier has no registration to read capabilities from, so it
  // answers from the shared ACP capability set — the same source every other
  // ACP policy accessor on the registry falls back to.
  const capabilities = (
    registration.info.id === providerId
      ? registration.info
      : buildAcpProviderInfo({
          id: providerId,
          displayName: providerId,
          logoUrl: null,
        })
  ).capabilities;
  return {
    source: {
      kind: "artifact",
      sha256: artifact.sha256,
      byteLength: artifact.byteLength,
    },
    // The daemon has no registry: transport the validated declaration's
    // execution capabilities so its adapter accepts the same permission
    // modes and service tier the server already offered to clients.
    capabilities: {
      supportsServiceTier: capabilities.supportsServiceTier,
      supportedPermissionModes: [...capabilities.supportedPermissionModes],
      supportsArchive: capabilities.supportsArchive,
      supportsRename: capabilities.supportsRename,
      supportsFork: capabilities.supportsFork,
    },
  };
}

/**
 * The plugin whose bridge artifact runs this provider id.
 *
 * Normally that is the provider's own registration. ACP is the exception: only
 * the ids bb declares itself (`acp-cursor`) are registered, while known agents
 * and every `customAcpAgents` entry are resolved from launch specs at request
 * time and never registered at all. They all run the same ACP bridge, so a
 * dynamic `acp-*` id borrows the artifact of whichever plugin declares the ACP
 * tier — without which those agents would have no bridge to launch.
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
  return (
    deps.providerRegistry
      .list()
      .find((entry) => isAcpProviderId(entry.info.id)) ?? null
  );
}
