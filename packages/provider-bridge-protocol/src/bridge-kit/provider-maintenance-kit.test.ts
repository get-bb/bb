import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareVersions,
  formatCommand,
  installationVerification,
  npmGlobalInstallSource,
  readCliVersion,
  versionFrom,
} from "./provider-maintenance-kit.js";

describe("provider maintenance kit", () => {
  it.skipIf(process.platform === "win32")(
    "reads the version of a CLI that keeps reading stdin until EOF",
    async () => {
      const dir = await mkdtemp(path.join(tmpdir(), "bb-cli-version-"));
      try {
        const executable = path.join(dir, "stdio-server-cli");
        await writeFile(
          executable,
          '#!/bin/sh\ncat >/dev/null\necho "tool 1.2.3"\n',
        );
        await chmod(executable, 0o755);
        expect(await readCliVersion(executable)).toBe("1.2.3");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    15_000,
  );

  it("compares the numeric core of CLI versions, prerelease below release", () => {
    expect(compareVersions("0.135.9", "0.136.0")).toBeLessThan(0);
    expect(compareVersions("0.136.0-beta.1", "0.136.0")).toBeLessThan(0);
    expect(compareVersions("0.136.0", "0.136.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.136.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it.each([
    ["1.0.0-alpha", "1.0.0-alpha.1"],
    ["1.0.0-alpha.1", "1.0.0-alpha.beta"],
    ["1.0.0-alpha.beta", "1.0.0-beta"],
    ["1.0.0-beta", "1.0.0-beta.2"],
    ["1.0.0-beta.2", "1.0.0-beta.11"],
    ["1.0.0-beta.9", "1.0.0-beta.10"],
    ["1.0.0-beta.11", "1.0.0-rc.1"],
    ["1.0.0-rc.2", "1.0.0-rc.10"],
    ["1.0.0-rc.10", "1.0.0"],
    ["1.0.0-9", "1.0.0-alpha"],
    ["1.0.0-B", "1.0.0-a"],
    ["1.0.0-alpha.2", "1.0.0-alpha.2.1"],
    ["1.0.0", "1.0.1-alpha"],
  ])("orders %s below %s in both directions", (older, newer) => {
    expect(compareVersions(older, newer)).toBeLessThan(0);
    expect(compareVersions(newer, older)).toBeGreaterThan(0);
    expect(compareVersions(older, older)).toBe(0);
  });

  it("ignores build metadata for precedence", () => {
    expect(compareVersions("1.0.0+build.9", "1.0.0+build.10")).toBe(0);
    expect(compareVersions("1.0.0-beta.2+x", "1.0.0-beta.2+y")).toBe(0);
    expect(compareVersions("1.0.0-beta.9+x", "1.0.0-beta.10+y")).toBeLessThan(
      0,
    );
  });

  it.each([
    "not-a-version",
    "",
    "1.0",
    "1.0.0.1",
    "01.0.0",
    "1.0.0-beta.01",
    "1.0.0-beta..1",
    "1.0.0-",
    "1.0.0+",
    "tool 1.0.0",
    "1.0.0 trailing",
  ])("rejects invalid version %j in either operand", (invalid) => {
    expect(() => compareVersions(invalid, "0.0.0")).toThrow(TypeError);
    expect(() => compareVersions("0.0.0", invalid)).toThrow(TypeError);
  });

  it("reads the version out of a CLI banner", () => {
    expect(versionFrom("codex-cli 0.150.0")).toBe("0.150.0");
    expect(versionFrom("v2.1.0-beta.3\n")).toBe("2.1.0-beta.3");
    expect(versionFrom("no version here")).toBeNull();
    expect(versionFrom(null)).toBeNull();
  });

  it("quotes only the arguments a shell would mangle", () => {
    expect(
      formatCommand("npm", ["install", "-g", "@openai/codex@latest"]),
    ).toBe("npm install -g @openai/codex@latest");
    expect(formatCommand("sh", ["-c", "echo 'hi' && ls"])).toBe(
      "sh -c 'echo '\\''hi'\\'' && ls'",
    );
  });

  it("attributes an executable inside npm's global bin to npm", () => {
    const npmBin = path.join(path.sep, "usr", "local", "bin");
    expect(
      npmGlobalInstallSource({
        installed: true,
        executablePath: path.join(npmBin, "codex"),
        npmBin,
      }),
    ).toBe("npmGlobal");
    expect(
      npmGlobalInstallSource({
        installed: true,
        executablePath: path.join(path.sep, "opt", "homebrew", "bin", "codex"),
        npmBin,
      }),
    ).toBe("external");
    expect(
      npmGlobalInstallSource({ installed: true, executablePath: null, npmBin }),
    ).toBe("external");
    expect(
      npmGlobalInstallSource({
        installed: false,
        executablePath: null,
        npmBin: null,
      }),
    ).toBe("notInstalled");
  });

  it("verifies an update against the latest version, or a change when the registry was unreachable", () => {
    expect(
      installationVerification(
        { currentVersion: "1.0.0", latestVersion: "1.1.0" },
        "update",
      ),
    ).toEqual({ kind: "version_at_least", version: "1.1.0" });
    expect(
      installationVerification(
        { currentVersion: "1.0.0", latestVersion: null },
        "update",
      ),
    ).toEqual({ kind: "version_changed", previousVersion: "1.0.0" });
    expect(
      installationVerification(
        { currentVersion: null, latestVersion: null },
        "install",
      ),
    ).toEqual({ kind: "installed" });
  });
});
