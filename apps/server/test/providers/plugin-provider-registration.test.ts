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
    experimental_bridgeOptions: { launch: { command: "my-agent" } },
    experimental_visibility: "installed",
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
      permissionModes: ["accept-edits", "full"],
      reasoningLevels: ["low", "medium", "high"],
    },
    composerActions: ["plan", "goal"],
    ...overrides,
  });
}

const NO_SETTINGS = () => ({});

describe("buildPluginProviderRegistration", () => {
  it("maps a declaration onto the single ProviderInfo and server capabilities", () => {
    const normalized = declaration();
    const registration = buildPluginProviderRegistration({
      available: true,
      pluginId: "acme-agent",
      declaration: normalized,
      readSettings: NO_SETTINGS,
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
      // The coarse ladder projects to labelled options when the declaration
      // gives no labels of its own; a service-tier provider gets the pair the
      // fast-mode toggle offers.
      reasoningLevels: [
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
      ],
      serviceTiers: [
        { id: "default", label: "Default" },
        { id: "fast", label: "Fast" },
      ],
    });
    // Every backend-only declared fact lands here, compaction included;
    // nothing rides along as a raw declaration to be read around.
    expect(registration.serverCapabilities).toStrictEqual({
      reasoningLevels: ["low", "medium", "high"],
      fork: "checkpoint",
      supportsManualCompaction:
        normalized.capabilities.supportsManualCompaction,
    });
    expect(registration.bridgeOptions).toStrictEqual({
      launch: { command: "my-agent" },
    });
    expect(registration.visibility).toBe("installed");
    expect(registration.fallbackModels).toStrictEqual([]);
    expect(registration.envPassthrough).toStrictEqual([]);
    expect(
      registration.deriveProviderOptions({
        threadId: "thr_1",
        projectId: "proj_1",
        model: "m",
        permissionMode: "full",
      }),
    ).toStrictEqual({});
  });

  it("projects the target-state declaration fields onto ProviderInfo", () => {
    const registration = buildPluginProviderRegistration({
      available: true,
      pluginId: "acme-agent",
      declaration: declaration({
        experimental_family: "remote",
        experimental_strings: {
          signInHint: "Run `my-agent login`.",
          expiredHint: "Session expired.",
          installUrl: "https://example.com/install",
          brandPrefix: "My ",
          iconTint: { light: "#111", dark: "#eee" },
        },
        experimental_reasoningLevels: [
          { id: "low", label: "Quick" },
          { id: "high", label: "Deep", description: "Slow but thorough." },
        ],
        experimental_serviceTiers: [
          { id: "default", label: "Standard" },
          { id: "fast", label: "Priority" },
        ],
        experimental_extensionKinds: {
          widget: { item: { "~standard": standardSchema() } },
          mood: {
            item: { "~standard": standardSchema() },
            state: { "~standard": standardSchema() },
          },
        },
      }),
      readSettings: NO_SETTINGS,
    });

    expect(registration.info.family).toBe("remote");
    expect(registration.info.strings).toStrictEqual({
      signInHint: "Run `my-agent login`.",
      expiredHint: "Session expired.",
      installUrl: "https://example.com/install",
      brandPrefix: "My ",
      iconTint: { light: "#111", dark: "#eee" },
    });
    expect(registration.info.reasoningLevels).toStrictEqual([
      { id: "low", label: "Quick" },
      { id: "high", label: "Deep", description: "Slow but thorough." },
    ]);
    expect(registration.info.serviceTiers).toStrictEqual([
      { id: "default", label: "Standard" },
      { id: "fast", label: "Priority" },
    ]);
    // Extension kinds are namespaced by the OWNING PLUGIN id, not the
    // provider id: the plugin is what keeps two plugins' "widget" apart.
    expect(registration.info.extensionKinds).toStrictEqual({
      "acme-agent/widget": { item: true, state: false },
      "acme-agent/mood": { item: true, state: true },
    });
  });

  it("binds the options hook to the plugin's settings and validates its result", () => {
    const registration = buildPluginProviderRegistration({
      available: true,
      pluginId: "acme-agent",
      declaration: declaration({
        experimental_models: {
          fallback: [
            {
              id: "m-1",
              displayName: "Model One",
              description: "The one.",
              supportedReasoningEfforts: [
                { reasoningEffort: "low", description: "Low." },
                { reasoningEffort: "high", description: "High." },
              ],
              defaultReasoningEffort: "high",
              isDefault: true,
            },
          ],
        },
        experimental_env: { passthrough: ["BB_MY_AGENT_EXECUTABLE"] },
        experimental_deriveProviderOptions: (context) => ({
          memory: context.settings.memoryEnabled !== false,
          plan: context.promptMode === "plan",
          thread: context.threadId,
        }),
      }),
      readSettings: () => ({ memoryEnabled: false }),
    });

    expect(
      registration.deriveProviderOptions({
        threadId: "thr_1",
        projectId: "proj_1",
        model: "m-1",
        permissionMode: "auto",
        promptMode: "plan",
      }),
    ).toStrictEqual({ memory: false, plan: true, thread: "thr_1" });
    expect(registration.envPassthrough).toStrictEqual([
      "BB_MY_AGENT_EXECUTABLE",
    ]);
    expect(registration.fallbackModels).toStrictEqual([
      {
        id: "m-1",
        model: "m-1",
        displayName: "Model One",
        description: "The one.",
        supportedReasoningEfforts: [
          { reasoningEffort: "low", description: "Low." },
          { reasoningEffort: "high", description: "High." },
        ],
        defaultReasoningEffort: "high",
        isDefault: true,
      },
    ]);
  });

  it("refuses a hook result that is not bounded plain JSON", () => {
    const registration = buildPluginProviderRegistration({
      available: true,
      pluginId: "acme-agent",
      declaration: declaration({
        experimental_deriveProviderOptions: () => ({
          // A function is not JSON; the bag rides the daemon wire.
          oops: (() => undefined) as unknown as string,
        }),
      }),
      readSettings: NO_SETTINGS,
    });
    expect(() =>
      registration.deriveProviderOptions({
        threadId: "thr_1",
        projectId: "proj_1",
        model: "m",
        permissionMode: "full",
      }),
    ).toThrow(/experimental_deriveProviderOptions result/);
  });

  it("projects each fork ladder rung onto the two client booleans", () => {
    const projection = (fork: "none" | "tip" | "checkpoint") => {
      const { capabilities } = buildPluginProviderRegistration({
        available: true,
        pluginId: "acme-agent",
        declaration: declaration({
          capabilities: { ...declaration().capabilities, fork },
        }),
        readSettings: NO_SETTINGS,
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
        capabilities: {
          ...declaration().capabilities,
          supportsServiceTier: false,
        },
      }),
      readSettings: NO_SETTINGS,
    });

    expect(registration.info.logoUrl).toBeNull();
    expect(registration.info.composerActions).toStrictEqual([
      { kind: "skills", trigger: "/" },
    ]);
    // No service tier → no tier options at all, not an empty list.
    expect(registration.info.serviceTiers).toBeUndefined();
  });
});

function standardSchema() {
  return {
    version: 1 as const,
    vendor: "test",
    validate: (value: unknown) => ({ value }),
  };
}
