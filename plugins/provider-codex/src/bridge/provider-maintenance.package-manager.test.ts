import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  installerResult: null as unknown,
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@get-bb/plugin-sdk/provider-bridge")>();
  return {
    ...original,
    experimental_resolveExecutablePath: vi.fn(
      async () => "/usr/local/bin/codex",
    ),
    experimental_commandOutput: vi.fn(async () => "codex-cli 1.0.0"),
    experimental_npmLatestVersion: vi.fn(async () => "1.1.0"),
    experimental_probeNpmGlobalPackage: vi.fn(async () => ({
      npmBin: "/usr/local/bin",
      npmGlobalPackageVersion: "1.0.0",
    })),
    experimental_resolvePackageInstaller: vi.fn(
      async () => state.installerResult,
    ),
  };
});

import {
  getCodexProviderInstallationRun,
  getCodexProviderInstallationStatus,
} from "./provider-maintenance.js";

const miseInstallCommand = {
  command: "mise",
  args: ["use", "-g", "-y", "npm:@openai/codex@latest"],
  displayCommand: "mise use -g -y npm:@openai/codex@latest",
};

const miseUpdateCommand = {
  command: "mise",
  args: ["use", "-g", "-y", "npm:@openai/codex@1.1.0"],
  displayCommand: "mise use -g -y npm:@openai/codex@1.1.0",
};

const npmInstallCommand = {
  command: "npm",
  args: ["install", "-g", "@openai/codex@latest"],
  displayCommand: "npm install -g @openai/codex@latest",
};

describe("Codex provider installation with package manager preference", () => {
  it("reports installSource mise and updates through mise when mise manages the package", async () => {
    state.installerResult = {
      packageManager: "mise",
      source: "mise",
      installCommand: miseInstallCommand,
      updateCommand: miseUpdateCommand,
      shadowingInstall: null,
    };

    const status = await getCodexProviderInstallationStatus("auto");
    expect(status.installSource).toBe("mise");
    expect(status.shadowingInstall).toBeNull();
    expect(status.installAction).toEqual({
      kind: "update",
      label: "Update",
      command: "mise use -g -y npm:@openai/codex@1.1.0",
    });

    const run = await getCodexProviderInstallationRun("auto", "update");
    expect(run).toMatchObject({
      available: true,
      command: miseUpdateCommand,
    });
  });

  it("reports a shadowingInstall removeCommand when a stray npm global shadows a mise-managed package", async () => {
    state.installerResult = {
      packageManager: "mise",
      source: "npmGlobal",
      installCommand: miseInstallCommand,
      updateCommand: miseUpdateCommand,
      shadowingInstall: {
        executablePath: "/usr/local/bin/codex",
        removeCommand: "npm uninstall -g @openai/codex",
      },
    };

    const status = await getCodexProviderInstallationStatus("auto");
    expect(status.installSource).toBe("npmGlobal");
    expect(status.shadowingInstall).toEqual({
      executablePath: "/usr/local/bin/codex",
      removeCommand: "npm uninstall -g @openai/codex",
    });
    expect(status.installAction?.command).toBe(
      "mise use -g -y npm:@openai/codex@1.1.0",
    );
  });

  it("falls back to codex update when the package manager is forced to npm, even for a mise-observed source", async () => {
    state.installerResult = {
      packageManager: "npm",
      source: "mise",
      installCommand: npmInstallCommand,
      updateCommand: npmInstallCommand,
      shadowingInstall: null,
    };

    const status = await getCodexProviderInstallationStatus("npm");
    expect(status.installSource).toBe("mise");
    expect(status.installAction).toEqual({
      kind: "update",
      label: "Update",
      command: "codex update",
    });

    const run = await getCodexProviderInstallationRun("npm", "update");
    expect(run).toMatchObject({
      available: true,
      command: {
        command: "codex",
        args: ["update"],
        displayCommand: "codex update",
      },
    });
  });

  it("forces mise for install and update even when the executable is not yet mise-managed", async () => {
    state.installerResult = {
      packageManager: "mise",
      source: "npmGlobal",
      installCommand: miseInstallCommand,
      updateCommand: miseInstallCommand,
      shadowingInstall: null,
    };

    const status = await getCodexProviderInstallationStatus("mise");
    expect(status.installSource).toBe("npmGlobal");
    expect(status.installAction?.command).toBe(
      "mise use -g -y npm:@openai/codex@latest",
    );

    const run = await getCodexProviderInstallationRun("mise", "update");
    expect(run).toMatchObject({
      available: true,
      command: miseInstallCommand,
    });
  });
});
