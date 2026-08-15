/**
 * Test registries seeded with the first-party providers.
 *
 * Production gets its providers from the four first-party provider plugins;
 * there is no core seed to fall back on. Most server tests need those
 * providers but cannot afford to install and run four plugins, so this helper
 * takes the SAME declarations those plugins register — by invoking their
 * server entrypoints against a capture stub — and pushes them through the same
 * validation and mapping the plugin runtime uses. Nothing is re-stated here,
 * so a declaration change cannot drift from what the tests assume.
 *
 * The plugin modules load by dynamic import rather than a static one: they
 * live outside this package's rootDir, exactly as they do for the real plugin
 * runtime, which also imports them as untyped modules and validates what comes
 * back.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildPluginProviderBridge,
  resolvePluginBuildToolchain,
} from "@bb/plugin-build";
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import type {
  BbPluginApi,
  PluginProviderDeclaration,
} from "@get-bb/plugin-sdk";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";
import {
  createProviderRegistryService,
  type ProviderRegistryService,
} from "../../src/services/providers/provider-registry.js";
import {
  readPluginProviderBridgeArtifact,
  type ProviderBridgeArtifactRegistry,
} from "../../src/services/plugins/provider-bridge-artifacts.js";

const FIRST_PARTY_PROVIDER_PLUGIN_IDS = [
  "provider-codex",
  "provider-claude-code",
  "provider-pi",
  "provider-acp",
] as const;

function pluginRootDir(pluginId: string): string {
  // No trailing slash: the plugin build's directory-escape checks compare
  // against `rootDir + "/"`.
  return fileURLToPath(
    new URL(`../../../../plugins/${pluginId}`, import.meta.url),
  );
}

async function loadDeclaration(
  pluginId: string,
): Promise<PluginProviderDeclaration> {
  const moduleUrl = new URL(
    `../../../../plugins/${pluginId}/server.ts`,
    import.meta.url,
  ).href;
  const loaded: unknown = await import(/* @vite-ignore */ moduleUrl);
  const entry = (loaded as { default?: unknown }).default;
  if (typeof entry !== "function") {
    throw new Error(`${pluginId} has no default plugin export`);
  }
  let captured: PluginProviderDeclaration | undefined;
  const bb = {
    agents: {
      experimental_registerProvider(declaration: PluginProviderDeclaration) {
        captured = declaration;
      },
    },
  } as unknown as BbPluginApi;
  (entry as (bb: BbPluginApi) => void)(bb);
  if (captured === undefined) {
    throw new Error(`${pluginId} registered no provider declaration`);
  }
  // Same narrowing the plugin runtime does: a plugin module is an unknowable
  // boundary, so the declaration is validated before it is trusted.
  return validatePluginProviderDeclaration(captured);
}

/**
 * Registers the four first-party providers into an existing registry, exactly
 * as their plugins would.
 */
export async function registerFirstPartyProviders(
  registry: ProviderRegistryService,
): Promise<void> {
  for (const pluginId of FIRST_PARTY_PROVIDER_PLUGIN_IDS) {
    const declaration = await loadDeclaration(pluginId);
    registry.register({
      ...buildPluginProviderRegistration({ pluginId, declaration }),
      pluginId,
    });
  }
}

/**
 * Builds and records the first-party provider bridge artifacts, exactly as the
 * plugin runtime does on load. Without this a graduated provider has no
 * `bridgeLaunch`, so the daemon has no bridge for it at all — which is the
 * whole point of the artifact route and therefore worth exercising rather
 * than stubbing. Bridges are rebuilt from source so a stale `dist/` cannot
 * make a test pass against yesterday's bridge.
 */
export async function recordFirstPartyProviderBridgeArtifacts(
  artifacts: ProviderBridgeArtifactRegistry,
): Promise<void> {
  const toolchain = await resolvePluginBuildToolchain(
    join(tmpdir(), "bb-plugin-build-toolchain"),
  );
  for (const pluginId of FIRST_PARTY_PROVIDER_PLUGIN_IDS) {
    const rootDir = pluginRootDir(pluginId);
    // Pi has no `bb.providerBridge`: its bridge stays in the daemon bundle.
    if (!(await hasProviderBridgeEntry(rootDir))) {
      continue;
    }
    await buildPluginProviderBridge(rootDir, toolchain);
    const artifact = await readPluginProviderBridgeArtifact(rootDir);
    if (artifact === null) {
      throw new Error(`${pluginId} produced no readable provider bridge`);
    }
    artifacts.set(pluginId, artifact);
  }
}

async function hasProviderBridgeEntry(rootDir: string): Promise<boolean> {
  const raw = await readFile(join(rootDir, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as { bb?: unknown }).bb === "object" &&
    (parsed as { bb: { providerBridge?: unknown } }).bb.providerBridge !==
      undefined
  );
}

/** A registry holding the first-party providers, in product order. */
export async function createTestProviderRegistry(): Promise<ProviderRegistryService> {
  const registry = createProviderRegistryService();
  await registerFirstPartyProviders(registry);
  return registry;
}
