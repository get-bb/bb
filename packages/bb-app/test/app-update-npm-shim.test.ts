import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  APP_UPDATE_RESTART_EXIT_CODE,
  formatAppUpdateStatePath,
  mutateAppUpdateState,
  readAppUpdateState,
  type AppUpdatePending,
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

function pendingUpdate(
  overrides: Partial<AppUpdatePending> & {
    from: NpmAppRevision;
    to: NpmAppRevision;
  },
): AppUpdatePending {
  return {
    databaseBackupDir: null,
    failure: null,
    healthyAt: null,
    id: "update-1",
    requestedAt: "2026-09-23T00:00:00.000Z",
    rollbackStartedAt: null,
    ...overrides,
  };
}

function exit(code: number | null): Promise<ChildProcessExitResult> {
  return Promise.resolve({ code, signal: null });
}

function writeBackup(dataDir: string, contents: string): string {
  const backupDir = join(dataDir, "app-update-backups", "update-1");
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(backupDir, "bb.db"), contents);
  return backupDir;
}

function shimArgs(args: {
  dataDir: string;
  output?: ShimOutput;
  spawnLauncher: (
    revision: NpmAppRevision,
    mode: LauncherUpdateMode,
  ) => LauncherRun;
  isUsable?: (revision: NpmAppRevision) => boolean;
  now?: () => number;
  useBundled?: boolean;
  acquireLock?: Parameters<typeof runNpmShim>[0]["acquireLock"];
}) {
  return {
    ...(args.acquireLock === undefined
      ? {}
      : { acquireLock: args.acquireLock }),
    bundled: revision("1.0.0"),
    dataDir: args.dataDir,
    dbPath: join(args.dataDir, "bb.db"),
    isUsable: args.isUsable ?? (() => true),
    logDir: join(args.dataDir, "logs"),
    nodeAbi: NODE_ABI,
    ...(args.now === undefined ? {} : { now: args.now }),
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

  it("restarts into the pending version and records it with the Node ABI", async () => {
    const dataDir = scratchDir();
    const launcher = scriptedLauncher([
      async () => {
        await mutateAppUpdateState(dataDir, (state) => ({
          ...state,
          pending: pendingUpdate({
            from: revision("1.0.0"),
            to: revision("1.1.0"),
          }),
        }));
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      () => exit(0),
    ]);

    const code = await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(code).toBe(0);
    expect(launcher.launches).toEqual(["1.0.0", "1.1.0"]);
    expect((await readAppUpdateState(dataDir)).current).toEqual(
      installed("1.1.0"),
    );
  });

  it("rolls back and restores the database when the new version fails to start", async () => {
    const dataDir = scratchDir();
    const dbPath = join(dataDir, "bb.db");
    const serverLog = join(dataDir, "logs", "server-stdio.log");
    mkdirSync(join(dataDir, "logs"));
    writeFileSync(serverLog, "noise from the previous version\n");
    let backupDir = "";
    const launcher = scriptedLauncher([
      async () => {
        writeFileSync(dbPath, "before the update");
        backupDir = writeBackup(dataDir, "before the update");
        await mutateAppUpdateState(dataDir, (state) => ({
          ...state,
          pending: pendingUpdate({
            databaseBackupDir: backupDir,
            from: revision("1.0.0"),
            to: revision("1.1.0"),
          }),
        }));
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      async () => {
        writeFileSync(dbPath, "migrated by 1.1.0");
        appendFileSync(serverLog, "boom: bad migration\n");
        return { code: 1, signal: null };
      },
      () => exit(0),
    ]);

    const code = await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(code).toBe(0);
    expect(launcher.launches).toEqual(["1.0.0", "1.1.0", "1.0.0"]);
    expect(readFileSync(dbPath, "utf8")).toBe("before the update");
    expect(existsSync(backupDir)).toBe(false);
    const state = await readAppUpdateState(dataDir);
    expect(state.pending).toBeNull();
    expect(state.current).toEqual(installed("1.0.0"));
    expect(state.lastResult).toMatchObject({
      logTail: ["boom: bad migration"],
      outcome: "rolled-back",
      phase: "startup",
    });
  });

  it("uses the launcher's recorded failure reason for a probation rollback", async () => {
    const dataDir = scratchDir();
    const launcher = scriptedLauncher([
      async () => {
        await mutateAppUpdateState(dataDir, (state) => ({
          ...state,
          pending: pendingUpdate({
            from: revision("1.0.0"),
            to: revision("1.1.0"),
          }),
        }));
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      async () => {
        await mutateAppUpdateState(dataDir, (state) => ({
          ...state,
          pending:
            state.pending === null
              ? null
              : {
                  ...state.pending,
                  failure: {
                    message: "The server stopped 3 times.",
                    phase: "probation",
                  },
                  healthyAt: "2026-09-23T00:00:05.000Z",
                },
        }));
        return { code: 76, signal: null };
      },
      () => exit(0),
    ]);

    await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect((await readAppUpdateState(dataDir)).lastResult).toMatchObject({
      message: "The server stopped 3 times.",
      outcome: "rolled-back",
      phase: "probation",
    });
  });

  it("records a failed rollback and keeps the backup when the restore fails", async () => {
    const dataDir = scratchDir();
    const missingBackup = join(dataDir, "app-update-backups", "gone");
    const launcher = scriptedLauncher([
      async () => {
        await mutateAppUpdateState(dataDir, (state) => ({
          ...state,
          pending: pendingUpdate({
            databaseBackupDir: missingBackup,
            from: revision("1.0.0"),
            to: revision("1.1.0"),
          }),
        }));
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      () => exit(1),
      () => exit(0),
    ]);

    await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect((await readAppUpdateState(dataDir)).lastResult).toMatchObject({
      outcome: "rollback-failed",
      phase: "rollback",
    });
  });

  it("marks the rollback failed when the previous version also dies at once", async () => {
    const dataDir = scratchDir();
    const launcher = scriptedLauncher([
      async () => {
        await mutateAppUpdateState(dataDir, (state) => ({
          ...state,
          pending: pendingUpdate({
            from: revision("1.0.0"),
            to: revision("1.1.0"),
          }),
        }));
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      () => exit(1),
      () => exit(1),
    ]);
    const shimOutput = output();

    const code = await runNpmShim(
      shimArgs({
        dataDir,
        now: () => 0,
        output: shimOutput,
        spawnLauncher: launcher.spawnLauncher,
      }),
    );

    expect(code).toBe(1);
    expect((await readAppUpdateState(dataDir)).lastResult?.outcome).toBe(
      "rollback-failed",
    );
    expect(shimOutput.lines.some((line) => line.startsWith("error:"))).toBe(
      true,
    );
  });

  it("cancels the switch and drops the backup when bb is stopped during the restart", async () => {
    const dataDir = scratchDir();
    const backupDir = writeBackup(dataDir, "snapshot");
    const launcher = scriptedLauncher([
      async () => {
        await mutateAppUpdateState(dataDir, (state) => ({
          ...state,
          pending: pendingUpdate({
            databaseBackupDir: backupDir,
            from: revision("1.0.0"),
            to: revision("1.1.0"),
          }),
        }));
        process.emit("SIGTERM");
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
    ]);

    const code = await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(code).toBe(0);
    expect(launcher.launches).toEqual(["1.0.0"]);
    expect(existsSync(backupDir)).toBe(false);
    const state = await readAppUpdateState(dataDir);
    expect(state.pending).toBeNull();
    expect(state.lastResult).toMatchObject({
      outcome: "failed",
      phase: "prepare",
    });
  });

  it("keeps a healthy update's pending record when the user stops bb during probation", async () => {
    const dataDir = scratchDir();
    const launcher = scriptedLauncher([
      async () => {
        await mutateAppUpdateState(dataDir, (state) => ({
          ...state,
          pending: pendingUpdate({
            from: revision("1.0.0"),
            to: revision("1.1.0"),
          }),
        }));
        return { code: APP_UPDATE_RESTART_EXIT_CODE, signal: null };
      },
      () => exit(0),
    ]);

    await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect((await readAppUpdateState(dataDir)).pending?.id).toBe("update-1");
  });

  it("confirms a pending update that was healthy before bb stopped", async () => {
    const dataDir = scratchDir();
    const backupDir = writeBackup(dataDir, "old snapshot");
    writeFileSync(join(dataDir, "bb.db"), "written after the update");
    await mutateAppUpdateState(dataDir, (state) => ({
      ...state,
      current: installed("1.1.0"),
      pending: pendingUpdate({
        databaseBackupDir: backupDir,
        from: revision("1.0.0"),
        healthyAt: "2026-09-01T00:00:00.000Z",
        to: revision("1.1.0"),
      }),
    }));
    const launcher = scriptedLauncher([() => exit(1)]);

    const code = await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(code).toBe(1);
    expect(launcher.launches).toEqual(["1.1.0"]);
    expect(readFileSync(join(dataDir, "bb.db"), "utf8")).toBe(
      "written after the update",
    );
    expect(existsSync(backupDir)).toBe(false);
    expect((await readAppUpdateState(dataDir)).pending).toBeNull();
  });

  it("rolls back a pending update that never became healthy instead of resuming it", async () => {
    const dataDir = scratchDir();
    const backupDir = writeBackup(dataDir, "before the update");
    writeFileSync(join(dataDir, "bb.db"), "half migrated");
    await mutateAppUpdateState(dataDir, (state) => ({
      ...state,
      current: installed("1.1.0"),
      pending: pendingUpdate({
        databaseBackupDir: backupDir,
        from: revision("1.0.0"),
        to: revision("1.1.0"),
      }),
    }));
    const launcher = scriptedLauncher([() => exit(0)]);

    await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(launcher.launches).toEqual(["1.0.0"]);
    expect(readFileSync(join(dataDir, "bb.db"), "utf8")).toBe(
      "before the update",
    );
    expect((await readAppUpdateState(dataDir)).lastResult).toMatchObject({
      outcome: "rolled-back",
      phase: "startup",
    });
  });

  it("finishes a rollback that was interrupted after it started", async () => {
    const dataDir = scratchDir();
    const backupDir = writeBackup(dataDir, "before the update");
    await mutateAppUpdateState(dataDir, (state) => ({
      ...state,
      current: installed("1.1.0"),
      pending: pendingUpdate({
        databaseBackupDir: backupDir,
        from: revision("1.0.0"),
        healthyAt: "2026-09-23T00:00:05.000Z",
        rollbackStartedAt: "2026-09-23T00:01:00.000Z",
        to: revision("1.1.0"),
      }),
    }));
    const launcher = scriptedLauncher([() => exit(0)]);

    await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(launcher.launches).toEqual(["1.0.0"]);
    expect(readFileSync(join(dataDir, "bb.db"), "utf8")).toBe(
      "before the update",
    );
  });

  it("stays hands-off when another shim manages the data directory", async () => {
    const dataDir = scratchDir();
    const backupDir = writeBackup(dataDir, "snapshot");
    writeFileSync(join(dataDir, "bb.db"), "live data");
    await mutateAppUpdateState(dataDir, (state) => ({
      ...state,
      pending: pendingUpdate({
        databaseBackupDir: backupDir,
        from: revision("1.0.0"),
        healthyAt: "2026-09-23T00:00:05.000Z",
        to: revision("1.1.0"),
      }),
    }));
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
    expect(launcher.modes).toEqual(["passive"]);
    expect(readFileSync(join(dataDir, "bb.db"), "utf8")).toBe("live data");
    expect(existsSync(backupDir)).toBe(true);
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

  it("keeps unknown fields a newer bb added to the state file", async () => {
    const dataDir = scratchDir();
    writeFileSync(
      formatAppUpdateStatePath(dataDir),
      JSON.stringify({
        current: null,
        futureField: { keep: true },
        lastResult: null,
        pending: pendingUpdate({
          from: revision("1.0.0"),
          to: revision("1.1.0"),
        }),
        schemaVersion: 1,
      }),
    );
    const launcher = scriptedLauncher([() => exit(0)]);

    await runNpmShim(
      shimArgs({ dataDir, spawnLauncher: launcher.spawnLauncher }),
    );

    expect(
      JSON.parse(readFileSync(formatAppUpdateStatePath(dataDir), "utf8")),
    ).toMatchObject({ futureField: { keep: true }, pending: null });
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
