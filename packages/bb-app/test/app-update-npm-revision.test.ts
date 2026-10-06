import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatAppUpdateVersionsDir } from "@bb/config/app-update";
import {
  formatNpmRevisionPackageRoot,
  installNpmRevision,
  NPM_REVISION_REQUIRED_FILES,
  pruneNpmRevisions,
} from "../src/app-update/npm-revision.js";
import type {
  RunCommand,
  RunCommandArgs,
} from "../src/app-update/run-command.js";

const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-app-update-npm-"));
  scratchDirs.push(dir);
  return dir;
}

function writePackage(
  packageRoot: string,
  version: string,
  files: readonly string[] = NPM_REVISION_REQUIRED_FILES,
): void {
  for (const file of files) {
    mkdirSync(dirname(join(packageRoot, file)), { recursive: true });
    writeFileSync(join(packageRoot, file), "");
  }
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ version }));
}

function fakeNpm(args: {
  installedVersion?: string;
  nativeCheckCode?: number;
  omitFiles?: boolean;
}) {
  const calls: RunCommandArgs[] = [];
  const stagedPackageJsons: unknown[] = [];
  const runner: RunCommand = async (call) => {
    calls.push(call);
    if (call.args.includes("install")) {
      stagedPackageJsons.push(
        JSON.parse(readFileSync(join(call.cwd, "package.json"), "utf8")),
      );
      writePackage(
        join(call.cwd, "node_modules", "bb-app"),
        args.installedVersion ?? "1.1.0",
        args.omitFiles === true ? [] : NPM_REVISION_REQUIRED_FILES,
      );
      call.onLine?.("added 312 packages");
      return {
        code: 0,
        outputTail: ["added 312 packages"],
        signal: null,
        stdout: "",
      };
    }
    const code = args.nativeCheckCode ?? 0;
    return {
      code,
      outputTail:
        code === 0 ? [] : ["Error: Could not locate the bindings file"],
      signal: null,
      stdout: "",
    };
  };
  return { calls, runner, stagedPackageJsons };
}

describe("installNpmRevision", () => {
  it("installs into a staging dir, verifies native modules, then moves it into place", async () => {
    const dataDir = scratchDir();
    const npm = fakeNpm({});
    const steps: string[] = [];

    const revision = await installNpmRevision({
      dataDir,
      npmCliPath: "/bundled/npm-cli.js",
      onLine: () => undefined,
      onStep: (step) => steps.push(step),
      runner: npm.runner,
      version: "1.1.0",
    });

    expect(revision).toEqual({
      kind: "npm",
      packageRoot: formatNpmRevisionPackageRoot(dataDir, "1.1.0"),
      version: "1.1.0",
    });
    expect(steps).toEqual([
      "Downloading bb-app 1.1.0",
      "Verifying bb-app 1.1.0",
    ]);
    const [install, nativeCheck] = npm.calls;
    expect(install?.command).toBe(process.execPath);
    expect(install?.args).toEqual(
      expect.arrayContaining([
        "/bundled/npm-cli.js",
        "install",
        "bb-app@1.1.0",
      ]),
    );
    expect(install?.args.some((arg) => arg.startsWith("--allow-scripts"))).toBe(
      false,
    );
    expect(npm.stagedPackageJsons).toEqual([
      expect.objectContaining({
        allowScripts: {
          "@parcel/watcher": true,
          "better-sqlite3": true,
          "node-pty": true,
        },
      }),
    ]);
    expect(nativeCheck?.cwd).toBe(revision.packageRoot);
    expect(readdirSync(formatAppUpdateVersionsDir(dataDir))).toEqual(["1.1.0"]);
  });

  it("reuses an intact install without running npm", async () => {
    const dataDir = scratchDir();
    writePackage(formatNpmRevisionPackageRoot(dataDir, "1.1.0"), "1.1.0");
    const npm = fakeNpm({});

    await installNpmRevision({
      dataDir,
      npmCliPath: null,
      onLine: () => undefined,
      onStep: () => undefined,
      runner: npm.runner,
      version: "1.1.0",
    });

    expect(npm.calls).toEqual([]);
  });

  it("removes the install when the native modules fail to load", async () => {
    const dataDir = scratchDir();
    const npm = fakeNpm({ nativeCheckCode: 1 });

    await expect(
      installNpmRevision({
        dataDir,
        npmCliPath: null,
        onLine: () => undefined,
        onStep: () => undefined,
        runner: npm.runner,
        version: "1.1.0",
      }),
    ).rejects.toThrow("Could not locate the bindings file");
    expect(readdirSync(formatAppUpdateVersionsDir(dataDir))).toEqual([]);
  });

  it("rejects a download that reports a different version", async () => {
    const dataDir = scratchDir();
    const npm = fakeNpm({ installedVersion: "1.0.9" });

    await expect(
      installNpmRevision({
        dataDir,
        npmCliPath: null,
        onLine: () => undefined,
        onStep: () => undefined,
        runner: npm.runner,
        version: "1.1.0",
      }),
    ).rejects.toThrow("reports a different version");
    expect(existsSync(formatNpmRevisionPackageRoot(dataDir, "1.1.0"))).toBe(
      false,
    );
  });

  it("refuses versions that are not semver", async () => {
    await expect(
      installNpmRevision({
        dataDir: scratchDir(),
        npmCliPath: null,
        onLine: () => undefined,
        onStep: () => undefined,
        runner: fakeNpm({}).runner,
        version: "latest; rm -rf /",
      }),
    ).rejects.toThrow("invalid bb-app version");
  });
});

describe("pruneNpmRevisions", () => {
  it("keeps the running and previous versions and removes the rest", async () => {
    const dataDir = scratchDir();
    for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
      writePackage(formatNpmRevisionPackageRoot(dataDir, version), version);
    }
    mkdirSync(join(formatAppUpdateVersionsDir(dataDir), ".staging-1.3.0-1"));

    await pruneNpmRevisions({
      dataDir,
      keepPackageRoots: [
        formatNpmRevisionPackageRoot(dataDir, "1.1.0"),
        formatNpmRevisionPackageRoot(dataDir, "1.2.0"),
      ],
    });

    expect(readdirSync(formatAppUpdateVersionsDir(dataDir)).sort()).toEqual([
      "1.1.0",
      "1.2.0",
    ]);
  });
});
