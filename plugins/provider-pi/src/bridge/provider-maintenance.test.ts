import { experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  configurePiBundledRuntime,
  resetPiBundledRuntimeForTests,
} from "./bundled-runtime.js";
import {
  describePiVersionProbeFailure,
  getPiProviderInstallationRun,
  getPiProviderInstallationStatus,
} from "./provider-maintenance.js";
import { resolvePiProcessLaunch } from "./rpc-child.js";

describe("describePiVersionProbeFailure", () => {
  it("names execFile's own timeout with the 15 s budget", () => {
    expect(
      describePiVersionProbeFailure(
        Object.assign(new Error("spawn timeout"), {
          killed: true,
          signal: "SIGTERM",
          code: null,
        }),
      ),
    ).toBe("timed out after 15 s");
  });

  it("distinguishes an external SIGTERM from the timeout", () => {
    expect(
      describePiVersionProbeFailure(
        Object.assign(new Error("killed"), {
          killed: false,
          signal: "SIGTERM",
          code: null,
        }),
      ),
    ).toBe("was stopped by SIGTERM before it answered");
  });

  it("reports a non-zero exit and falls back to the message", () => {
    expect(
      describePiVersionProbeFailure(
        Object.assign(new Error("Command failed"), { code: 2, killed: false }),
      ),
    ).toBe("exited with 2");
    expect(describePiVersionProbeFailure(new Error("ENOENT: pi"))).toBe(
      "ENOENT: pi",
    );
  });
});

describe("Pi install prerequisites", () => {
  let binDir: string;

  beforeEach(async () => {
    binDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-pi-no-npm-"));
    vi.stubEnv("PATH", binDir);
    vi.stubEnv("BB_PI_BRIDGE_COMMAND", "");
    vi.spyOn(hostToolchain, "environment").mockImplementation(
      (env = process.env) => ({ ...env }),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(binDir, { force: true, recursive: true });
  });

  it("asks for Node.js instead of offering an npm install that cannot run", async () => {
    const status = await getPiProviderInstallationStatus();

    expect(status.installed).toBe(false);
    expect(status.installAction).toBeNull();
    expect(status.missingPrerequisite).toBe("nodejs");
  });

  it("offers the npm install when npm is available", async () => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    await fs.writeFile(
      path.join(binDir, npm),
      process.platform === "win32"
        ? "@echo off\r\necho 10.9.0\r\n"
        : '#!/bin/sh\necho "10.9.0"\n',
      { mode: 0o755 },
    );

    const status = await getPiProviderInstallationStatus();

    expect(status.installed).toBe(false);
    expect(status.installAction?.kind).toBe("install");
    expect(status.missingPrerequisite).toBeNull();
  });
});

describe("Pi installs on bb's own runtime", () => {
  let root: string;
  let binDir: string;
  let dataDir: string;
  let npmCli: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bb-pi-bundled-"));
    binDir = path.join(root, "bin");
    dataDir = path.join(root, "bridge-data");
    npmCli = path.join(root, "npm", "bin", "npm-cli.js");
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(path.dirname(npmCli), { recursive: true });
    await fs.writeFile(npmCli, 'console.log("0.90.0");\n');
    vi.stubEnv("PATH", binDir);
    vi.stubEnv("BB_PI_BRIDGE_COMMAND", "");
    configurePiBundledRuntime({ dataDir, npmCli });
  });

  afterEach(async () => {
    resetPiBundledRuntimeForTests();
    vi.unstubAllEnvs();
    await fs.rm(root, { force: true, recursive: true });
  });

  it("installs with bb's runtime and bundled npm into a bb-owned prefix when npm is missing", async () => {
    const status = await getPiProviderInstallationStatus();

    expect(status.installed).toBe(false);
    expect(status.missingPrerequisite).toBeNull();
    expect(status.installAction?.kind).toBe("install");

    const run = await getPiProviderInstallationRun("install");
    if (!run.available) throw new Error(run.message);
    expect(run.command.command).toBe(process.execPath);
    expect(run.command.command).not.toMatch(/^npm(\.cmd)?$/u);
    expect(run.command.args[0]).toBe("-e");
    expect(run.command.args).toContain(npmCli);
    expect(run.command.args).toEqual(
      expect.arrayContaining([
        "install",
        "--global",
        "--prefix",
        path.join(dataDir, "pi-npm-global"),
        "@earendil-works/pi-coding-agent@latest",
      ]),
    );
    expect(run.verification).toEqual({ kind: "installed" });
  });

  it("keeps the system npm install when npm is available", async () => {
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    await fs.writeFile(
      path.join(binDir, npm),
      process.platform === "win32"
        ? "@echo off\r\necho 10.9.0\r\n"
        : '#!/bin/sh\necho "10.9.0"\n',
      { mode: 0o755 },
    );

    const run = await getPiProviderInstallationRun("install");

    if (!run.available) throw new Error(run.message);
    expect(run.command.command).toBe(npm);
  });

  it("detects and launches a bb-owned install with bb's runtime", async () => {
    const packageDir =
      process.platform === "win32"
        ? path.join(dataDir, "pi-npm-global", "node_modules")
        : path.join(dataDir, "pi-npm-global", "lib", "node_modules");
    const piDir = path.join(packageDir, "@earendil-works", "pi-coding-agent");
    await fs.mkdir(path.join(piDir, "dist"), { recursive: true });
    await fs.writeFile(
      path.join(piDir, "package.json"),
      JSON.stringify({
        name: "@earendil-works/pi-coding-agent",
        version: "0.90.0",
        type: "module",
        bin: { pi: "dist/cli.js" },
      }),
    );
    const cli = path.join(piDir, "dist", "cli.js");
    await fs.writeFile(
      cli,
      'if (process.argv.includes("--version")) console.log("0.90.0");\n',
    );

    const launch = resolvePiProcessLaunch(process.env);
    expect(launch.command).toBe(process.execPath);
    expect(launch.args.at(-1)).toBe(cli);

    const status = await getPiProviderInstallationStatus();
    expect(status.installed).toBe(true);
    expect(status.executablePath).toBe(cli);
    expect(status.currentVersion).toBe("0.90.0");
    expect(status.latestVersion).toBe("0.90.0");
    expect(status.installAction).toBeNull();
    expect(status.missingPrerequisite).toBeNull();
  });
});
