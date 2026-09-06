import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  commandOutput,
  compareVersions,
  downloadedInstallerCommand,
  formatCommand,
  installationVerification,
  npmCommand,
  npmGlobalInstallCommand,
  npmGlobalInstallSource,
  probeNpmGlobalPackage,
  readCliVersion,
  resolveExecutablePath,
  versionFrom,
  type ExecutableProbeDeps,
} from "./provider-maintenance-kit.js";

describe("provider maintenance kit", () => {
  it("compares the numeric core of CLI versions, prerelease below release", () => {
    expect(compareVersions("0.135.9", "0.136.0")).toBeLessThan(0);
    expect(compareVersions("0.136.0-beta.1", "0.136.0")).toBeLessThan(0);
    expect(compareVersions("0.136.0", "0.136.0-beta.1")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.136.0")).toBeGreaterThan(0);
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("not-a-version", "0.0.1")).toBeLessThan(0);
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

describe("windows executable discovery", () => {
  it("names the npm.cmd shim on win32", () => {
    expect(npmCommand("win32")).toBe("npm.cmd");
    expect(npmCommand("linux")).toBe("npm");
  });

  it("asks where.exe on win32 and keeps PATHEXT order", async () => {
    const seen: { file: string; args: string[] }[] = [];
    const resolved = await resolveExecutablePath("codex", {
      platform: "win32",
      runLookup: async (file, args) => {
        seen.push({ file, args });
        return {
          stdout: "C:\\tools\\codex.cmd\r\nC:\\tools\\codex.exe\r\n",
        };
      },
    });
    expect(seen).toEqual([{ file: "where.exe", args: ["codex"] }]);
    expect(resolved).toBe("C:\\tools\\codex.cmd");
  });

  it("treats the where.exe exit code 1 as not installed", async () => {
    const resolved = await resolveExecutablePath("codex", {
      platform: "win32",
      runLookup: async () => {
        throw Object.assign(new Error("Command failed: where.exe codex"), {
          code: 1,
        });
      },
    });
    expect(resolved).toBeNull();
  });

  it("asks which on posix", async () => {
    const seen: { file: string; args: string[] }[] = [];
    const resolved = await resolveExecutablePath("codex", {
      platform: "linux",
      runLookup: async (file, args) => {
        seen.push({ file, args });
        return { stdout: "/usr/local/bin/codex\n" };
      },
    });
    expect(seen).toEqual([{ file: "which", args: ["codex"] }]);
    expect(resolved).toBe("/usr/local/bin/codex");
  });

  it("runs --version against the platform npm without a shell", async () => {
    const seen: { command: string; args: readonly string[] }[] = [];
    const deps: ExecutableProbeDeps = {
      platform: "win32",
      runCommand: async (command, args) => {
        seen.push({ command, args });
        return { stdout: "codex-cli 0.150.0\n", stderr: "" };
      },
    };
    await expect(readCliVersion("npm.cmd", deps)).resolves.toBe("0.150.0");
    expect(seen).toEqual([{ command: "npm.cmd", args: ["--version"] }]);
  });

  it("combines stdout and stderr for registry probes", async () => {
    await expect(
      commandOutput("npm", ["view", "codex", "version"], {
        platform: "linux",
        runCommand: async () => ({
          stdout: "0.150.0\n",
          stderr: "warning: using registry\n",
        }),
      }),
    ).resolves.toBe("0.150.0\n\nwarning: using registry");
  });

  it("keeps the npm prefix itself as the global bin on win32", async () => {
    const seen: string[] = [];
    const deps: ExecutableProbeDeps = {
      platform: "win32",
      runCommand: async (command, args) => {
        seen.push(command);
        if (args[0] === "prefix") {
          return {
            stdout: "C:\\Users\\u\\AppData\\Roaming\\npm\r\n",
            stderr: "",
          };
        }
        return {
          stdout: JSON.stringify({
            dependencies: { "@openai/codex": { version: "0.150.0" } },
          }),
          stderr: "",
        };
      },
    };
    const probe = await probeNpmGlobalPackage("@openai/codex", deps);
    expect(seen).toEqual(["npm.cmd", "npm.cmd"]);
    expect(probe.npmBin).toBe("C:\\Users\\u\\AppData\\Roaming\\npm");
    expect(probe.npmGlobalPackageVersion).toBe("0.150.0");
  });

  it("appends bin to the npm prefix on posix", async () => {
    const probe = await probeNpmGlobalPackage("@openai/codex", {
      platform: "linux",
      runCommand: async (_command, args) => {
        if (args[0] === "prefix") {
          return { stdout: "/usr/local\n", stderr: "" };
        }
        return { stdout: "{}", stderr: "" };
      },
    });
    expect(probe.npmBin).toBe("/usr/local/bin");
  });

  it("reads --version for real on this host", async () => {
    await expect(readCliVersion(process.execPath)).resolves.toMatch(
      /\d+\.\d+\.\d+/u,
    );
  });

  it("finds the node binary for real on this host", async () => {
    await expect(resolveExecutablePath(process.execPath)).resolves.toBe(
      process.execPath,
    );
  });
});

describe("windows install commands", () => {
  const HOSTILE_URL = "https://example.com/x?a=1&b='injected';echo";

  it("builds the npm global install through the platform npm shim", () => {
    expect(npmGlobalInstallCommand("@openai/codex", "win32")).toEqual({
      command: "npm.cmd",
      args: ["install", "-g", "@openai/codex@latest"],
      displayCommand: "npm.cmd install -g @openai/codex@latest",
    });
    expect(npmGlobalInstallCommand("@openai/codex", "linux")).toEqual({
      command: "npm",
      args: ["install", "-g", "@openai/codex@latest"],
      displayCommand: "npm install -g @openai/codex@latest",
    });
  });

  it("keeps a hostile installer URL inside one quoted word on posix", () => {
    const built = downloadedInstallerCommand(HOSTILE_URL, "linux");
    expect(built.command).toBe("sh");
    expect(built.args).toHaveLength(2);
    expect(built.args[0]).toBe("-c");
    const script = built.args[1] ?? "";
    expect(script).toContain(`'https://example.com/x?a=1&b='\\''injected'\\'';echo'`);
    expect(built.displayCommand).toBe(script);
  });

  it("downloads through powershell.exe argv on win32, never sh", () => {
    const built = downloadedInstallerCommand(
      "https://cursor.com/install",
      "win32",
    );
    expect(built.command).toBe("powershell.exe");
    expect(built.args.slice(0, 5)).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
    ]);
    expect(built.args).toHaveLength(6);
    const script = built.args[5] ?? "";
    expect(script).toContain("'https://cursor.com/install'");
    expect(script).toContain("Invoke-WebRequest");
    expect(script).toContain("Get-Command bash");
  });

  it("keeps a hostile installer URL inside one powershell argv element", () => {
    const built = downloadedInstallerCommand(HOSTILE_URL, "win32");
    expect(built.command).toBe("powershell.exe");
    expect(built.args).toHaveLength(6);
    const script = built.args[5] ?? "";
    expect(script).toContain("'https://example.com/x?a=1&b=''injected'';echo'");
  });

  it("refuses non-HTTPS installer URLs on every platform", () => {
    for (const platform of ["win32", "linux"] as const) {
      expect(() =>
        downloadedInstallerCommand("http://example.com/install", platform),
      ).toThrow("non-HTTPS");
      expect(() =>
        downloadedInstallerCommand("curl evil | sh", platform),
      ).toThrow("non-HTTPS");
    }
  });
});

describe("windows npm install source", () => {
  it("matches a win32 executable under the npm prefix despite casing", () => {
    expect(
      npmGlobalInstallSource({
        installed: true,
        executablePath: "c:\\users\\u\\appdata\\roaming\\npm\\codex.cmd",
        npmBin: "C:\\Users\\u\\AppData\\Roaming\\npm",
        platform: "win32",
      }),
    ).toBe("npmGlobal");
    expect(
      npmGlobalInstallSource({
        installed: true,
        executablePath: "C:\\tools\\codex.exe",
        npmBin: "C:\\Users\\u\\AppData\\Roaming\\npm",
        platform: "win32",
      }),
    ).toBe("external");
  });

  it("stays case-sensitive on posix", () => {
    expect(
      npmGlobalInstallSource({
        installed: true,
        executablePath: "/USR/LOCAL/BIN/codex",
        npmBin: "/usr/local/bin",
        platform: "linux",
      }),
    ).toBe("external");
  });
});

describe("windows absolute executable paths", () => {
  it("never shells out to where.exe for an absolute win32 path", async () => {
    const seen: { file: string; args: string[] }[] = [];
    const resolved = await resolveExecutablePath("C:\\tools\\codex.cmd", {
      platform: "win32",
      runLookup: async (file, args) => {
        seen.push({ file, args });
        return { stdout: "" };
      },
    });
    expect(seen).toEqual([]);
    expect(resolved).toBeNull();
  });

  it("passes a hostile bare command to the lookup as one argv element", async () => {
    const seen: { file: string; args: string[] }[] = [];
    const hostile = "codex & del C:\\temp";
    const resolved = await resolveExecutablePath(hostile, {
      platform: "win32",
      runLookup: async (file, args) => {
        seen.push({ file, args });
        throw Object.assign(new Error("not found"), { code: 1 });
      },
    });
    expect(seen).toEqual([{ file: "where.exe", args: [hostile] }]);
    expect(resolved).toBeNull();
  });
});
