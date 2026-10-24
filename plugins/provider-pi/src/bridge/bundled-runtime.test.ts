import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bundledPiInstallCommand,
  configurePiBundledRuntime,
  resetPiBundledRuntimeForTests,
} from "./bundled-runtime.js";

describe("Pi install on bb's own runtime", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-pi-node-shim-"));
  });

  afterEach(async () => {
    resetPiBundledRuntimeForTests();
    await fs.rm(root, { force: true, recursive: true });
  });

  it("lets dependency install scripts run `node` when no Node.js is on PATH", async () => {
    const fakeNpm = path.join(root, "fake-npm-cli.js");
    await fs.writeFile(
      fakeNpm,
      [
        'const { spawnSync } = require("node:child_process");',
        'const result = spawnSync("node", ["-e", "process.stdout.write(\'from-node\')"], { shell: process.platform === "win32", encoding: "utf8" });',
        'process.stdout.write(`status=${result.status} out=${result.stdout ?? ""} argv=${process.argv.slice(2).join(",")}`);',
      ].join("\n"),
    );
    const emptyPath = path.join(root, "empty-path");
    await fs.mkdir(emptyPath);
    configurePiBundledRuntime({ dataDir: root, npmCli: fakeNpm });

    const install = bundledPiInstallCommand();
    expect(install).not.toBeNull();
    if (install === null) return;
    const run = spawnSync(install.command, install.args, {
      encoding: "utf8",
      env: { ...process.env, PATH: emptyPath, Path: emptyPath },
    });

    expect(run.stdout).toContain("status=0 out=from-node");
    expect(run.stdout).toContain("argv=install,--global");
  });

  it("keeps `node` working when bb's runtime lives under a non-ASCII path with %", async () => {
    const runtimeDir = path.join(root, "Jösé 100%");
    await fs.mkdir(runtimeDir);
    const runtime = path.join(runtimeDir, path.basename(process.execPath));
    await fs.copyFile(process.execPath, runtime);
    await fs.chmod(runtime, 0o755);
    const fakeNpm = path.join(root, "fake-npm-cli.js");
    await fs.writeFile(
      fakeNpm,
      [
        'const { spawnSync } = require("node:child_process");',
        'const result = spawnSync("node", ["-e", "process.stdout.write(\'from-node\')"], { shell: process.platform === "win32", encoding: "utf8" });',
        'process.stdout.write(`status=${result.status} out=${result.stdout ?? ""}`);',
      ].join("\n"),
    );
    const emptyPath = path.join(root, "empty-path");
    await fs.mkdir(emptyPath);
    configurePiBundledRuntime({ dataDir: root, npmCli: fakeNpm });

    const install = bundledPiInstallCommand();
    expect(install).not.toBeNull();
    if (install === null) return;
    const run = spawnSync(runtime, install.args, {
      encoding: "utf8",
      env: { ...process.env, PATH: emptyPath, Path: emptyPath },
    });

    expect(run.stdout).toContain("status=0 out=from-node");
  });
});
