/**
 * Global setup for the live-CLI integration suite: build the first-party
 * provider bridges from source and record them where the harness can find
 * them (see `integration-provider-bridges.ts`).
 *
 * This is the same work the plugin runtime does on load — build the bundle,
 * hash it, record it — done once per run so every test file shares one build.
 * Bridges are rebuilt rather than reused from `dist/` so a stale artifact
 * cannot make a live test pass against yesterday's bridge.
 */
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPluginHost, resolvePluginBuildToolchain } from "@bb/plugin-build";
import { ensurePluginProcessDataDir } from "@bb/process-utils";
import type { NormalizedPluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  captureFirstPartyProviderDeclarations,
  firstPartyPluginRootDir,
} from "./first-party-provider-declarations.js";
import {
  INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH,
  type IntegrationProviderBridgeManifest,
} from "./integration-provider-bridges.js";

/**
 * Every first-party provider plugin; each ships its bridge as a `bb.host`
 * artifact.
 */
const PROVIDER_BRIDGE_PLUGIN_IDS = [
  "provider-codex",
  "provider-claude-code",
  "provider-acp",
  "provider-pi",
] as const;

/**
 * The same five execution capabilities the server puts on the wire (see
 * resolveBridgeLaunchForProviderId): the daemon has no registry to read a
 * declaration from.
 */
function wireCapabilities(
  declaration: NormalizedPluginProviderDeclaration,
): IntegrationProviderBridgeManifest[string]["capabilities"] {
  const { capabilities } = declaration;
  return {
    providerInstallation: declaration.maintenance?.installation ?? false,
    supportsServiceTier: capabilities.supportsServiceTier,
    permissionModes: [...capabilities.permissionModes],
    supportsThreadArchive: capabilities.supportsThreadArchive,
    supportsThreadRename: capabilities.supportsThreadRename,
    fork: capabilities.fork,
  };
}

export async function setup(): Promise<void> {
  const bridgeDataRoot = join(tmpdir(), "bb-agent-runtime-integration-daemon");
  const toolchain = await resolvePluginBuildToolchain(
    join(tmpdir(), "bb-plugin-build-toolchain"),
  );
  const manifest: IntegrationProviderBridgeManifest = {};
  for (const pluginId of PROVIDER_BRIDGE_PLUGIN_IDS) {
    const rootDir = firstPartyPluginRootDir(pluginId);
    const [declarations, build] = await Promise.all([
      captureFirstPartyProviderDeclarations(pluginId),
      buildPluginHost(rootDir, "0.0.0-integration", toolchain),
    ]);
    const dataDir = await ensurePluginProcessDataDir({
      daemonDataDir: bridgeDataRoot,
      pluginId,
      kind: "bridge-data",
    });
    for (const declaration of declarations) {
      manifest[declaration.id] = {
        pluginId,
        dataDir,
        source: {
          kind: "artifact",
          digest: build.artifactDigest,
          // No download step here: the daemon caches the verified bytes, the
          // test launches the freshly built file in place.
          artifactPath: build.jsPath,
        },
        providerOptions: declaration.experimental_bridgeOptions ?? {},
        envPassthrough: [...(declaration.env?.passthrough ?? [])],
        capabilities: wireCapabilities(declaration),
      };
    }
  }
  await writeFile(
    INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH,
    JSON.stringify(manifest, null, 2),
  );
}
