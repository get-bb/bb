import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { experimental_npmGlobalInstallCommand as npmGlobalInstallCommand } from "@get-bb/plugin-sdk/provider-bridge";
import { afterEach, describe, expect, it, vi } from "vitest";

const probeState = vi.hoisted(() => ({
  executablePath: "",
  npmBin: "",
  version: "1.4.0",
}));

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@get-bb/plugin-sdk/provider-bridge")>();
  return {
    ...original,
    experimental_commandOutput: vi.fn(async () => null),
    experimental_npmLatestVersion: vi.fn(async () => "1.5.0"),
    experimental_probeNpmGlobalPackage: vi.fn(async () => ({
      npmBin: probeState.npmBin,
      npmGlobalPackageVersion: null,
    })),
    experimental_resolveExecutablePath: vi.fn(
      async () => probeState.executablePath,
    ),
  };
});

vi.mock("@get-bb/plugin-sdk/process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@get-bb/plugin-sdk/process")>()),
  experimental_execHostFile: vi.fn(async () => ({
    stdout: `${probeState.version}\n`,
    stderr: "",
  })),
}));

vi.mock("./rpc-child.js", () => ({
  resolvePiLaunch: () => ({ command: "pi", args: [] }),
}));

import {
  getPiInstallGate,
  getPiProviderInstallationRun,
  getPiProviderInstallationStatus,
  resetPiInstallGateForTests,
} from "./provider-maintenance.js";

const temporaryDirectories: string[] = [];
const itOnPosix = process.platform === "win32" ? it.skip : it;
const launcherName = process.platform === "win32" ? "pi.cmd" : "pi";

afterEach(async () => {
  resetPiInstallGateForTests();
  probeState.version = "1.4.0";
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function managedInstall(layout = "releases-v1") {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "bb-pi-managed-")),
  );
  temporaryDirectories.push(root);
  const agentBin = path.join(root, ".pi", "agent", "bin");
  const installRoot = path.join(root, ".pi", "agent", "install");
  await Promise.all([
    mkdir(agentBin, { recursive: true }),
    mkdir(installRoot, { recursive: true }),
  ]);
  const launcher = path.join(agentBin, launcherName);
  await Promise.all([
    writeFile(launcher, ""),
    writeFile(
      path.join(installRoot, "managed-install.json"),
      `﻿${JSON.stringify({ kind: "pi-managed-install", schemaVersion: 1, layout })}`,
    ),
  ]);
  return { root, agentBin, launcher };
}

async function offeredUpdate() {
  const status = await getPiProviderInstallationStatus();
  const run = await getPiProviderInstallationRun("update");
  return {
    action: status.installAction,
    command: run.available ? run.command : null,
  };
}

const selfUpdate = {
  action: { kind: "update", label: "Update", command: "pi update --self" },
  command: {
    command: "pi",
    args: ["update", "--self"],
    displayCommand: "pi update --self",
  },
};

const npmInstall = npmGlobalInstallCommand("@earendil-works/pi-coding-agent");
const npmUpdate = {
  action: {
    kind: "update",
    label: "Update",
    command: npmInstall.displayCommand,
  },
  command: npmInstall,
};

describe("Pi provider update command by install source", () => {
  it("updates a managed install with pi update even when its bin directory is npm's", async () => {
    const install = await managedInstall();
    probeState.executablePath = install.launcher;
    probeState.npmBin = install.agentBin;

    expect(await offeredUpdate()).toMatchObject(selfUpdate);
  });

  itOnPosix(
    "follows the installer's PATH symlink to the managed launcher",
    async () => {
      const install = await managedInstall();
      const localBin = path.join(install.root, ".local", "bin");
      await mkdir(localBin, { recursive: true });
      probeState.executablePath = path.join(localBin, "pi");
      await symlink(
        path.relative(localBin, install.launcher),
        probeState.executablePath,
      );
      probeState.npmBin = localBin;

      expect(await offeredUpdate()).toMatchObject(selfUpdate);
    },
  );

  it("keeps npm for a pi in npm's bin directory without a valid managed marker", async () => {
    const install = await managedInstall("releases-v2");
    probeState.executablePath = install.launcher;
    probeState.npmBin = install.agentBin;

    expect(await offeredUpdate()).toMatchObject(npmUpdate);
  });

  it("lets Pi update an install bb cannot classify instead of adding an npm copy", async () => {
    const install = await managedInstall("releases-v2");
    probeState.executablePath = install.launcher;
    probeState.npmBin = path.join(install.root, "npm", "bin");

    expect(await offeredUpdate()).toMatchObject(selfUpdate);
  });

  it("points an unsupported managed install at pi update", async () => {
    const install = await managedInstall();
    probeState.executablePath = install.launcher;
    probeState.version = "0.83.0";

    expect(await getPiInstallGate()).toMatchObject({
      ok: false,
      status: "unsupported_version",
      statusMessage:
        "Pi 0.83.0 is older than the supported minimum 0.84.0. Update Pi to 0.84.0 or newer: pi update --self",
    });
  });
});
