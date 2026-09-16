import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultExperiments } from "@bb/domain";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerSettingsCommands } from "../../commands/settings.js";

describe("bb settings commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerSettingsCommands(program, () => "http://server");

  it("sets and resets a plugin shortcut while preserving other overrides", async () => {
    const other = { command: "plugin:other/open", shortcut: null };
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        keybindingOverrides: [other],
      })),
      "v1.settings.keyboard.$put": put,
    });
    await runCommand(
      ["settings", "keyboard", "set", "plugin:example/open", "Mod+Shift+I"],
      register,
    );
    expect(put).toHaveBeenLastCalledWith({
      json: [
        other,
        {
          command: "plugin:example/open",
          shortcut: {
            key: "I",
            mod: true,
            meta: false,
            control: false,
            alt: false,
            shift: true,
          },
        },
      ],
    });
    await runCommand(
      ["settings", "keyboard", "reset", "plugin:example/open"],
      register,
    );
    expect(put).toHaveBeenLastCalledWith({ json: [other] });
  });

  const completedTurnProviders = [
    {
      id: "claude-code",
      displayName: "Claude Code",
      completedTurnDisplay: "flat",
    },
    { id: "codex", displayName: "Codex", completedTurnDisplay: "collapse" },
  ];

  it("lists each provider's finished turn display and where it comes from", async () => {
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          providerCompletedTurnDisplay: { codex: "flat" },
        },
        experiments: defaultExperiments,
      })),
      "v1.system.providers.$get": vi.fn(async () => completedTurnProviders),
    });

    await runCommand(["settings", "completed-turns", "--json"], register);

    expect(
      collectLogPayloads(vi.mocked(console.log)).map((payload) =>
        JSON.parse(payload),
      ),
    ).toEqual([
      [
        {
          providerId: "claude-code",
          displayName: "Claude Code",
          completedTurnDisplay: "flat",
          providerDefault: "flat",
          source: "provider-default",
        },
        {
          providerId: "codex",
          displayName: "Codex",
          completedTurnDisplay: "flat",
          providerDefault: "collapse",
          source: "setting",
        },
      ],
    ]);
  });

  it("stores a per-provider override and keeps the other overrides", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          providerCompletedTurnDisplay: { codex: "flat" },
        },
        experiments: defaultExperiments,
      })),
      "v1.system.providers.$get": vi.fn(async () => completedTurnProviders),
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "completed-turns", "claude-code", "collapse"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: {
        ...defaultAppSettings,
        providerCompletedTurnDisplay: {
          codex: "flat",
          "claude-code": "collapse",
        },
      },
    });
    expect(console.log).toHaveBeenCalledWith(
      "claude-code finished turns: collapse (setting)",
    );
  });

  it("removes the override when set back to default", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          providerCompletedTurnDisplay: {
            codex: "flat",
            "claude-code": "collapse",
          },
        },
        experiments: defaultExperiments,
      })),
      "v1.system.providers.$get": vi.fn(async () => completedTurnProviders),
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "completed-turns", "claude-code", "default"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: {
        ...defaultAppSettings,
        providerCompletedTurnDisplay: { codex: "flat" },
      },
    });
    expect(console.log).toHaveBeenCalledWith(
      "claude-code finished turns: flat (provider default)",
    );
  });

  it("rejects an unknown provider or display without writing settings", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.system.providers.$get": vi.fn(async () => completedTurnProviders),
      "v1.settings.general.$put": put,
    });

    await expect(
      runCommand(["settings", "completed-turns", "cursor", "flat"], register),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Unknown provider 'cursor'. Known providers: claude-code, codex.",
      ),
    );

    await expect(
      runCommand(["settings", "completed-turns", "codex", "open"], register),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Invalid finished turn display 'open'. Use collapse, flat, or default.",
      ),
    );
    expect(put).not.toHaveBeenCalled();
  });

  it("updates one general setting while preserving the full contract", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "general", "showDiagnosticEvents", "true"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, showDiagnosticEvents: true },
    });
  });

  it("disables automatic machine Git credentials despite the legacy response alias", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          showUnhandledProviderEvents: false,
        },
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": put,
    });
    await runCommand(
      ["settings", "general", "machineGitCredentialsEnabled", "false"],
      register,
    );
    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, machineGitCredentialsEnabled: false },
    });
  });

  it("rejects an unknown general setting key", async () => {
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": vi.fn(async ({ json }) => json),
    });

    await expect(
      runCommand(["settings", "general", "notASetting", "true"], register),
    ).rejects.toThrow("process.exit:1");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Unknown general setting 'notASetting'"),
    );
  });

  it("updates keyboard hint visibility while preserving the full contract", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": put,
    });

    await runCommand(["settings", "keyboard", "hints", "false"], register);

    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, showKeyboardHints: false },
    });
  });

  it("updates active-thread Enter behavior while preserving the full contract", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "general", "steerActiveThreadOnEnter", "true"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, steerActiveThreadOnEnter: true },
    });
  });

  it("enables the changelog preview experiment", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.experiments.$put": put,
    });

    await runCommand(
      ["settings", "experiment", "changelogPreview", "true"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { ...defaultExperiments, changelogPreview: true },
    });
  });

  it("updates timeline windowing while preserving every experiment", async () => {
    const updateExperiments = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.experiments.$put": updateExperiments,
    });

    await runCommand(
      ["settings", "experiment", "timelineWindowing", "true"],
      register,
    );

    expect(updateExperiments).toHaveBeenCalledWith({
      json: { ...defaultExperiments, timelineWindowing: true },
    });
  });

  it("enables the multi-machine picker experiment", async () => {
    const updateExperiments = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.experiments.$put": updateExperiments,
    });

    await runCommand(
      ["settings", "experiment", "multiMachinePicker", "true"],
      register,
    );

    expect(updateExperiments).toHaveBeenCalledWith({
      json: { ...defaultExperiments, multiMachinePicker: true },
    });
  });

  it("reads usage from a selected machine", async () => {
    const getUsage = vi.fn(async () => ({
      codex: { status: "unauthenticated" },
      "claude-code": { status: "unauthenticated" },
      "acp-cursor": { status: "unauthenticated" },
    }));
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          status: "connected",
          lastSeenAt: 1,
          lastRejectedProtocolVersion: null,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      "v1.system.usage-limits.$get": getUsage,
    });

    await runCommand(
      ["settings", "usage", "--machine", "builder", "--json"],
      register,
    );

    expect(getUsage).toHaveBeenCalledWith({
      query: { hostId: "host-remote" },
    });
  });
});
