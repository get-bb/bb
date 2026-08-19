import { describe, expect, it, vi } from "vitest";
import { defaultAppSettings, defaultExperiments } from "@bb/domain";
import {
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
      ["settings", "general", "showUnhandledProviderEvents", "true"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, showUnhandledProviderEvents: true },
    });
  });

  // Keys and value shapes come from `appSettingsSchema`, so non-boolean and
  // nullable preferences are settable without a per-key branch in the command.
  it("sets a nullable setting and rejects an unknown key", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          onboardingCompletedAt: "2026-08-06T00:00:00.000Z",
        },
        experiments: defaultExperiments,
      })),
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "general", "onboardingCompletedAt", "null"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, onboardingCompletedAt: null },
    });

    // "2026" reads as JSON, but this setting takes a string, so the raw text
    // has to win: the setting's own schema decides which reading applies.
    await runCommand(
      ["settings", "general", "onboardingCompletedAt", "2026"],
      register,
    );

    expect(put).toHaveBeenLastCalledWith({
      json: { ...defaultAppSettings, onboardingCompletedAt: "2026" },
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

  it("enables new onboarding before replaying the setup guide", async () => {
    const updateExperiments = vi.fn(async ({ json }) => json);
    const updateGeneralSettings = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: {
          ...defaultAppSettings,
          onboardingCompletedAt: "2026-08-06T00:00:00.000Z",
        },
        experiments: defaultExperiments,
      })),
      "v1.settings.experiments.$put": updateExperiments,
      "v1.settings.general.$put": updateGeneralSettings,
    });

    await runCommand(["settings", "replay-onboarding"], register);

    expect(updateExperiments).toHaveBeenCalledWith({
      json: { ...defaultExperiments, newOnboarding: true },
    });
    expect(updateGeneralSettings).toHaveBeenCalledWith({
      json: { ...defaultAppSettings, onboardingCompletedAt: null },
    });
    expect(console.log).toHaveBeenCalledWith(
      "New onboarding is enabled; onboarding will show again",
    );
  });

  it("reports both replay side effects as JSON", async () => {
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.experiments.$put": vi.fn(async ({ json }) => json),
      "v1.settings.general.$put": vi.fn(async ({ json }) => json),
    });

    await runCommand(["settings", "replay-onboarding", "--json"], register);

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify(
        {
          experiments: { ...defaultExperiments, newOnboarding: true },
          generalSettings: {
            ...defaultAppSettings,
            onboardingCompletedAt: null,
          },
        },
        null,
        2,
      ),
    );
  });

  it("reads usage from a selected machine", async () => {
    const getUsage = vi.fn(async () => ({
      codex: { status: "unauthenticated" },
      claudeCode: { status: "unauthenticated" },
      cursor: { status: "unauthenticated" },
    }));
    stubServerApi({
      "v1.hosts.$get": vi.fn(async () => [
        {
          id: "host-remote",
          name: "builder",
          type: "persistent",
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
