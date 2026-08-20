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
  supportsWorkflows: false,
  reasoningLevels: ["medium" as const],
  fork: "none" as const,
};

function registerProvider(
  registry: ReturnType<typeof createProviderRegistryService>,
  id: string,
  pluginId: string,
): { dispose(): void } {
  return registry.register({
    info: { ...CURSOR_LIKE_INFO, id },
    serverCapabilities: MINIMAL_SERVER_CAPABILITIES,
    pluginId,
  });
}

describe("provider registry policy accessors", () => {
  it("answers from the registration, not a core seed", () => {
    const registry = createProviderRegistryService();
    registry.register({
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
      info: { ...CURSOR_LIKE_INFO, id: "codex" },
      serverCapabilities: {
        ...MINIMAL_SERVER_CAPABILITIES,
        supportsManualCompaction: true,
      },
      pluginId: "provider-codex",
    });
    expect(registry.supportsManualCompaction("codex")).toBe(true);

    handle.dispose();
    expect(registry.get("codex")).toBeNull();
    expect(registry.supportsManualCompaction("codex")).toBe(false);
    expect(registry.getServerCapabilities("codex")).toBeNull();
  });
});

describe("provider registry ordering", () => {
  // Listing order is product policy. Plugins load alphabetically by plugin id
  // and a disable/re-enable moves a registration to the end, so order must not
  // come from registration order.
  it("lists product-ordered ids first regardless of registration order", () => {
    const registry = createProviderRegistryService();
    registerProvider(registry, "pi", "provider-pi");
    registerProvider(registry, "acp-cursor", "provider-acp");
    registerProvider(registry, "codex", "provider-codex");
    registerProvider(registry, "claude-code", "provider-claude-code");

    expect(registry.list().map((entry) => entry.info.id)).toStrictEqual([
      "codex",
      "claude-code",
      "pi",
      "acp-cursor",
    ]);
  });

  it("appends undeclared ids after the product order, by registration", () => {
    const registry = createProviderRegistryService();
    registerProvider(registry, "zeta-agent", "zeta");
    registerProvider(registry, "codex", "provider-codex");
    registerProvider(registry, "alpha-agent", "alpha");

    expect(registry.list().map((entry) => entry.info.id)).toStrictEqual([
      "codex",
      "zeta-agent",
      "alpha-agent",
    ]);
  });

  it("re-enabling a provider plugin restores its listing position", () => {
    const registry = createProviderRegistryService();
    registerProvider(registry, "codex", "provider-codex");
    const pi = registerProvider(registry, "pi", "provider-pi");
    registerProvider(registry, "acp-cursor", "provider-acp");

    pi.dispose();
    expect(registry.list().map((entry) => entry.info.id)).toStrictEqual([
      "codex",
      "acp-cursor",
    ]);

    registerProvider(registry, "pi", "provider-pi");
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

  // Squatting, not shadowing: with the official plugin disabled its id is
  // free, and for pi the runtime would still execute the daemon-bundled
  // bridge under the impostor's metadata.
  it("keeps first-party ids reserved even with no live registration", () => {
    const registry = createProviderRegistryService();
    for (const [providerId, owner] of [
      ["codex", "provider-codex"],
      ["claude-code", "provider-claude-code"],
      ["pi", "provider-pi"],
      ["acp-cursor", "provider-acp"],
      ["acp-anything", "provider-acp"],
    ] as const) {
      expect(() => registerProvider(registry, providerId, "impostor")).toThrow(
        new RegExp(`reserved for the "${owner}" plugin`),
      );
      // The owner itself registers normally.
      registerProvider(registry, providerId, owner).dispose();
    }
    // Unreserved ids are unaffected.
    registerProvider(registry, "some-third-party-agent", "impostor");
  });

  it("adds and disposes plugin registrations", () => {
    const registry = createProviderRegistryService();
    const handle = registry.register({
      info: CURSOR_LIKE_INFO,
      serverCapabilities: MINIMAL_SERVER_CAPABILITIES,
      pluginId: "some-plugin",
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
      info: CURSOR_LIKE_INFO,
      serverCapabilities: MINIMAL_SERVER_CAPABILITIES,
      pluginId: "other-plugin",
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
