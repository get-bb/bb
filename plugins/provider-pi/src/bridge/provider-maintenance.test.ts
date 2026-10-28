import { experimental_hostToolchain as hostToolchain } from "@get-bb/plugin-sdk/process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describePiVersionProbeFailure,
  getPiProviderInstallationStatus,
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
