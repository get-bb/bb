import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_UPDATE_RESTART_EXIT_CODE,
  formatAppUpdateStatePath,
  mutateAppUpdateState,
  readAppUpdateState,
  type InstalledNpmAppRevision,
  type NpmAppRevision,
} from "@bb/config/app-update";
import type { ChildProcessExitResult } from "@bb/config/child-process-exit";
import { runNpmShim, selectNpmRevision } from "../src/app-update/npm-shim.js";
import type {
  LauncherRun,
  LauncherUpdateMode,
  ShimOutput,
} from "../src/app-update/shim-support.js";

const NODE_ABI = "137";
const scratchDirs: string[] = [];

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "bb-app-update-shim-"));
  scratchDirs.push(dir);
  return dir;
}

function revision(version: string): NpmAppRevision {
  return { kind: "npm", packageRoot: `/versions/${version}/bb-app`, version };
}

function installed(
  version: string,
  nodeAbi = NODE_ABI,
): InstalledNpmAppRevision {
  return { ...revision(version), nodeAbi };
}

type LaunchStep = () => Promise<ChildProcessExitResult>;

function scriptedLauncher(steps: LaunchStep[]) {
  const launches: string[] = [];
  const modes: LauncherUpdateMode[] = [];
  const spawnLauncher = (
    launched: NpmAppRevision,
    mode: LauncherUpdateMode,
  ): LauncherRun => {
    launches.push(launched.version);
    modes.push(mode);
    const step = steps.shift();
    if (step === undefined) {
      throw new Error(`Unexpected launch of ${launched.version}`);
    }
    return { exit: step(), kill: () => undefined };
  };
  return { launches, modes, spawnLauncher };
}

function output(): ShimOutput & { lines: string[] } {
  const lines: string[] = [];
  return {
    error: (message) => lines.push(`error: ${message}`),
    info: (message) => lines.push(`info: ${message}`),
    lines,
    warn: (message) => lines.push(`warn: ${message}`),
  };
}

function exit(code: number | null): Promise<ChildProcessExitResult> {
  return Promise.resolve({ code, signal: null });
}

async function recordSwitch(dataDir: string, version: string): Promise<void> {
  await mutateAppUpdateState(dataDir, (state) => ({
    ...state,
    current: installed(version),
    pending: {
      from: revision("1.0.0"),
      id: "update-1",
      requestedAt: "2026-09-23T00:00:00.000Z",
      to: revision(version),
    },
  }));
}

function shimArgs(args: {
  dataDir: string;
  output?: ShimOutput;
  spawnLauncher: (
    revision: NpmAppRevision,
    mode: LauncherUpdateMode,
  ) => LauncherRun;
  isUsable?: (revision: NpmAppRevision) => boolean;
  useBundled?: boolean;
  acquireLock?: Parameters<typeof runNpmShim>[0]["acquireLock"];
}) {
  return {
    ...(args.acquireLock === undefined
      ? {}
      : { acquireLock: args.acquireLock }),
    bundled: revision("1.0.0"),
    dataDir: args.dataDir,
    isUsable: args.isUsable ?? (() => true),
    nodeAbi: NODE_ABI,
    output: args.output ?? output(),
    spawnLauncher: args.spawnLauncher,
    useBundled: args.useBundled ?? false,
  };
}

describe("selectNpmRevision", () => {
  const select = (current: InstalledNpmAppRevision | null, bundled = "1.0.0") =>
    selectNpmRevision({
      bundled: revision(bundled),
      current,
      isUsable: () => true,
      nodeAbi: NODE_ABI,
    });

  it("runs an installed version newer than the npx copy", () => {
    expect(select(installed("1.1.0"))).toMatchObject({
      reason: "installed-newer",
      revision: { version: "1.1.0" },
    });
  });

  it("runs a newer npx copy over an older installed version", () => {
    expect(select(installed("1.1.0"), "1.2.0").revision.version).toBe("1.2.0");
  });

  it("orders nightly prereleases after their stable base", () => {
    expect(select(installed("1.0.1-nightly.123.1")).revision.version).toBe(
      "1.0.1-nightly.123.1",
    );
  });

  it("falls back to the npx copy when the install was built for another Node.js", () => {
    expect(select(installed("1.1.0", "127"))).toMatchObject({
      reason: "abi-mismatch",
      revision: { version: "1.0.0" },
    });
  });

  it("ignores an installed version that is missing from disk", () => {
    expect(
      selectNpmRevision({
        bundled: revision("1.0.0"),
        current: installed("1.1.0"),
        isUsable: () => false,
        nodeAbi: NODE_ABI,
      }).revision.version,
    ).toBe("1.0.0");
  });
});

describe("runNpmShim", () => {
  it("passes a normal launcher exit through", async () => {
    const dataDir = scratchDir();
    const launcher = scriptedLauncher([() => exit(0)]);

    const code = await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(code).toBe(0);
    expect(launcher.launches).toEqual(["1.0.0"]);
    expect(launcher.modes).toEqual(["npm"]);
  });

  it("relaunches the version the launcher recorded when it asks for a restart", async () => {
    const dataDir = scratchDir();
    const launcher = scriptedLauncher([
      async () => {
        await recordSwitch(dataDir, "1.1.0");
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      () => exit(0),
    ]);

    const code = await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(code).toBe(0);
    expect(launcher.launches).toEqual(["1.0.0", "1.1.0"]);
    expect(launcher.modes).toEqual(["npm", "npm"]);
  });

  it("passes a failed start of the new version through without switching back", async () => {
    const dataDir = scratchDir();
    const launcher = scriptedLauncher([
      async () => {
        await recordSwitch(dataDir, "1.1.0");
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      () => exit(1),
    ]);

    const code = await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(code).toBe(1);
    expect(launcher.launches).toEqual(["1.0.0", "1.1.0"]);
    expect((await readAppUpdateState(dataDir)).current).toEqual(
      installed("1.1.0"),
    );
  });

  it("exits without relaunching when bb is stopped during the restart", async () => {
    const dataDir = scratchDir();
    const launcher = scriptedLauncher([
      async () => {
        await recordSwitch(dataDir, "1.1.0");
        process.emit("SIGTERM");
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
    ]);

    const code = await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(code).toBe(0);
    expect(launcher.launches).toEqual(["1.0.0"]);
  });

  it("restarts into the new version after an update started with --bundled", async () => {
    const dataDir = scratchDir();
    const launcher = scriptedLauncher([
      async () => {
        await recordSwitch(dataDir, "1.1.0");
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      () => exit(0),
    ]);

    await runNpmShim(
      shimArgs({
        dataDir,
        spawnLauncher: launcher.spawnLauncher,
        useBundled: true,
      }),
    );

    expect(launcher.launches).toEqual(["1.0.0", "1.1.0"]);
  });

  it("runs passive without touching the state file when another shim manages the data directory", async () => {
    const dataDir = scratchDir();
    await recordSwitch(dataDir, "1.1.0");
    const before = readFileSync(formatAppUpdateStatePath(dataDir), "utf8");
    const launcher = scriptedLauncher([() => exit(1)]);

    const code = await runNpmShim(
      shimArgs({
        acquireLock: async () => null,
        dataDir,
        spawnLauncher: launcher.spawnLauncher,
      }),
    );

    expect(code).toBe(1);
    expect(launcher.launches).toEqual(["1.1.0"]);
    expect(launcher.modes).toEqual(["passive"]);
    expect(readFileSync(formatAppUpdateStatePath(dataDir), "utf8")).toBe(
      before,
    );
  });

  it("leaves a state file from a newer bb untouched and runs the npx copy", async () => {
    const dataDir = scratchDir();
    const future = `${JSON.stringify({ schemaVersion: 2, current: null })}\n`;
    writeFileSync(formatAppUpdateStatePath(dataDir), future);
    const launcher = scriptedLauncher([() => exit(0)]);

    await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(launcher.launches).toEqual(["1.0.0"]);
    expect(launcher.modes).toEqual(["passive"]);
    expect(readFileSync(formatAppUpdateStatePath(dataDir), "utf8")).toBe(
      future,
    );
  });

  it("runs the npx copy with --bundled even when a newer version is installed", async () => {
    const dataDir = scratchDir();
    await mutateAppUpdateState(dataDir, (state) => ({
      ...state,
      current: installed("1.1.0"),
    }));
    const launcher = scriptedLauncher([() => exit(0)]);

    await runNpmShim(
      shimArgs({
        dataDir,
        spawnLauncher: launcher.spawnLauncher,
        useBundled: true,
      }),
    );

    expect(launcher.launches).toEqual(["1.0.0"]);
  });
});
