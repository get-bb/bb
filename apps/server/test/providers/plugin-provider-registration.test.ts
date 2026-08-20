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
    icon: "./icons/agent.svg",
    capabilities: {
      experimental_providerHealth: true,
      experimental_providerUsage: false,
      experimental_providerInstallation: true,
      supportsServiceTier: true,
      supportsNativeUserQuestion: true,
      fork: "checkpoint",
      supportsManualCompaction: false,
      supportsThreadArchive: true,
      supportsThreadRename: true,
      supportsWorkflows: true,
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
      available: true,
      pluginId: "acme-agent",
      declaration: normalized,
    });

    expect(registration.info).toStrictEqual({
      id: "my-remote-agent",
      displayName: "My Remote Agent",
      available: true,
      logoUrl: "/api/v1/system/providers/my-remote-agent/logo",
      experimental_providerHealth: true,
      experimental_providerUsage: false,
      experimental_providerInstallation: true,
      capabilities: {
        supportsThreadArchive: true,
        supportsThreadRename: true,
        supportsServiceTier: true,
        supportsNativeUserQuestion: true,
        supportsFork: true,
        supportsSessionRewind: true,
        permissionModes: ["accept-edits", "full"],
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
    // Every backend-only declared fact lands here, compaction included;
    // nothing rides along as a raw declaration to be read around.
    expect(registration.serverCapabilities).toStrictEqual({
      supportsWorkflows: true,
      reasoningLevels: ["low", "medium", "high"],
      fork: "checkpoint",
      supportsManualCompaction:
        normalized.capabilities.supportsManualCompaction,
    });
  });

  it("projects each fork ladder rung onto the two client booleans", () => {
    const projection = (fork: "none" | "tip" | "checkpoint") => {
      const { capabilities } = buildPluginProviderRegistration({
        available: true,
        pluginId: "acme-agent",
        declaration: declaration({
          capabilities: { ...declaration().capabilities, fork },
        }),
      }).info;
      return {
        supportsFork: capabilities.supportsFork,
        supportsSessionRewind: capabilities.supportsSessionRewind,
      };
    };
    // "tip" is the rung that distinguishes the two: ACP can clone a session
    // but cannot recreate one at an earlier point, so fork is offered and
    // edit-past-message rewind is not.
    expect(projection("none")).toStrictEqual({
      supportsFork: false,
      supportsSessionRewind: false,
    });
    expect(projection("tip")).toStrictEqual({
      supportsFork: true,
      supportsSessionRewind: false,
    });
    expect(projection("checkpoint")).toStrictEqual({
      supportsFork: true,
      supportsSessionRewind: true,
    });
  });

  it("maps an icon-less declaration to a null logoUrl and skills-only actions", () => {
    const registration = buildPluginProviderRegistration({
      available: true,
      pluginId: "acme-plain",
      declaration: declaration({
        id: "plain-agent",
        icon: undefined,
        composerActions: [],
      }),
    });

    expect(registration.info.logoUrl).toBeNull();
    expect(registration.info.composerActions).toStrictEqual([
      { kind: "skills", trigger: "/" },
    ]);
  });
});
