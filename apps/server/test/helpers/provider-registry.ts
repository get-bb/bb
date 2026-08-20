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
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostDaemonBridgeLaunch } from "@bb/host-daemon-contract";
import { buildPluginHost, resolvePluginBuildToolchain } from "@bb/plugin-build";
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
import { PluginHostArtifactRegistry } from "../../src/services/plugins/plugin-host-artifact-registry.js";
import type { PluginHostArtifactSnapshot } from "../../src/services/plugins/plugin-service-internal.js";

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
 * as their plugins would. `excludePluginIds` models a plugin the user disabled
 * (or that failed to load), whose provider is then absent from the registry.
 *
 * Pass `artifacts` to also record a STUB bridge artifact per bridge-shipping
 * plugin. In production a loaded provider plugin always has one, and every
 * bridge-bound command carries a `bridgeLaunch` naming it, so a harness that
 * registers providers without artifacts models a state that cannot happen and
 * every command build fails. The stub is metadata only — no bytes are servable
 * from it. Tests that need the real bundle use
 * {@link recordFirstPartyProviderBridgeArtifacts}, which overwrites the stub.
 */
export async function registerFirstPartyProviders(
  registry: ProviderRegistryService,
  options: {
    excludePluginIds?: readonly string[];
    unavailablePluginIds?: readonly string[];
    artifacts?: PluginHostArtifactRegistry;
  } = {},
): Promise<void> {
  const excluded = new Set(options.excludePluginIds ?? []);
  const unavailable = new Set(options.unavailablePluginIds ?? []);
  for (const pluginId of FIRST_PARTY_PROVIDER_PLUGIN_IDS) {
    if (excluded.has(pluginId)) {
      continue;
    }
    const declaration = await loadDeclaration(pluginId);
    registry.register({
      ...buildPluginProviderRegistration({
        available: !unavailable.has(pluginId),
        pluginId,
        declaration,
      }),
      pluginId,
    });
    if (
      options.artifacts !== undefined &&
      !unavailable.has(pluginId) &&
      (await hasHostEntry(pluginRootDir(pluginId)))
    ) {
      options.artifacts.set(pluginId, stubHostArtifact(pluginId));
    }
  }
}

/**
 * A one-line bundle standing in for a built host artifact: real bytes at a real
 * path, so the internal plugin host artifact route serves them and a daemon
 * that downloads and hash-verifies it succeeds. Nothing executes it — the
 * harnesses that get this far run a fake adapter.
 */
function stubHostArtifact(pluginId: string): PluginHostArtifactSnapshot {
  const bytes = Buffer.from(`// stub host artifact for ${pluginId}\n`);
  const path = join(tmpdir(), `bb-stub-host-artifact-${pluginId}.mjs`);
  writeFileSync(path, bytes);
  return {
    digest: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.byteLength,
    path,
    generation: `stub-${pluginId}`,
  };
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
  artifacts: PluginHostArtifactRegistry,
): Promise<void> {
  const toolchain = await resolvePluginBuildToolchain(
    join(tmpdir(), "bb-plugin-build-toolchain"),
  );
  for (const pluginId of FIRST_PARTY_PROVIDER_PLUGIN_IDS) {
    const rootDir = pluginRootDir(pluginId);
    // Pi has no `bb.host`: its bridge stays in the daemon bundle.
    if (!(await hasHostEntry(rootDir))) {
      continue;
    }
    const build = await buildPluginHost(rootDir, "0.0.0-test", toolchain);
    const bytes = await readFile(build.jsPath);
    artifacts.set(pluginId, {
      digest: build.artifactDigest,
      byteLength: bytes.byteLength,
      path: build.jsPath,
      generation: `test-${pluginId}`,
    });
  }
}

async function hasHostEntry(rootDir: string): Promise<boolean> {
  const raw = await readFile(join(rootDir, "package.json"), "utf8");
  const parsed: unknown = JSON.parse(raw);
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as { bb?: unknown }).bb === "object" &&
    (parsed as { bb: { host?: unknown } }).bb.host !== undefined
  );
}

/** A registry holding the first-party providers, in product order. */
export async function createTestProviderRegistry(): Promise<ProviderRegistryService> {
  const registry = createProviderRegistryService();
  await registerFirstPartyProviders(registry);
  return registry;
}

/**
 * A well-formed `bridgeLaunch` for tests that only need a valid command on the
 * wire — transport plumbing (hub routing, online-RPC retries) that never
 * launches a bridge. Tests about which bridge a provider actually resolves to
 * must go through `resolveBridgeLaunchForProviderId` instead.
 */
export const TRANSPORT_TEST_BRIDGE_LAUNCH: HostDaemonBridgeLaunch = {
  pluginId: "provider-pi",
  source: { kind: "daemon-bundled", id: "pi" },
  capabilities: {
    supportsServiceTier: false,
    permissionModes: ["full"],
    supportsThreadArchive: false,
    supportsThreadRename: false,
    fork: "none",
  },
};

/**
 * Provider ids the fake-stack integration tests create threads on. `fake` is
 * the default there; the alpha/beta pair exercises per-provider process
 * isolation.
 */
const FAKE_PROVIDER_IDS = ["fake", "fake-alpha", "fake-beta"] as const;

/**
 * Declare the fake providers into a registry with a stub bridge artifact each,
 * the way a real provider plugin would. Every bridge-bound command carries a
 * `bridgeLaunch`, so a provider with neither a declaration nor an artifact
 * cannot have a command built for it at all — while the daemon side of those
 * tests runs a fake adapter and never reads the launch. Capabilities are
 * permissive: those tests are about lifecycle, not policy.
 */
export function registerFakeProviders(
  registry: ProviderRegistryService,
  artifacts: PluginHostArtifactRegistry,
): void {
  for (const providerId of FAKE_PROVIDER_IDS) {
    const pluginId = `provider-${providerId}`;
    registry.register({
      ...buildPluginProviderRegistration({
        available: true,
        pluginId,
        declaration: validatePluginProviderDeclaration({
          id: providerId,
          displayName: providerId,
          capabilities: {
            experimental_providerHealth: true,
            experimental_providerUsage: true,
            supportsServiceTier: true,
            supportsNativeUserQuestion: false,
            fork: "checkpoint",
            supportsManualCompaction: true,
            supportsThreadArchive: true,
            supportsThreadRename: true,
            supportsWorkflows: true,
            permissionModes: ["accept-edits", "auto", "full"],
            reasoningLevels: ["low", "medium", "high"],
          },
          composerActions: ["plan", "goal"],
        }),
      }),
      pluginId,
    });
    artifacts.set(pluginId, stubHostArtifact(pluginId));
  }
}
