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
      async () => "/usr/local/bin/claude",
    ),
    experimental_commandOutput: vi.fn(
      async (_command: string, args: string[]) => {
        if (args[0] === "--version") return "2.1.0 (Claude Code)";
        if (args.includes("dist-tags")) {
          return JSON.stringify({ latest: "2.2.0", stable: "2.2.0" });
        }
        if (args[0] === "doctor") {
          return "Running: npm-global\nAuto-update channel: latest\n";
        }
        return null;
      },
    ),
    experimental_probeNpmGlobalPackage: vi.fn(async () => ({
      npmBin: "/usr/local/bin",
      npmGlobalPackageVersion: "2.1.0",
    })),
    experimental_resolvePackageInstaller: vi.fn(
      async () => state.installerResult,
    ),
  };
});

import {
  getClaudeProviderInstallationRun,
  getClaudeProviderInstallationStatus,
} from "./provider-maintenance.js";

const CLAUDE_NPM_PACKAGE = "@anthropic-ai/claude-code";

const miseInstallCommand = {
  command: "mise",
  args: ["use", "-g", "-y", `npm:${CLAUDE_NPM_PACKAGE}@latest`],
  displayCommand: `mise use -g -y npm:${CLAUDE_NPM_PACKAGE}@latest`,
};

const miseUpdateCommand = {
  command: "mise",
  args: ["use", "-g", "-y", `npm:${CLAUDE_NPM_PACKAGE}@2.2.0`],
  displayCommand: `mise use -g -y npm:${CLAUDE_NPM_PACKAGE}@2.2.0`,
};

const npmInstallCommand = {
  command: "npm",
  args: ["install", "-g", `${CLAUDE_NPM_PACKAGE}@latest`],
  displayCommand: `npm install -g ${CLAUDE_NPM_PACKAGE}@latest`,
};

describe("Claude Code provider installation with package manager preference", () => {
  it("reports installSource mise and updates through mise when mise manages the package", async () => {
    state.installerResult = {
      packageManager: "mise",
      source: "mise",
      installCommand: miseInstallCommand,
      updateCommand: miseUpdateCommand,
      shadowingInstall: null,
    };

    const status = await getClaudeProviderInstallationStatus("auto");
    expect(status.installSource).toBe("mise");
    expect(status.shadowingInstall).toBeNull();
    expect(status.installAction).toEqual({
      kind: "update",
      label: "Update",
      command: miseUpdateCommand.displayCommand,
    });

    const run = await getClaudeProviderInstallationRun("auto", "update");
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
        executablePath: "/usr/local/bin/claude",
        removeCommand: `npm uninstall -g ${CLAUDE_NPM_PACKAGE}`,
      },
    };

    const status = await getClaudeProviderInstallationStatus("auto");
    expect(status.installSource).toBe("npmGlobal");
    expect(status.shadowingInstall).toEqual({
      executablePath: "/usr/local/bin/claude",
      removeCommand: `npm uninstall -g ${CLAUDE_NPM_PACKAGE}`,
    });
    expect(status.installAction?.command).toBe(
      miseUpdateCommand.displayCommand,
    );
  });

  it("falls back to claude update when the package manager is forced to npm, even for a mise-observed source", async () => {
    state.installerResult = {
      packageManager: "npm",
      source: "mise",
      installCommand: npmInstallCommand,
      updateCommand: npmInstallCommand,
      shadowingInstall: null,
    };

    const status = await getClaudeProviderInstallationStatus("npm");
    expect(status.installSource).toBe("mise");
    expect(status.installAction).toEqual({
      kind: "update",
      label: "Update",
      command: "claude update",
    });

    const run = await getClaudeProviderInstallationRun("npm", "update");
    expect(run).toMatchObject({
      available: true,
      command: {
        command: "claude",
        args: ["update"],
        displayCommand: "claude update",
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

    const status = await getClaudeProviderInstallationStatus("mise");
    expect(status.installSource).toBe("npmGlobal");
    expect(status.installAction?.command).toBe(
      miseInstallCommand.displayCommand,
    );

    const run = await getClaudeProviderInstallationRun("mise", "update");
    expect(run).toMatchObject({
      available: true,
      command: miseInstallCommand,
    });
  });
});
