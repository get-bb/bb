import type { HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";

/**
 * The `bridgeLaunch` attach point (the version-123 wire field): present only
 * when the thread's provider is plugin-registered AND its plugin recorded a
 * built provider-bridge artifact. First-party takeover registrations record
 * no artifact, so their commands stay wire-identical to version 122 —
 * absence means daemon-local (bundled) bridge resolution.
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
  };
}
