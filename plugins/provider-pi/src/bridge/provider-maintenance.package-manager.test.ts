import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  executablePath: "",
  installerResult: null as unknown,
  bunBin: null as string | null,
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@get-bb/plugin-sdk/provider-bridge")>();
  return {
    ...original,
    experimental_resolveExecutablePath: vi.fn(async () => state.executablePath),
    experimental_commandOutput: vi.fn(async () => state.bunBin),
    experimental_npmLatestVersion: vi.fn(async () => "0.95.0"),
    experimental_probeNpmGlobalPackage: vi.fn(async () => ({
      npmBin: "/usr/local/bin",
      npmGlobalPackageVersion: "0.90.0",
    })),
    experimental_resolvePackageInstaller: vi.fn(
      async () => state.installerResult,
    ),
  };
});

vi.mock("./rpc-child.js", () => ({
  resolvePiLaunch: () => ({ command: state.executablePath, args: [] }),
}));

import {
  getPiInstallGate,
  getPiProviderInstallationRun,
  getPiProviderInstallationStatus,
  resetPiInstallGateForTests,
} from "./provider-maintenance.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  resetPiInstallGateForTests();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function writePiExecutable(version: string): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "bb-pi-installer-"));
  temporaryDirectories.push(root);
  await mkdir(path.join(root, "bin"), { recursive: true });
  state.executablePath = path.join(root, "bin", "pi");
  await writeFile(state.executablePath, `#!/bin/sh\nprintf '${version}\\n'\n`, {
    mode: 0o755,
  });
  await chmod(state.executablePath, 0o755);
}

const miseInstallCommand = {
  command: "mise",
  args: ["use", "-g", "-y", "npm:@earendil-works/pi-coding-agent@latest"],
  displayCommand: "mise use -g -y npm:@earendil-works/pi-coding-agent@latest",
};

const miseUpdateCommand = {
  command: "mise",
  args: ["use", "-g", "-y", "npm:@earendil-works/pi-coding-agent@0.95.0"],
  displayCommand: "mise use -g -y npm:@earendil-works/pi-coding-agent@0.95.0",
};

const npmInstallCommand = {
  command: "npm",
  args: ["install", "-g", "@earendil-works/pi-coding-agent@latest"],
  displayCommand: "npm install -g @earendil-works/pi-coding-agent@latest",
};

describe("Pi provider installation with package manager preference", () => {
  it("reports installSource mise and updates through mise when mise manages the package", async () => {
    await writePiExecutable("0.90.0");
    state.bunBin = null;
    state.installerResult = {
      packageManager: "mise",
      source: "mise",
      installCommand: miseInstallCommand,
      updateCommand: miseUpdateCommand,
      shadowingInstall: null,
    };

    const status = await getPiProviderInstallationStatus("auto");
    expect(status.installSource).toBe("mise");
    expect(status.shadowingInstall).toBeNull();
    expect(status.installAction).toEqual({
      kind: "update",
      label: "Update",
      command: miseUpdateCommand.displayCommand,
    });

    const run = await getPiProviderInstallationRun("auto", "update");
    expect(run).toMatchObject({
      available: true,
      command: miseUpdateCommand,
    });
  });

  it("reports a shadowingInstall removeCommand when a stray npm global shadows a mise-managed package", async () => {
    await writePiExecutable("0.90.0");
    state.bunBin = null;
    state.installerResult = {
      packageManager: "mise",
      source: "npmGlobal",
      installCommand: miseInstallCommand,
      updateCommand: miseUpdateCommand,
      shadowingInstall: {
        executablePath: state.executablePath,
        removeCommand: "npm uninstall -g @earendil-works/pi-coding-agent",
      },
    };

    const status = await getPiProviderInstallationStatus("auto");
    expect(status.installSource).toBe("npmGlobal");
    expect(status.shadowingInstall).toEqual({
      executablePath: state.executablePath,
      removeCommand: "npm uninstall -g @earendil-works/pi-coding-agent",
    });
    expect(status.installAction?.command).toBe(
      miseUpdateCommand.displayCommand,
    );
  });

  it("falls back to the npm command when the package manager is forced to npm, even for a mise-observed source and no Bun wrapper", async () => {
    await writePiExecutable("0.90.0");
    state.bunBin = null;
    state.installerResult = {
      packageManager: "npm",
      source: "mise",
      installCommand: npmInstallCommand,
      updateCommand: npmInstallCommand,
      shadowingInstall: null,
    };

    const status = await getPiProviderInstallationStatus("npm");
    expect(status.installSource).toBe("mise");
    expect(status.installAction?.command).toBe(
      npmInstallCommand.displayCommand,
    );

    const run = await getPiProviderInstallationRun("npm", "update");
    expect(run).toMatchObject({
      available: true,
      command: npmInstallCommand,
    });
  });

  it("uses npm when the package manager is forced to npm, even for a Bun-managed Pi", async () => {
    await writePiExecutable("0.90.0");
    state.bunBin = path.dirname(state.executablePath);
    state.installerResult = {
      packageManager: "npm",
      source: "npmGlobal",
      installCommand: npmInstallCommand,
      updateCommand: npmInstallCommand,
      shadowingInstall: null,
    };

    const status = await getPiProviderInstallationStatus("npm");
    expect(status.installAction?.command).toBe(
      npmInstallCommand.displayCommand,
    );
    expect(await getPiProviderInstallationRun("npm", "update")).toMatchObject({
      available: true,
      command: npmInstallCommand,
    });

    const autoStatus = await getPiProviderInstallationStatus("auto");
    expect(autoStatus.installAction?.command).toBe(
      "bun add -g @earendil-works/pi-coding-agent@latest",
    );
  });

  it("names the mise command in install guidance when mise manages Pi", async () => {
    await writePiExecutable("0.80.0");
    state.bunBin = null;
    state.installerResult = {
      packageManager: "mise",
      source: "mise",
      installCommand: miseInstallCommand,
      updateCommand: miseUpdateCommand,
      shadowingInstall: null,
    };

    const gate = await getPiInstallGate();
    expect(gate).toMatchObject({
      ok: false,
      status: "unsupported_version",
      statusMessage: expect.stringMatching(
        /or newer: mise use -g -y npm:@earendil-works\/pi-coding-agent@latest$/u,
      ),
    });
  });

  it("names the Bun command in install guidance when Bun manages Pi", async () => {
    await writePiExecutable("0.80.0");
    state.bunBin = path.dirname(state.executablePath);
    state.installerResult = {
      packageManager: "npm",
      source: "npmGlobal",
      installCommand: npmInstallCommand,
      updateCommand: npmInstallCommand,
      shadowingInstall: null,
    };

    const gate = await getPiInstallGate();
    expect(gate).toMatchObject({
      ok: false,
      statusMessage: expect.stringMatching(
        /or newer: bun add -g @earendil-works\/pi-coding-agent@latest$/u,
      ),
    });
  });

  it("forces mise for install and update even when the executable is not yet mise-managed", async () => {
    await writePiExecutable("0.90.0");
    state.bunBin = null;
    state.installerResult = {
      packageManager: "mise",
      source: "npmGlobal",
      installCommand: miseInstallCommand,
      updateCommand: miseInstallCommand,
      shadowingInstall: null,
    };

    const status = await getPiProviderInstallationStatus("mise");
    expect(status.installSource).toBe("npmGlobal");
    expect(status.installAction?.command).toBe(
      miseInstallCommand.displayCommand,
    );

    const run = await getPiProviderInstallationRun("mise", "update");
    expect(run).toMatchObject({
      available: true,
      command: miseInstallCommand,
    });
  });
});
