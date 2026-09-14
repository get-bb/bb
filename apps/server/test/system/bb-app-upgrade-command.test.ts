import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MiseKitIo } from "@bb/provider-bridge-protocol/bridge-kit";
import { afterEach, describe, expect, it } from "vitest";
import {
  MISE_UPGRADE_COMMAND,
  NPM_UPGRADE_COMMAND,
  resolveBbAppUpgradeCommand,
} from "../../src/services/system/bb-app-upgrade-command.js";

const MISE_BINARY = "/opt/homebrew/bin/mise";
const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createBbAppPackage(root: string): Promise<string> {
  const packageRoot = join(root, "lib", "node_modules", "bb-app");
  const bundleDir = join(packageRoot, "apps", "server", "dist");
  await mkdir(bundleDir, { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: "bb-app", version: "1.0.0" }),
  );
  const bundlePath = join(bundleDir, "index.js");
  await writeFile(bundlePath, "");
  return bundlePath;
}

function createMiseIo(args: {
  miseInstalled: boolean;
  installPath: string | null;
}): MiseKitIo {
  return {
    async commandStdout(command, commandArgs) {
      if (command !== MISE_BINARY || args.installPath === null) return null;
      expect(commandArgs).toEqual(["-y", "ls", "--json", "npm:bb-app"]);
      return JSON.stringify([
        {
          version: "1.0.0",
          requested_version: "latest",
          install_path: args.installPath,
          installed: true,
          active: true,
        },
      ]);
    },
    async isExecutable(filePath) {
      return args.miseInstalled && filePath === MISE_BINARY;
    },
    async realpath(filePath) {
      return filePath;
    },
    env: {},
    homeDir: "/Users/test",
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true })));
});

describe("resolveBbAppUpgradeCommand", () => {
  it("forces the npm command when the preference is npm", async () => {
    const installRoot = await createTempDir("bb-upgrade-npm-");
    const bundlePath = await createBbAppPackage(installRoot);
    await expect(
      resolveBbAppUpgradeCommand({
        packageManager: "npm",
        pathEnv: undefined,
        bundlePath,
        io: createMiseIo({ miseInstalled: true, installPath: installRoot }),
      }),
    ).resolves.toBe(NPM_UPGRADE_COMMAND);
  });

  it("forces the mise command when the preference is mise", async () => {
    await expect(
      resolveBbAppUpgradeCommand({
        packageManager: "mise",
        pathEnv: undefined,
        bundlePath: "/tmp/not-bb-app/index.js",
        io: createMiseIo({ miseInstalled: false, installPath: null }),
      }),
    ).resolves.toBe(MISE_UPGRADE_COMMAND);
  });

  it("uses the mise command when auto finds bb-app inside the mise install", async () => {
    const installRoot = await createTempDir("bb-upgrade-managed-");
    const bundlePath = await createBbAppPackage(installRoot);
    await expect(
      resolveBbAppUpgradeCommand({
        packageManager: "auto",
        pathEnv: undefined,
        bundlePath,
        io: createMiseIo({ miseInstalled: true, installPath: installRoot }),
      }),
    ).resolves.toBe(MISE_UPGRADE_COMMAND);
  });

  it("uses the npm command when auto finds bb-app outside the mise install", async () => {
    const installRoot = await createTempDir("bb-upgrade-unmanaged-");
    const miseRoot = await createTempDir("bb-upgrade-mise-root-");
    const bundlePath = await createBbAppPackage(installRoot);
    await expect(
      resolveBbAppUpgradeCommand({
        packageManager: "auto",
        pathEnv: undefined,
        bundlePath,
        io: createMiseIo({ miseInstalled: true, installPath: miseRoot }),
      }),
    ).resolves.toBe(NPM_UPGRADE_COMMAND);
  });

  it("uses the npm command when auto finds no mise binary", async () => {
    const installRoot = await createTempDir("bb-upgrade-no-mise-");
    const bundlePath = await createBbAppPackage(installRoot);
    await expect(
      resolveBbAppUpgradeCommand({
        packageManager: "auto",
        pathEnv: undefined,
        bundlePath,
        io: createMiseIo({ miseInstalled: false, installPath: installRoot }),
      }),
    ).resolves.toBe(NPM_UPGRADE_COMMAND);
  });
});
