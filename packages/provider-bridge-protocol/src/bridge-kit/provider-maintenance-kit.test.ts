import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type MiseKitIo,
  compareVersions,
  formatCommand,
  installationVerification,
  misePackageSpec,
  miseUseCommand,
  npmGlobalInstallSource,
  probeMisePackage,
  readCliVersion,
  resolveMiseBinary,
  resolvePackageInstaller,
  versionFrom,
} from "./provider-maintenance-kit.js";

const home = path.join(path.sep, "Users", "test");
const miseBinary = path.join(home, ".local", "bin", "mise");
const miseDataDir = path.join(home, ".local", "share", "mise");
const codexInstallDir = path.join(
  miseDataDir,
  "installs",
  "npm-openai-codex",
  "0.153.4",
);
const miseNodeBin = path.join(miseDataDir, "installs", "node", "22", "bin");
const miseNodePrefix = path.join(miseDataDir, "installs", "node", "22.23.2");
const npmBin = path.join(path.sep, "usr", "local", "bin");
const CODEX = "@openai/codex";

function miseListJson(requestedVersion: string | undefined): string {
  return JSON.stringify([
    {
      version: "0.153.4",
      ...(requestedVersion === undefined
        ? {}
        : { requested_version: requestedVersion }),
      install_path: codexInstallDir,
      installed: true,
      active: true,
    },
  ]);
}

function fakeIo(args: {
  miseInstalled?: boolean;
  listJson?: string | null;
  realpaths?: Record<string, string>;
  pathEnv?: string;
}): MiseKitIo & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    async commandStdout(command, commandArgs) {
      calls.push([command, ...commandArgs]);
      return command === miseBinary && commandArgs[1] === "ls"
        ? (args.listJson ?? null)
        : null;
    },
    async isExecutable(filePath) {
      return (args.miseInstalled ?? true) && filePath === miseBinary;
    },
    async realpath(filePath) {
      return args.realpaths?.[filePath] ?? null;
    },
    env: { PATH: args.pathEnv ?? path.join(path.sep, "usr", "bin") },
    homeDir: home,
  };
}

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

  it("finds mise on the shell PATH before the well-known fallback directories", async () => {
    const onPath = path.join(path.sep, "opt", "tools", "bin");
    const io = fakeIo({});
    io.isExecutable = async (filePath) =>
      filePath === path.join(onPath, "mise") || filePath === miseBinary;
    expect(await resolveMiseBinary(onPath, io)).toBe(path.join(onPath, "mise"));
    expect(await resolveMiseBinary(undefined, io)).toBe(miseBinary);
    expect(
      await resolveMiseBinary(onPath, fakeIo({ miseInstalled: false })),
    ).toBeNull();
  });

  it("keeps alias pins and bumps concrete pins to the latest version", () => {
    expect(misePackageSpec("latest", "0.154.0")).toBe("latest");
    expect(misePackageSpec("lts", "0.154.0")).toBe("lts");
    expect(misePackageSpec("0.153.4", "0.154.0")).toBe("0.154.0");
    expect(misePackageSpec("0.153.4", null)).toBe("latest");
    expect(misePackageSpec(null, "0.154.0")).toBe("latest");
  });

  it("builds a non-interactive global mise use command", () => {
    expect(miseUseCommand(miseBinary, CODEX, "latest")).toEqual({
      command: miseBinary,
      args: ["use", "-g", "-y", "npm:@openai/codex@latest"],
      displayCommand: "mise use -g -y npm:@openai/codex@latest",
    });
  });

  it("attributes an executable inside the mise install directory or shims to mise", async () => {
    const executablePath = path.join(codexInstallDir, "bin", "codex");
    const io = fakeIo({
      listJson: miseListJson("latest"),
      realpaths: {
        [executablePath]: path.join(
          codexInstallDir,
          "lib",
          "node_modules",
          "@openai",
          "codex",
          "bin",
          "codex.js",
        ),
      },
    });
    const probe = await probeMisePackage(
      { mise: miseBinary, npmPackage: CODEX, executablePath, npmBin },
      io,
    );
    expect(probe).toEqual({
      installDir: codexInstallDir,
      installedVersion: "0.153.4",
      requestedVersion: "latest",
      active: true,
      executableManaged: true,
      shadowingInstall: null,
    });
    expect(io.calls).toEqual([
      [miseBinary, "-y", "ls", "--json", "npm:@openai/codex"],
    ]);
    const shim = path.join(miseDataDir, "shims", "codex");
    expect(
      (
        await probeMisePackage(
          { mise: miseBinary, npmPackage: CODEX, executablePath: shim, npmBin },
          fakeIo({
            listJson: miseListJson("latest"),
            realpaths: { [shim]: miseBinary },
          }),
        )
      ).executableManaged,
    ).toBe(true);
  });

  it("attributes a symlink that resolves into the shims or install directory to mise", async () => {
    const shim = path.join(miseDataDir, "shims", "codex");
    const linkedShim = path.join(npmBin, "codex");
    const linkedInstall = path.join(path.sep, "opt", "bin", "codex");
    const homebrewMise = path.join(path.sep, "opt", "homebrew", "bin", "mise");
    const cases = [
      { executablePath: linkedShim, realpaths: { [linkedShim]: shim } },
      {
        executablePath: linkedShim,
        realpaths: { [linkedShim]: homebrewMise, [miseBinary]: homebrewMise },
      },
      {
        executablePath: linkedInstall,
        realpaths: {
          [linkedInstall]: path.join(codexInstallDir, "bin", "codex"),
        },
      },
    ];
    for (const testCase of cases) {
      const probe = await probeMisePackage(
        {
          mise: miseBinary,
          npmPackage: CODEX,
          executablePath: testCase.executablePath,
          npmBin,
        },
        fakeIo({
          listJson: miseListJson("latest"),
          realpaths: testCase.realpaths,
        }),
      );
      expect(probe.executableManaged).toBe(true);
      expect(probe.shadowingInstall).toBeNull();
    }
  });

  it("reports a stray global inside a mise node prefix as a shadowing install", async () => {
    const executablePath = path.join(miseNodeBin, "codex");
    const io = fakeIo({
      listJson: miseListJson("latest"),
      realpaths: {
        [executablePath]: path.join(
          miseNodePrefix,
          "lib",
          "node_modules",
          "@openai",
          "codex",
          "bin",
          "codex.js",
        ),
      },
    });
    const resolution = await resolvePackageInstaller(
      {
        packageManager: "auto",
        npmPackage: CODEX,
        installed: true,
        executablePath,
        npmBin,
        latestVersion: "0.154.0",
      },
      io,
    );
    expect(resolution.packageManager).toBe("mise");
    expect(resolution.source).toBe("external");
    expect(resolution.shadowingInstall).toEqual({
      executablePath,
      removeCommand: `npm uninstall -g --prefix ${miseNodePrefix} @openai/codex`,
    });
    expect(resolution.updateCommand.displayCommand).toBe(
      "mise use -g -y npm:@openai/codex@latest",
    );
    expect(io.calls.some((call) => call[0] === "npm")).toBe(false);
  });

  it("treats an installed but inactive mise entry as not mise-managed", async () => {
    const executablePath = path.join(codexInstallDir, "bin", "codex");
    const inactiveListJson = JSON.stringify([
      {
        version: "0.153.4",
        requested_version: "latest",
        install_path: codexInstallDir,
        installed: true,
        active: false,
      },
    ]);
    const probe = await probeMisePackage(
      { mise: miseBinary, npmPackage: CODEX, executablePath, npmBin },
      fakeIo({
        listJson: inactiveListJson,
        realpaths: { [executablePath]: executablePath },
      }),
    );
    expect(probe).toEqual({
      installDir: null,
      installedVersion: null,
      requestedVersion: null,
      active: false,
      executableManaged: false,
      shadowingInstall: null,
    });
    const resolution = await resolvePackageInstaller(
      {
        packageManager: "auto",
        npmPackage: CODEX,
        installed: true,
        executablePath,
        npmBin,
        latestVersion: "0.154.0",
      },
      fakeIo({
        listJson: inactiveListJson,
        realpaths: { [executablePath]: executablePath },
      }),
    );
    expect(resolution.packageManager).toBe("npm");
    expect(resolution.source).toBe("external");
    expect(resolution.updateCommand.displayCommand).toBe(
      "npm install -g @openai/codex@latest",
    );
  });

  it("reports a stray npm global as a shadowing install when mise manages the package", async () => {
    const executablePath = path.join(npmBin, "codex");
    const resolution = await resolvePackageInstaller(
      {
        packageManager: "auto",
        npmPackage: CODEX,
        installed: true,
        executablePath,
        npmBin,
        latestVersion: "0.154.0",
      },
      fakeIo({
        listJson: miseListJson("latest"),
        realpaths: { [executablePath]: executablePath },
      }),
    );
    expect(resolution.source).toBe("npmGlobal");
    expect(resolution.shadowingInstall).toEqual({
      executablePath,
      removeCommand: "npm uninstall -g @openai/codex",
    });
  });

  it("uses npm in auto mode when mise does not manage the package", async () => {
    const executablePath = path.join(npmBin, "codex");
    const resolution = await resolvePackageInstaller(
      {
        packageManager: "auto",
        npmPackage: CODEX,
        installed: true,
        executablePath,
        npmBin,
        latestVersion: "0.154.0",
      },
      fakeIo({ listJson: "[]" }),
    );
    expect(resolution).toEqual({
      packageManager: "npm",
      source: "npmGlobal",
      installCommand: {
        command: "npm",
        args: ["install", "-g", "@openai/codex@latest"],
        displayCommand: "npm install -g @openai/codex@latest",
      },
      updateCommand: {
        command: "npm",
        args: ["install", "-g", "@openai/codex@latest"],
        displayCommand: "npm install -g @openai/codex@latest",
      },
      shadowingInstall: null,
    });
  });

  it("uses npm and skips every mise probe when mise is missing", async () => {
    const io = fakeIo({ miseInstalled: false });
    const resolution = await resolvePackageInstaller(
      {
        packageManager: "auto",
        npmPackage: CODEX,
        installed: false,
        executablePath: null,
        npmBin,
        latestVersion: null,
      },
      io,
    );
    expect(resolution.packageManager).toBe("npm");
    expect(resolution.source).toBe("notInstalled");
    expect(io.calls).toEqual([]);
  });

  it("bumps a concrete mise pin to the latest version on update", async () => {
    const executablePath = path.join(codexInstallDir, "bin", "codex");
    const resolution = await resolvePackageInstaller(
      {
        packageManager: "auto",
        npmPackage: CODEX,
        installed: true,
        executablePath,
        npmBin,
        latestVersion: "0.154.0",
      },
      fakeIo({
        listJson: miseListJson("0.153.4"),
        realpaths: { [executablePath]: executablePath },
      }),
    );
    expect(resolution.source).toBe("mise");
    expect(resolution.installCommand.args).toEqual([
      "use",
      "-g",
      "-y",
      "npm:@openai/codex@latest",
    ]);
    expect(resolution.updateCommand.args).toEqual([
      "use",
      "-g",
      "-y",
      "npm:@openai/codex@0.154.0",
    ]);
  });

  it("obeys a forced package manager without hiding the observed source", async () => {
    const managedExecutable = path.join(codexInstallDir, "bin", "codex");
    const forcedNpm = await resolvePackageInstaller(
      {
        packageManager: "npm",
        npmPackage: CODEX,
        installed: true,
        executablePath: managedExecutable,
        npmBin,
        latestVersion: "0.154.0",
      },
      fakeIo({
        listJson: miseListJson("latest"),
        realpaths: { [managedExecutable]: managedExecutable },
      }),
    );
    expect(forcedNpm.packageManager).toBe("npm");
    expect(forcedNpm.source).toBe("mise");
    expect(forcedNpm.updateCommand.command).toBe("npm");

    const forcedMise = await resolvePackageInstaller(
      {
        packageManager: "mise",
        npmPackage: CODEX,
        installed: true,
        executablePath: path.join(npmBin, "codex"),
        npmBin,
        latestVersion: "0.154.0",
      },
      fakeIo({ listJson: "[]" }),
    );
    expect(forcedMise.packageManager).toBe("mise");
    expect(forcedMise.source).toBe("npmGlobal");
    expect(forcedMise.updateCommand).toEqual(
      miseUseCommand(miseBinary, CODEX, "latest"),
    );

    const forcedMiseWithoutMise = await resolvePackageInstaller(
      {
        packageManager: "mise",
        npmPackage: CODEX,
        installed: true,
        executablePath: path.join(npmBin, "codex"),
        npmBin,
        latestVersion: "0.154.0",
      },
      fakeIo({ miseInstalled: false }),
    );
    expect(forcedMiseWithoutMise.packageManager).toBe("mise");
    expect(forcedMiseWithoutMise.installCommand.command).toBe("mise");
  });
});
