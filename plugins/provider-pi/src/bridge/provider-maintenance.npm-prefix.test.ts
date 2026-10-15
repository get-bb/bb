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
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@get-bb/plugin-sdk/provider-bridge", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@get-bb/plugin-sdk/provider-bridge")>();
  return {
    ...original,
    experimental_commandOutput: vi.fn(async () => null),
    experimental_npmLatestVersion: vi.fn(async () => "0.85.0"),
  };
});

vi.mock("./rpc-child.js", () => ({
  resolvePiLaunch: () => ({ command: "pi", args: [] }),
  resolvePiProcessLaunch: () => ({ command: "pi", args: [] }),
}));

import {
  getPiProviderInstallationRun,
  getPiProviderInstallationStatus,
  PI_NPM_PACKAGE,
} from "./provider-maintenance.js";

const temporaryDirectories: string[] = [];
const describeOnPosix = process.platform === "win32" ? describe.skip : describe;

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describeOnPosix("Pi provider maintenance with a custom npm prefix", () => {
  it("updates into the npm prefix that owns the pi on PATH", async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "bb-pi-npm-prefix-")),
    );
    temporaryDirectories.push(root);
    const prefix = path.join(root, "npm-global");
    const packageDir = path.join(prefix, "lib", "node_modules", PI_NPM_PACKAGE);
    const cli = path.join(packageDir, "dist", "cli.js");
    const bin = path.join(prefix, "bin");
    await Promise.all([
      mkdir(path.dirname(cli), { recursive: true }),
      mkdir(bin, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(
        path.join(packageDir, "package.json"),
        JSON.stringify({ name: PI_NPM_PACKAGE, version: "0.84.0" }),
      ),
      writeFile(cli, "#!/bin/sh\necho 0.84.0\n", { mode: 0o755 }),
    ]);
    await symlink(path.relative(bin, cli), path.join(bin, "pi"));
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH ?? ""}`);

    const status = await getPiProviderInstallationStatus();
    const run = await getPiProviderInstallationRun("update");

    const args = [
      "install",
      "-g",
      "--prefix",
      prefix,
      `${PI_NPM_PACKAGE}@latest`,
    ];
    expect(status).toMatchObject({
      executablePath: path.join(bin, "pi"),
      currentVersion: "0.84.0",
      installSource: "npmGlobal",
      npmGlobalPackageVersion: "0.84.0",
      installAction: { kind: "update" },
    });
    expect(status.installAction?.command).toContain(`--prefix ${prefix}`);
    expect(run).toMatchObject({
      available: true,
      command: { command: "npm", args },
    });
  }, 30_000);
});
