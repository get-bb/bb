/**
 * Test registries seeded with the first-party providers.
 *
 * Production gets its providers from the four first-party provider plugins;
 * there is no core seed to fall back on. Most server tests need those
 * providers but cannot afford to install and run four plugins, so this helper
 * takes the SAME declarations those plugins register — by invoking their
 * server entrypoints against the SDK's fake plugin host
 * (`captureFirstPartyProviderDeclarations`) — and pushes them through the
 * same mapping the plugin runtime uses. Nothing is re-stated here, so a
 * declaration change cannot drift from what the tests assume.
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
import {
  validatePluginProviderDeclaration,
  type NormalizedPluginProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import {
  EMPTY_PROVIDER_NATIVE_ROOTS,
  EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS,
  type JsonValue,
  parseNamespacedGlyph,
  pluginPackageJsonSchema,
  type ProviderInfo,
  type ProviderNativeRootSet,
} from "@bb/domain";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  captureFirstPartyProviderDeclarations,
  firstPartyPluginRootDir,
} from "@bb/agent-runtime/test";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";
import { readPluginProviderIcon } from "../../src/services/plugins/plugin-runtime.js";
import {
  createProviderRegistryService,
  type ProviderRegistration,
  type ProviderRegistryService,
  type ProviderServerCapabilities,
} from "../../src/services/providers/provider-registry.js";
import { PluginHostArtifactRegistry } from "../../src/services/plugins/plugin-host-artifact-registry.js";
import type { PluginHostArtifactSnapshot } from "../../src/services/plugins/plugin-service-internal.js";

const FIRST_PARTY_PROVIDER_PLUGIN_IDS = [
  "provider-codex",
  "provider-claude-code",
  "provider-pi",
  "provider-acp",
] as const;

/**
 * The loaded first-party declarations, keyed by plugin id — for tests that
 * pin the projected `ProviderInfo` against the declarations themselves.
 */
export async function loadFirstPartyProviderDeclarations(): Promise<
  ReadonlyMap<string, readonly NormalizedPluginProviderDeclaration[]>
> {
  const entries = await Promise.all(
    FIRST_PARTY_PROVIDER_PLUGIN_IDS.map(
      async (pluginId) =>
        [
          pluginId,
          await captureFirstPartyProviderDeclarations(pluginId),
        ] as const,
    ),
  );
  return new Map(entries);
}

/** No stored plugin settings: every per-command option hook sees defaults. */
const NO_PLUGIN_SETTINGS = (): Readonly<Record<string, never>> => ({});

/**
 * The declared icons of a first-party plugin (`bb.branding.experimental_icons`),
 * name → plugin-relative path. The plugin runtime resolves a provider icon in
 * the namespaced form (`"<pluginId>/<name>"`) against the branding snapshots
 * it took at load; a harness that reads only the path form would register
 * those providers with no icon bytes, and the logo route would answer 404 for
 * a provider that has a logo in production.
 */
async function declaredIcons(pluginId: string): Promise<Map<string, string>> {
  const manifest = pluginPackageJsonSchema.parse(
    JSON.parse(
      await readFile(
        join(firstPartyPluginRootDir(pluginId), "package.json"),
        "utf8",
      ),
    ),
  );
  return new Map(Object.entries(manifest.bb.branding.experimental_icons ?? {}));
}

/**
 * The icon byte snapshot the plugin runtime captures at registration, for
 * either declared form: a plugin-relative path, or one of the plugin's own
 * declared icons by its namespaced glyph. The provider-logo route serves
 * exactly these bytes.
 */
function providerIconSnapshot(args: {
  pluginId: string;
  icon: string | undefined;
  icons: ReadonlyMap<string, string>;
}): { bytes: Uint8Array; contentType: string } | null {
  const namespaced =
    args.icon === undefined ? null : parseNamespacedGlyph(args.icon);
  const asset =
    namespaced === null
      ? args.icon
      : namespaced.pluginId === args.pluginId
        ? args.icons.get(namespaced.name)
        : undefined;
  return readPluginProviderIcon(firstPartyPluginRootDir(args.pluginId), asset);
}

/**
 * Registers the first-party providers into an existing registry, exactly as
 * their four plugins would. `excludePluginIds` models a plugin the user disabled
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
    const declarations = await captureFirstPartyProviderDeclarations(pluginId);
    const icons = await declaredIcons(pluginId);
    // The artifact lands before the registration flushes, as the plugin
    // runtime records it before the load commits: a picker request that
    // wakes on the registration must find the bridge already there.
    if (
      options.artifacts !== undefined &&
      !unavailable.has(pluginId) &&
      (await hasHostEntry(firstPartyPluginRootDir(pluginId)))
    ) {
      options.artifacts.set(pluginId, stubHostArtifact(pluginId));
    }
    for (const declaration of declarations) {
      const icon = providerIconSnapshot({
        pluginId,
        icon: declaration.icon,
        icons,
      });
      registry.register({
        ...buildPluginProviderRegistration({
          available: !unavailable.has(pluginId),
          pluginId,
          declaration,
          readSettings: NO_PLUGIN_SETTINGS,
        }),
        ...(icon === null ? {} : { icon }),
        pluginId,
        iconNames: new Set(icons.keys()),
        // The bundled order: codex, claude-code, pi, acp — the same install
        // rank the plugin runtime assigns from the bundled plugin list.
        installRank: {
          bundledIndex: FIRST_PARTY_PROVIDER_PLUGIN_IDS.indexOf(pluginId),
          installedAt: 0,
        },
      });
    }
  }
}

/**
 * A full registration for a test that states only the provider's info and
 * server capabilities. The registry takes every field filled — the
 * declaration validator and `buildPluginProviderRegistration` are the one
 * place defaults are decided — so a partial test registration states the
 * empty values here rather than through a third defaulting layer in the
 * registry. `installRank` stays the registry's own optional: omitting it
 * ranks last.
 */
export function minimalProviderRegistration(args: {
  pluginId: string;
  info: ProviderInfo;
  serverCapabilities: ProviderServerCapabilities;
}): ProviderRegistration {
  return {
    info: args.info,
    serverCapabilities: args.serverCapabilities,
    pluginId: args.pluginId,
    bridgeOptions: {},
    extensionKinds: {},
    visibility: "always",
    fallbackModels: [],
    envPassthrough: [],
    nativeSkillRoots: EMPTY_PROVIDER_NATIVE_ROOTS,
    nativeCommandRoots: EMPTY_PROVIDER_NATIVE_ROOTS,
    resolvesNativeRoots: false,
    deriveProviderOptions: () => ({}),
    iconNames: new Set<string>(),
  };
}

/**
 * A one-line bundle standing in for a built host artifact: real bytes at a real
 * path, so the internal plugin host artifact route serves them and a daemon
 * that downloads and hash-verifies it succeeds. Used only for first-party
 * plugins whose bridge the server tests never launch; the fake providers get
 * the real scripted echo artifact (`registerFakeProviders`).
 */
export function stubHostArtifact(pluginId: string): PluginHostArtifactSnapshot {
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

const firstPartyBridgeArtifactBuilds = new Map<
  string,
  Promise<PluginHostArtifactSnapshot | null>
>();

async function buildFirstPartyBridgeArtifact(
  pluginId: string,
): Promise<PluginHostArtifactSnapshot | null> {
  const rootDir = firstPartyPluginRootDir(pluginId);
  if (!(await hasHostEntry(rootDir))) {
    return null;
  }
  const toolchain = await resolvePluginBuildToolchain(
    join(tmpdir(), "bb-plugin-build-toolchain"),
  );
  const build = await buildPluginHost(rootDir, "0.0.0-test", toolchain);
  const bytes = await readFile(build.jsPath);
  return {
    digest: build.artifactDigest,
    byteLength: bytes.byteLength,
    path: build.jsPath,
    generation: `test-${pluginId}`,
  };
}

/**
 * Builds and records the first-party provider bridge artifacts, exactly as the
 * plugin runtime does on load. Without this a graduated provider has no
 * `bridgeLaunch`, so the daemon has no bridge for it at all — which is the
 * whole point of the artifact route and therefore worth exercising rather
 * than stubbing. Bridges are rebuilt from source so a stale `dist/` cannot
 * make a test pass against yesterday's bridge — once per worker process:
 * the sources do not change during a run, and the ~0.6s esbuild pass was
 * paid by every integration harness, one per test.
 */
export async function recordFirstPartyProviderBridgeArtifacts(
  artifacts: PluginHostArtifactRegistry,
): Promise<void> {
  for (const pluginId of FIRST_PARTY_PROVIDER_PLUGIN_IDS) {
    let build = firstPartyBridgeArtifactBuilds.get(pluginId);
    if (!build) {
      build = buildFirstPartyBridgeArtifact(pluginId);
      firstPartyBridgeArtifactBuilds.set(pluginId, build);
    }
    const snapshot = await build;
    if (snapshot !== null) {
      artifacts.set(pluginId, snapshot);
    }
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

/**
 * The root set a listing forwards for a registered provider whose plugin
 * resolved nothing: its declared skill and command roots, read back from the
 * registry so a test pins the forwarding, not the plugin's declaration.
 */
export function declaredNativeRootSet(
  registry: ProviderRegistryService,
  providerId: string,
): ProviderNativeRootSet {
  const registration = registry.get(providerId);
  if (registration === null) {
    throw new Error(`provider "${providerId}" is not registered`);
  }
  return {
    skills: registration.nativeSkillRoots,
    commands: registration.nativeCommandRoots,
    resolved: EMPTY_PROVIDER_RESOLVED_NATIVE_ROOTS,
  };
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
  source: { kind: "artifact", digest: "a".repeat(64), byteLength: 1 },
  providerOptions: {},
  envPassthrough: [],
  capabilities: {
    providerInstallation: false,
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
 * isolation. All three run the scripted echo bridge.
 */
const FAKE_PROVIDER_IDS = ["fake", "fake-alpha", "fake-beta"] as const;

/** The scripted echo provider's plugin root (`tests/scripted-echo-provider`). */
export function scriptedEchoProviderRootDir(): string {
  return fileURLToPath(
    new URL("../../../../tests/scripted-echo-provider", import.meta.url),
  );
}

/**
 * Build the scripted echo bridge artifact exactly as the plugin runtime builds
 * a real provider plugin's `bb.host` entry. Rebuilt from source per call, like
 * the first-party bridges above, so a stale `dist/` cannot make a test pass
 * against yesterday's bridge.
 */
export async function buildScriptedEchoProviderArtifact(): Promise<PluginHostArtifactSnapshot> {
  const toolchain = await resolvePluginBuildToolchain(
    join(tmpdir(), "bb-plugin-build-toolchain"),
  );
  const build = await buildPluginHost(
    scriptedEchoProviderRootDir(),
    "0.0.0-test",
    toolchain,
  );
  const bytes = await readFile(build.jsPath);
  return {
    digest: build.artifactDigest,
    byteLength: bytes.byteLength,
    path: build.jsPath,
    generation: "test-scripted-echo",
  };
}

/**
 * Declare the fake providers into a registry, each backed by the scripted
 * echo bridge artifact, the way a real provider plugin would be. Every
 * bridge-bound command carries a `bridgeLaunch`, and the daemon really runs
 * the artifact through the bridge-protocol adapter — there is no test-only
 * adapter path. Capabilities are permissive: those tests are about
 * lifecycle, not policy.
 */
export async function registerFakeProviders(
  registry: ProviderRegistryService,
  artifacts: PluginHostArtifactRegistry,
): Promise<void> {
  const artifact = await buildScriptedEchoProviderArtifact();
  for (const providerId of FAKE_PROVIDER_IDS) {
    const pluginId = `provider-${providerId}`;
    registry.register({
      ...buildPluginProviderRegistration({
        available: true,
        pluginId,
        declaration: validatePluginProviderDeclaration({
          id: providerId,
          displayName: providerId,
          maintenance: { health: true, usage: true, installation: false },
          capabilities: {
            supportsServiceTier: true,
            supportsNativeUserQuestion: true,
            fork: "checkpoint",
            supportsManualCompaction: true,
            supportsThreadArchive: true,
            supportsThreadRename: true,
            permissionModes: ["accept-edits", "auto", "full"],
            reasoningLevels: ["low", "medium", "high"],
          },
          composerActions: ["plan", "goal"],
        }),
        readSettings: NO_PLUGIN_SETTINGS,
      }),
      pluginId,
      iconNames: new Set<string>(),
    });
    artifacts.set(pluginId, artifact);
  }
}

/**
 * The declarations the ACP plugin builds for the agents this `customAgents`
 * setting declares — through the plugin's own factory, not a hand-built copy.
 *
 * A test that states its own declaration proves the server reads a shape, not
 * that the plugin produces it. That gap is how `nativeSkillRoots` reached the
 * launch spec and never the declaration.
 */
export async function acpProviderDeclarationsFromSetting(
  entries: readonly JsonValue[],
): Promise<NormalizedPluginProviderDeclaration[]> {
  const shipped = new Set(
    (await captureFirstPartyProviderDeclarations("provider-acp")).map(
      (declaration) => declaration.id,
    ),
  );
  const withSetting = await captureFirstPartyProviderDeclarations(
    "provider-acp",
    {
      settings: { customAgents: JSON.stringify(entries) },
    },
  );
  const configured = withSetting.filter(
    (declaration) => !shipped.has(declaration.id),
  );
  if (configured.length !== entries.length) {
    throw new Error(
      `the ACP plugin registered ${configured.length} of ${entries.length} configured agents; check the setting entries`,
    );
  }
  return configured;
}

/**
 * One configured ACP agent as a `withTestHarness({ extraProviders })` entry.
 * The setting entry's `id` is the slug: the provider id is `acp-<id>`.
 */
export async function configuredAcpProvider(
  entry: Record<string, JsonValue>,
): Promise<{ declaration: PluginProviderDeclaration; pluginId: string }> {
  const [declaration] = await acpProviderDeclarationsFromSetting([entry]);
  if (declaration === undefined) {
    throw new Error("the ACP plugin registered no provider for this entry");
  }
  return { declaration, pluginId: "provider-acp" };
}

/**
 * A user-configured ACP agent in the registry, registered the way the ACP
 * plugin registers one from its own settings. `entry` is the setting entry,
 * so the provider id is `acp-<entry.id>`.
 */
export async function registerConfiguredAcpProvider(
  registry: ProviderRegistryService,
  entry: Record<string, JsonValue>,
): Promise<void> {
  const pluginId = "provider-acp";
  for (const declaration of await acpProviderDeclarationsFromSetting([entry])) {
    registry.register({
      ...buildPluginProviderRegistration({
        available: true,
        pluginId,
        declaration,
        readSettings: NO_PLUGIN_SETTINGS,
      }),
      pluginId,
      iconNames: new Set<string>(),
    });
  }
}
