import { describe, expect, it } from "vitest";
import { validatePluginProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import type { PluginProviderDeclaration } from "@get-bb/plugin-sdk";
import { buildPluginProviderRegistration } from "../../src/services/providers/plugin-provider-registration.js";

function declaration(
  overrides: Partial<PluginProviderDeclaration> = {},
): PluginProviderDeclaration {
  return validatePluginProviderDeclaration({
    id: "my-remote-agent",
    displayName: "My Remote Agent",
    icon: { asset: "icons/agent.svg" },
    kind: "agent",
    bridge: { entry: "dist/bridge.js" },
    capabilities: {
      supportsServiceTier: true,
      supportsHostAiServices: false,
      supportsNativeUserQuestion: true,
      supportsNativeFork: true,
      supportsNativeSessionRewind: true,
      supportsManualCompaction: false,
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high"],
    },
    composerActions: ["plan", "goal"],
    ...overrides,
  });
}

describe("buildPluginProviderRegistration", () => {
  it("maps a declaration onto catalog-shaped info and server capabilities", () => {
    const normalized = declaration();
    const registration = buildPluginProviderRegistration({
      pluginId: "acme-agent",
      declaration: normalized,
    });

    expect(registration.info).toStrictEqual({
      id: "my-remote-agent",
      displayName: "My Remote Agent",
      available: true,
      logoUrl: "/api/v1/plugins/acme-agent/assets/icons/agent.svg",
      capabilities: {
        supportsArchive: false,
        supportsRename: false,
        supportsServiceTier: true,
        supportsUserQuestion: true,
        supportsFork: true,
        supportedPermissionModes: ["accept-edits", "full"],
      },
      composerActions: [
        { kind: "skills", trigger: "/" },
        {
          kind: "plan",
          command: { trigger: "/", name: "plan", trailingText: " " },
        },
        {
          kind: "goal",
          command: { trigger: "/", name: "goal", trailingText: " " },
        },
      ],
    });
    expect(registration.serverCapabilities).toStrictEqual({
      supportsWorkflows: false,
      supportsSessionRestore: false,
      backsHostDaemonAiServices: false,
      reasoningLevels: ["low", "medium", "high"],
    });
    // The full declaration rides the registration so declared facts without
    // a registry consumer yet (kind, bridge, rewind, compaction) survive.
    expect(registration.declaration).toBe(normalized);
  });

  it("maps an icon-less router to a null logoUrl and skills-only actions", () => {
    const registration = buildPluginProviderRegistration({
      pluginId: "acme-router",
      declaration: declaration({
        id: "auto-router",
        kind: "router",
        bridge: undefined,
        icon: undefined,
        composerActions: [],
      }),
    });

    expect(registration.info.logoUrl).toBeNull();
    expect(registration.info.composerActions).toStrictEqual([
      { kind: "skills", trigger: "/" },
    ]);
    expect(registration.declaration?.kind).toBe("router");
    expect(registration.declaration?.bridge).toBeUndefined();
  });
});
