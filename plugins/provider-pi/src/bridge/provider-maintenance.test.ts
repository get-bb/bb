import { experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describePiVersionProbeFailure,
  getPiProviderInstallationStatus,
  getPiProviderInstallationRun,
} from "./provider-maintenance.js";

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

describe("Pi installation without npm", () => {
  let binDir: string;

  beforeEach(async () => {
    binDir = await fs.mkdtemp(path.join(os.tmpdir(), "bb-pi-no-npm-"));
    vi.stubEnv("PATH", binDir);
    vi.stubEnv("HOME", binDir);
    vi.stubEnv("USERPROFILE", binDir);
    vi.stubEnv("BB_PI_BRIDGE_COMMAND", "");
    const npmCli = path.join(binDir, "npm-cli.js");
    await fs.writeFile(npmCli, 'console.log("1.4.0")');
    vi.spyOn(hostToolchain, "refresh").mockResolvedValue();
    vi.spyOn(hostToolchain, "bundledNpmCli").mockReturnValue(npmCli);
    vi.spyOn(hostToolchain, "environment").mockImplementation(
      (env = process.env) => ({ ...env }),
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(binDir, { force: true, recursive: true });
  });

  it("offers a private install through bb runtime when npm is absent", async () => {
    const status = await getPiProviderInstallationStatus();

    expect(status.installed).toBe(false);
    expect(status.installAction?.kind).toBe("install");
    const run = await getPiProviderInstallationRun("install");
    expect(run.available).toBe(true);
    if (!run.available) throw new Error("Expected installation command");
    expect(run.command.command).toBe(hostToolchain.node());
    expect(run.command.displayCommand).toContain(hostToolchain.bundledNpmCli());
    expect(run.command.displayCommand).toContain("--prefix");
    expect(run.command.displayCommand).toContain("--ignore-scripts");
  });

  it("still offers Install when npm is available", async () => {
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
  });
});
