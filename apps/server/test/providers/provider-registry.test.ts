import {
  getBuiltInAgentProviderServerCapabilities,
  listBuiltInAgentProviderInfos,
} from "@bb/agent-providers";
import { describe, expect, it } from "vitest";
import { createProviderRegistryService } from "../../src/services/providers/provider-registry.js";

const CURSOR_LIKE_INFO = {
  available: true,
  capabilities: {
    supportsArchive: false,
    supportsRename: false,
    supportsServiceTier: false,
    supportsUserQuestion: false,
    supportsFork: false,
    supportedPermissionModes: ["full" as const],
  },
  composerActions: [],
  displayName: "Plugin Provider",
  id: "plugin-provider",
  logoUrl: null,
};

const MINIMAL_SERVER_CAPABILITIES = {
  supportsWorkflows: false,
  supportsSessionRestore: false,
  backsHostDaemonAiServices: false,
  reasoningLevels: ["medium" as const],
};

describe("provider registry", () => {
  it("resolves a provider set identical to the core catalog (the phase-3 equality pin)", () => {
    const registry = createProviderRegistryService();
    expect(registry.list().map((entry) => entry.info)).toStrictEqual(
      listBuiltInAgentProviderInfos(),
    );
    for (const info of listBuiltInAgentProviderInfos()) {
      expect(registry.get(info.id)?.serverCapabilities).toStrictEqual(
        getBuiltInAgentProviderServerCapabilities(info.id),
      );
      expect(registry.get(info.id)?.source).toStrictEqual({ kind: "core" });
    }
  });

  it("rejects plugin registrations that shadow an existing provider", () => {
    const registry = createProviderRegistryService();
    const coreId = listBuiltInAgentProviderInfos()[0]?.id;
    expect(coreId).toBeDefined();
    expect(() =>
      registry.register({
        info: { ...CURSOR_LIKE_INFO, id: coreId ?? "codex" },
        serverCapabilities: MINIMAL_SERVER_CAPABILITIES,
        pluginId: "some-plugin",
      }),
    ).toThrow(/already registered/);
  });

  it("adds and disposes plugin registrations without disturbing the core seed", () => {
    const registry = createProviderRegistryService();
    const before = registry.list().length;
    const handle = registry.register({
      info: CURSOR_LIKE_INFO,
      serverCapabilities: MINIMAL_SERVER_CAPABILITIES,
      pluginId: "some-plugin",
    });
    expect(registry.get("plugin-provider")).toMatchObject({
      source: { kind: "plugin", pluginId: "some-plugin" },
    });
    expect(registry.list()).toHaveLength(before + 1);

    handle.dispose();
    expect(registry.get("plugin-provider")).toBeNull();
    expect(registry.list()).toHaveLength(before);

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
});
