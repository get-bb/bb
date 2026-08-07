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

  it("updates one general setting without sending stale values", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "general", "showUnhandledProviderEvents", "true"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { showUnhandledProviderEvents: true },
    });
  });

  it("updates keyboard hint visibility without sending stale values", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.settings.general.$put": put,
    });

    await runCommand(["settings", "keyboard", "hints", "false"], register);

    expect(put).toHaveBeenCalledWith({
      json: { showKeyboardHints: false },
    });
  });

  it("updates active-thread Enter behavior without sending stale values", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "general", "steerActiveThreadOnEnter", "true"],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { steerActiveThreadOnEnter: true },
    });
  });

  it("sets only the selected buffer font", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.settings.general.$put": put,
    });

    await runCommand(
      ["settings", "font", "set", "buffer", '"Berkeley Mono", monospace'],
      register,
    );

    expect(put).toHaveBeenCalledWith({
      json: { bufferFontFamily: '"Berkeley Mono", monospace' },
    });
  });

  it("resets only the selected UI font", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.settings.general.$put": put,
    });

    await runCommand(["settings", "font", "reset", "ui"], register);

    expect(put).toHaveBeenCalledWith({
      json: { uiFontFamily: "" },
    });
  });

  it("updates the Tools Hub experiment while preserving other flags", async () => {
    const put = vi.fn(async ({ json }) => json);
    stubServerApi({
      "v1.system.config.$get": vi.fn(async () => ({
        generalSettings: defaultAppSettings,
        experiments: defaultExperiments,
      })),
      "v1.settings.experiments.$put": put,
    });

    await runCommand(["settings", "experiment", "toolsHub", "true"], register);

    expect(put).toHaveBeenCalledWith({
      json: { ...defaultExperiments, toolsHub: true },
    });
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
