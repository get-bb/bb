import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPluginHost, resolvePluginBuildToolchain } from "@bb/plugin-build";
import { ensurePluginProcessDataDir } from "@bb/process-utils";
import type { NormalizedPluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  captureFirstPartyProviderDeclarations,
  firstPartyPluginRootDir,
  type CaptureFirstPartyProviderDeclarationsOptions,
} from "./first-party-provider-declarations.js";
import {
  INTEGRATION_PROVIDER_BRIDGE_MANIFEST_PATH,
  type IntegrationProviderBridgeManifest,
} from "./integration-provider-bridges.js";

const PROVIDER_BRIDGE_PLUGIN_IDS = [
  "provider-codex",
  "provider-claude-code",
  "provider-acp",
  "provider-pi",
  "provider-rapp",
] as const;

function declarationSettings(
  pluginId: string,
): CaptureFirstPartyProviderDeclarationsOptions {
  return pluginId === "provider-rapp"
    ? { settings: { endpoint: "", grail: "business" } }
    : {};
}

function integrationProviderOptions(
  pluginId: string,
  declaration: NormalizedPluginProviderDeclaration,
): IntegrationProviderBridgeManifest[string]["providerOptions"] {
  const bridgeOptions = declaration.experimental_bridgeOptions ?? {};
  if (pluginId !== "provider-rapp") {
    return bridgeOptions;
  }
  const defaultModel = (declaration.models.fallback ?? []).find(
    (model) => model.isDefault,
  );
  if (defaultModel === undefined) {
    throw new Error(
      "provider-rapp integration declaration has no default model",
    );
  }
  return { ...bridgeOptions, model: defaultModel.id };
}

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
      captureFirstPartyProviderDeclarations(
        pluginId,
        declarationSettings(pluginId),
      ),
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
          artifactPath: build.jsPath,
        },
        providerOptions: integrationProviderOptions(pluginId, declaration),
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
