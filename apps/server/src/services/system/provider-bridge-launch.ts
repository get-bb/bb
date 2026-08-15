import type { HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";

/**
 * The `bridgeLaunch` attach point: present when the thread's provider is
 * plugin-registered AND its plugin recorded a built provider-bridge artifact.
 * First-party providers are plugin-registered too, so as each one's bridge
 * moves into its plugin directory (graduation wave 5) it starts arriving
 * here; absence still means daemon-local (bundled) bridge resolution for the
 * bridges that have not moved yet.
 */
export function resolveBridgeLaunchForProviderId(
  deps: Pick<AppDeps, "providerRegistry" | "providerBridgeArtifacts">,
  providerId: string,
): HostDaemonBridgeLaunch | undefined {
  const registration = deps.providerRegistry.get(providerId);
  if (registration === null || registration.source.kind !== "plugin") {
    return undefined;
  }
  const artifact = deps.providerBridgeArtifacts.getForPlugin(
    registration.source.pluginId,
  );
  if (artifact === undefined) {
    return undefined;
  }
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
      supportsServiceTier: registration.info.capabilities.supportsServiceTier,
      supportedPermissionModes: [
        ...registration.info.capabilities.supportedPermissionModes,
      ],
      supportsArchive: registration.info.capabilities.supportsArchive,
      supportsRename: registration.info.capabilities.supportsRename,
      supportsFork: registration.info.capabilities.supportsFork,
    },
  };
}
