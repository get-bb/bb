import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  downloadedInstallerCommand,
  formatCommand,
  installationVerification,
  npmGlobalInstallCommand,
  npmGlobalInstallSource,
  npmPrefixOwningExecutable,
  probeNpmGlobalPackage,
  readCliVersion,
  resolveExecutablePath,
  selectResolvedExecutable,
  versionFrom,
} from "./provider-maintenance-kit.js";

describe("provider maintenance kit", () => {
  it("reads a CLI version through a native launcher after closing stdin", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bb cli version é-"));
    try {
      const script = path.join(dir, "version.cjs");
      await writeFile(
        script,
        'require("node:fs").readFileSync(0); console.log("tool 1.2.3");',
      );
      const executable = path.join(
        dir,
        process.platform === "win32" ? "version.cmd" : "version",
      );
      await writeFile(
        executable,
        process.platform === "win32"
          ? `@echo off\r\n"${process.execPath}" "%~dp0version.cjs" %*\r\n`
          : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${script.replaceAll("'", "'\\''")}' "$@"\n`,
        { mode: 0o755 },
      );
      expect(await readCliVersion(executable)).toBe("1.2.3");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 15_000);

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

  it.each([
    "1.2.3-2026.01.15",
    "0.5.0-01",
    "1.2.3-beta..1",
    "1.2.3-beta.",
    "1.2.3-",
    "1.2.3+",
    "1.2.3+build..1",
    "1.2.3.4",
    "01.2.3",
  ])("returns null for invalid CLI version %s", (version) => {
    expect(versionFrom(`codex ${version}`)).toBeNull();
  });

  it("preserves valid prereleases and build metadata", () => {
    const version = versionFrom("codex 1.2.3-beta.10+2026.01.15");
    expect(version).toBe("1.2.3-beta.10+2026.01.15");
    expect(compareVersions(version!, "1.2.3-beta.9")).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === "win32").each([
    ["1.2.3-2026.01.15", ""],
    ["0.5.0-01", " >&2"],
    ["1.2.3-beta..1", ""],
  ])("returns null when --version reports %s", async (version, redirect) => {
    const dir = await mkdtemp(path.join(tmpdir(), "bb-cli-invalid-version-"));
    try {
      const executable = path.join(dir, "invalid-version-cli");
      await writeFile(
        executable,
        `#!/bin/sh\necho "codex ${version}"${redirect}\n`,
      );
      await chmod(executable, 0o755);
      expect(await readCliVersion(executable)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

  describe.skipIf(process.platform === "win32")("npm prefix ownership", () => {
    const npmPackage = "@example/tool";

    async function npmPrefixWithTool(): Promise<{
      root: string;
      prefix: string;
      executable: string;
    }> {
      const root = await realpath(
        await mkdtemp(path.join(tmpdir(), "bb-npm-prefix-")),
      );
      const prefix = path.join(root, "npm-global");
      const packageDir = path.join(prefix, "lib", "node_modules", npmPackage);
      const cli = path.join(packageDir, "cli.js");
      const bin = path.join(prefix, "bin");
      await Promise.all([
        mkdir(packageDir, { recursive: true }),
        mkdir(bin, { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(packageDir, "package.json"),
          JSON.stringify({ name: npmPackage, version: "1.1.0" }),
        ),
        writeFile(cli, "#!/bin/sh\necho 1.1.0\n", { mode: 0o755 }),
      ]);
      const executable = path.join(bin, "tool");
      await symlink(path.relative(bin, cli), executable);
      return { root, prefix, executable };
    }

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("installs into the npm prefix that owns the executable on PATH", async () => {
      const { root, prefix, executable } = await npmPrefixWithTool();
      try {
        vi.stubEnv(
          "PATH",
          `${path.dirname(executable)}${path.delimiter}${process.env.PATH ?? ""}`,
        );
        const resolved = await resolveExecutablePath("tool");
        expect(resolved).toBe(executable);
        const owningPrefix = await npmPrefixOwningExecutable(
          resolved,
          npmPackage,
        );
        expect(owningPrefix).toBe(prefix);
        expect(npmGlobalInstallCommand(npmPackage, owningPrefix).args).toEqual([
          "install",
          "-g",
          "--prefix",
          prefix,
          `${npmPackage}@latest`,
        ]);
        expect(await probeNpmGlobalPackage(npmPackage, owningPrefix)).toEqual({
          npmBin: path.join(prefix, "bin"),
          npmGlobalPackageVersion: "1.1.0",
        });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 30_000);

    it("keeps the plain command when the owning prefix is npm's default", async () => {
      const { root, prefix, executable } = await npmPrefixWithTool();
      try {
        vi.stubEnv("NPM_CONFIG_PREFIX", prefix);
        const owningPrefix = await npmPrefixOwningExecutable(
          executable,
          npmPackage,
        );
        expect(owningPrefix).toBeNull();
        expect(npmGlobalInstallCommand(npmPackage, owningPrefix).args).toEqual([
          "install",
          "-g",
          `${npmPackage}@latest`,
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 30_000);

    it("finds no prefix for an executable outside an npm package", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "bb-npm-prefix-none-"));
      try {
        const executable = path.join(root, "tool");
        await writeFile(executable, "#!/bin/sh\necho 1.1.0\n", {
          mode: 0o755,
        });
        expect(
          await npmPrefixOwningExecutable(executable, npmPackage),
        ).toBeNull();
        expect(await npmPrefixOwningExecutable(null, npmPackage)).toBeNull();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
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

  it("picks the launcher Windows can run when npm also installs an extensionless shim", () => {
    const npmBin = "C:\\Users\\me\\AppData\\Roaming\\npm";
    expect(
      selectResolvedExecutable({
        candidates: [`${npmBin}\\codex`, `${npmBin}\\codex.cmd`, ""],
        platform: "win32",
        pathExt: ".COM;.EXE;.BAT;.CMD",
      }),
    ).toBe(`${npmBin}\\codex.cmd`);
    expect(
      selectResolvedExecutable({
        candidates: [`${npmBin}\\codex`, `${npmBin}\\codex.CMD`],
        platform: "win32",
        pathExt: undefined,
      }),
    ).toBe(`${npmBin}\\codex.CMD`);
    expect(
      selectResolvedExecutable({
        candidates: [`${npmBin}\\codex`, `${npmBin}\\codex.cmd`],
        platform: "win32",
        pathExt: ".EXE",
      }),
    ).toBeNull();
  });

  it("keeps the first lookup result on macOS and Linux", () => {
    expect(
      selectResolvedExecutable({
        candidates: ["/usr/local/bin/codex", "/opt/bin/codex.cmd"],
        platform: "linux",
        pathExt: undefined,
      }),
    ).toBe("/usr/local/bin/codex");
    expect(
      selectResolvedExecutable({
        candidates: ["", "  "],
        platform: "darwin",
        pathExt: undefined,
      }),
    ).toBeNull();
  });

  it("runs a PowerShell installer on Windows only when one is published", () => {
    expect(
      downloadedInstallerCommand("https://example.test/install.sh", {
        platform: "win32",
        powershellUrl: "https://example.test/install.ps1",
      }),
    ).toEqual({
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "irm https://example.test/install.ps1 | iex",
      ],
      displayCommand: "irm https://example.test/install.ps1 | iex",
    });
    expect(
      downloadedInstallerCommand("https://example.test/install.sh", {
        platform: "linux",
        powershellUrl: "https://example.test/install.ps1",
      }).command,
    ).toBe("sh");
    expect(
      downloadedInstallerCommand("https://example.test/install.sh", {
        platform: "win32",
      }).command,
    ).toBe("sh");
  });
});
