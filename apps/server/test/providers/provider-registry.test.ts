import { describe, expect, it } from "vitest";
import { createProviderRegistryService } from "../../src/services/providers/provider-registry.js";

const CURSOR_LIKE_INFO = {
  available: true,
  experimental_providerHealth: true,
  experimental_providerUsage: true,
  experimental_providerInstallation: false,
  capabilities: {
    supportsThreadArchive: false,
    supportsThreadRename: false,
    supportsServiceTier: false,
    supportsNativeUserQuestion: false,
    supportsFork: false,
    supportsSessionRewind: false,
    permissionModes: ["full" as const],
  },
  composerActions: [],
  displayName: "Plugin Provider",
  id: "plugin-provider",
  logoUrl: null,
};

const MINIMAL_SERVER_CAPABILITIES = {
  supportsManualCompaction: false,
  reasoningLevels: ["medium" as const],
  fork: "none" as const,
};

function registerProvider(
  registry: ReturnType<typeof createProviderRegistryService>,
  id: string,
  pluginId: string,
  installRank?: { bundledIndex: number | null; installedAt: number },
): { dispose(): void } {
  return registry.register({
    bridgeOptions: {},
    info: { ...CURSOR_LIKE_INFO, id },
    serverCapabilities: MINIMAL_SERVER_CAPABILITIES,
    pluginId,
    visibility: "always",
    ...(installRank === undefined ? {} : { installRank }),
  });
}

describe("provider registry policy accessors", () => {
  it("answers from the registration, not a core seed", () => {
    const registry = createProviderRegistryService();
    registry.register({
      bridgeOptions: {},
      info: {
        ...CURSOR_LIKE_INFO,
        id: "codex",
        capabilities: {
          ...CURSOR_LIKE_INFO.capabilities,
          supportsFork: true,
          supportsSessionRewind: true,
          permissionModes: ["accept-edits", "full"],
        },
      },
      serverCapabilities: MINIMAL_SERVER_CAPABILITIES,
      pluginId: "provider-codex",
      visibility: "always",
    });
    expect(registry.getServerCapabilities("codex")).toStrictEqual(
      MINIMAL_SERVER_CAPABILITIES,
    );
    expect(registry.getSupportedPermissionModes("codex")).toStrictEqual([
      "accept-edits",
      "full",
    ]);
    expect(registry.supportsFork("codex")).toBe(true);
  });

  // The dynamic ACP tier is the one answer source that is not a registration:
  // acp-* ids resolved from launch specs are never declared by a plugin.
  it("falls back to the shared ACP tier for unregistered acp-* ids", () => {
    const registry = createProviderRegistryService();
    expect(registry.getServerCapabilities("acp-custom-agent")).not.toBeNull();
    expect(
      registry.getSupportedPermissionModes("acp-custom-agent"),
    ).toStrictEqual(["accept-edits", "full"]);
    expect(typeof registry.supportsFork("acp-custom-agent")).toBe("boolean");
    // With no resolver wired the tier declares nothing, so an unresolvable
    // acp-* id cannot claim a per-agent capability.
    expect(registry.supportsManualCompaction("acp-opencode")).toBe(false);
  });

  // Manual compaction is per-agent, not per-tier: it used to be a hardcoded
  // `["acp-opencode"]` set, and is now the resolved agent's own declaration.
  it("reads acp compaction support from the resolved agent declaration", () => {
    const declared = new Map([
      ["acp-opencode", { supportsManualCompaction: true }],
      ["acp-omp", { supportsManualCompaction: false }],
    ]);
    const registry = createProviderRegistryService({
      resolveAcpAgentCapabilities: (providerId) =>
        declared.get(providerId) ?? null,
    });
    expect(registry.supportsManualCompaction("acp-opencode")).toBe(true);
    expect(registry.supportsManualCompaction("acp-omp")).toBe(false);
    expect(registry.supportsManualCompaction("acp-custom-agent")).toBe(false);
  });

  it("answers null/false for unknown provider ids", () => {
    const registry = createProviderRegistryService();
    expect(registry.getServerCapabilities("nope")).toBeNull();
    expect(registry.getSupportedPermissionModes("nope")).toBeNull();
    expect(registry.supportsFork("nope")).toBe(false);
  });

  // A disabled provider plugin removes its provider outright. The compaction
  // accessor used to keep answering `true` for codex from a catalog string
  // list even with no registration; that would have been the one accessor
  // claiming a capability for a provider that no longer exists.
  it("stops claiming capabilities for a provider whose plugin is gone", () => {
    const registry = createProviderRegistryService();
    const handle = registry.register({
      bridgeOptions: {},
      info: { ...CURSOR_LIKE_INFO, id: "codex" },
      serverCapabilities: {
        ...MINIMAL_SERVER_CAPABILITIES,
        supportsManualCompaction: true,
      },
      pluginId: "provider-codex",
      visibility: "always",
    });
    expect(registry.supportsManualCompaction("codex")).toBe(true);

    handle.dispose();
    expect(registry.get("codex")).toBeNull();
    expect(registry.supportsManualCompaction("codex")).toBe(false);
    expect(registry.getServerCapabilities("codex")).toBeNull();
  });
});

describe("provider registry ordering", () => {
  // Listing order is plugin install order, not registration order: plugins
  // load alphabetically by plugin id and a disable/re-enable moves a
  // registration to the end, so order must not come from registration order.
  // Bundled plugins rank by their bundled position (they install first, at
  // bootstrap); everything else ranks by install time.
  it("lists bundled plugins first in bundled order, then others by install time", () => {
    const registry = createProviderRegistryService();
    registerProvider(registry, "late-agent", "late", {
      bundledIndex: null,
      installedAt: 2_000,
    });
    registerProvider(registry, "pi", "provider-pi", {
      bundledIndex: 2,
      installedAt: 5_000,
    });
    registerProvider(registry, "early-agent", "early", {
      bundledIndex: null,
      installedAt: 1_000,
    });
    registerProvider(registry, "codex", "provider-codex", {
      bundledIndex: 0,
      installedAt: 9_000,
    });

    expect(registry.list().map((entry) => entry.info.id)).toStrictEqual([
      "codex",
      "pi",
      "early-agent",
      "late-agent",
    ]);
  });

  it("keeps registration order among entries with no install rank", () => {
    const registry = createProviderRegistryService();
    registerProvider(registry, "zeta-agent", "zeta");
    registerProvider(registry, "alpha-agent", "alpha");
    registerProvider(registry, "codex", "provider-codex", {
      bundledIndex: 0,
      installedAt: 0,
    });

    expect(registry.list().map((entry) => entry.info.id)).toStrictEqual([
      "codex",
      "zeta-agent",
      "alpha-agent",
    ]);
  });

  it("re-enabling a provider plugin restores its listing position", () => {
    const registry = createProviderRegistryService();
    registerProvider(registry, "codex", "provider-codex", {
      bundledIndex: 0,
      installedAt: 0,
    });
    const pi = registerProvider(registry, "pi", "provider-pi", {
      bundledIndex: 1,
      installedAt: 0,
    });
    registerProvider(registry, "acp-cursor", "provider-acp", {
      bundledIndex: 2,
      installedAt: 0,
    });

    pi.dispose();
    expect(registry.list().map((entry) => entry.info.id)).toStrictEqual([
      "codex",
      "acp-cursor",
    ]);

    registerProvider(registry, "pi", "provider-pi", {
      bundledIndex: 1,
      installedAt: 0,
    });
    expect(registry.list().map((entry) => entry.info.id)).toStrictEqual([
      "codex",
      "pi",
      "acp-cursor",
    ]);
  });

  it("lets the user's providerOrder lead and reads a default only when registered", () => {
    const preferences = {
      providerOrder: ["acp-cursor", "ghost", "pi"],
      defaultProviderId: "ghost" as string | null,
    };
    const registry = createProviderRegistryService({
      readUserProviderPreferences: () => preferences,
    });
    registerProvider(registry, "codex", "provider-codex", {
      bundledIndex: 0,
      installedAt: 0,
    });
    registerProvider(registry, "pi", "provider-pi", {
      bundledIndex: 1,
      installedAt: 0,
    });
    registerProvider(registry, "acp-cursor", "provider-acp", {
      bundledIndex: 2,
      installedAt: 0,
    });

    // Pinned ids lead in the user's order (an unknown id is ignored); the
    // rest keep install order.
    expect(registry.list().map((entry) => entry.info.id)).toStrictEqual([
      "acp-cursor",
      "pi",
      "codex",
    ]);
    // A default naming no registered provider answers null, never the id.
    expect(registry.getUserDefaultProviderId()).toBeNull();
    preferences.defaultProviderId = "codex";
    expect(registry.getUserDefaultProviderId()).toBe("codex");
    // Preferences are read per call: a settings change applies at once.
    preferences.providerOrder = [];
    expect(registry.list().map((entry) => entry.info.id)).toStrictEqual([
      "codex",
      "pi",
      "acp-cursor",
    ]);
  });
});

describe("provider registry", () => {
  it("starts empty: providers exist only while a plugin declares them", () => {
    expect(createProviderRegistryService().list()).toStrictEqual([]);
  });

  it("rejects plugin registrations that shadow an existing provider", () => {
    const registry = createProviderRegistryService();
    registerProvider(registry, "third-party-agent", "first-plugin");
    expect(() =>
      registerProvider(registry, "third-party-agent", "impostor"),
    ).toThrow(/already registered/);
  });

  // Flat ids: no reservation table. Any plugin may claim an id nobody holds,
  // and the first live registration wins until it is disposed.
  it("frees an id the moment its registration is disposed", () => {
    const registry = createProviderRegistryService();
    for (const providerId of ["codex", "pi", "acp-cursor", "acp-anything"]) {
      const handle = registerProvider(registry, providerId, "first-plugin");
      expect(() =>
        registerProvider(registry, providerId, "second-plugin"),
      ).toThrow(/already registered/);
      handle.dispose();
      registerProvider(registry, providerId, "second-plugin").dispose();
    }
  });

  it("adds and disposes plugin registrations", () => {
    const registry = createProviderRegistryService();
    const handle = registry.register({
      bridgeOptions: {},
      info: CURSOR_LIKE_INFO,
      serverCapabilities: MINIMAL_SERVER_CAPABILITIES,
      pluginId: "some-plugin",
      visibility: "always",
    });
    expect(registry.get("plugin-provider")).toMatchObject({
      source: { kind: "plugin", pluginId: "some-plugin" },
    });
    expect(registry.list()).toHaveLength(1);

    handle.dispose();
    expect(registry.get("plugin-provider")).toBeNull();
    expect(registry.list()).toHaveLength(0);

    // Disposing twice, or after a re-registration, must not remove a newer
    // registration for the same id.
    const second = registry.register({
      bridgeOptions: {},
      info: CURSOR_LIKE_INFO,
      serverCapabilities: MINIMAL_SERVER_CAPABILITIES,
      pluginId: "other-plugin",
      visibility: "always",
    });
    handle.dispose();
    expect(registry.get("plugin-provider")).toMatchObject({
      source: { kind: "plugin", pluginId: "other-plugin" },
    });
    second.dispose();
  });

  it("releases a provider-scoped boot wait as soon as that provider registers", async () => {
    const registry = createProviderRegistryService({
      deferRegistrationsSettled: true,
    });
    let requestedProviderReady = false;
    let unrelatedProviderReady = false;
    const requestedWait = registry.whenProviderRegistered("codex").then(() => {
      requestedProviderReady = true;
    });
    const unrelatedWait = registry
      .whenProviderRegistered("claude-code")
      .then(() => {
        unrelatedProviderReady = true;
      });

    registerProvider(registry, "codex", "provider-codex");
    await requestedWait;

    expect(requestedProviderReady).toBe(true);
    expect(unrelatedProviderReady).toBe(false);

    registry.markRegistrationsSettled();
    await unrelatedWait;
    expect(unrelatedProviderReady).toBe(true);
  });

  it("uses the shared ACP tier registration to release dynamic ACP waits", async () => {
    const registry = createProviderRegistryService({
      deferRegistrationsSettled: true,
    });
    const ready = registry.whenProviderRegistered("acp-opencode");

    registerProvider(registry, "acp-cursor", "provider-acp");

    await ready;
    expect(registry.get("acp-opencode")).toBeNull();
  });
});
