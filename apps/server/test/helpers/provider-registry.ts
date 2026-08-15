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
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import type { BbPluginApi, PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";
import {
  createProviderRegistryService,
  type ProviderRegistryService,
} from "../../src/services/providers/provider-registry.js";

const FIRST_PARTY_PROVIDER_PLUGIN_IDS = [
  "provider-codex",
  "provider-claude-code",
  "provider-pi",
  "provider-acp",
] as const;

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

/** A registry holding the first-party providers, in product order. */
export async function createTestProviderRegistry(): Promise<ProviderRegistryService> {
  const registry = createProviderRegistryService();
  await registerFirstPartyProviders(registry);
  return registry;
}
