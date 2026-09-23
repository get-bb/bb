import { join } from "node:path";
import semver from "semver";
import {
  APP_UPDATE_RESTART_EXIT_CODE,
  mutateAppUpdateState,
  readAppUpdateStateFile,
  type AppUpdatePending,
  type AppUpdateState,
  type InstalledNpmAppRevision,
  type NpmAppRevision,
} from "@bb/config/app-update";
import { isUsableNpmRevision } from "./npm-revision.js";
import {
  acquireShimLock,
  commitPendingUpdate,
  createLauncherEnv,
  describeInterruptedPending,
  describeLauncherFailure,
  discardDatabaseBackup,
  formatExit,
  installedNpmRevision,
  installShimSignalForwarding,
  isSameRevision,
  markRollbackFailed,
  markRollbackStarted,
  readServerLogOffset,
  readServerLogTail,
  recordUpdateResult,
  restorePendingDatabase,
  ROLLBACK_FAILURE_WINDOW_MS,
  shouldCommitPendingAtStartup,
  spawnLauncherProcess,
  sweepDatabaseBackups,
  toShimExitCode,
  type AcquireShimLock,
  type LauncherRun,
  type LauncherUpdateMode,
  type ShimOutput,
  type ShimPaths,
  type UpdateFailure,
} from "./shim-support.js";

type NpmPending = AppUpdatePending & {
  from: NpmAppRevision;
  to: NpmAppRevision;
};

export interface RunNpmShimArgs extends ShimPaths {
  acquireLock?: AcquireShimLock;
  bundled: NpmAppRevision;
  isUsable?: (revision: NpmAppRevision) => boolean;
  nodeAbi?: string;
  now?: () => number;
  output: ShimOutput;
  spawnLauncher: (
    revision: NpmAppRevision,
    mode: LauncherUpdateMode,
  ) => LauncherRun;
  useBundled: boolean;
}

export interface NpmRevisionSelection {
  reason: "abi-mismatch" | "bundled-newer" | "installed-newer" | "none";
  revision: NpmAppRevision;
}

export function selectNpmRevision(args: {
  bundled: NpmAppRevision;
  current: InstalledNpmAppRevision | null;
  isUsable: (revision: NpmAppRevision) => boolean;
  nodeAbi: string;
}): NpmRevisionSelection {
  const current = args.current;
  if (current === null || !args.isUsable(current)) {
    return { reason: "none", revision: args.bundled };
  }
  if (
    semver.valid(current.version) === null ||
    semver.valid(args.bundled.version) === null ||
    !semver.gt(current.version, args.bundled.version)
  ) {
    return { reason: "bundled-newer", revision: args.bundled };
  }
  if (current.nodeAbi !== args.nodeAbi) {
    return { reason: "abi-mismatch", revision: args.bundled };
  }
  return { reason: "installed-newer", revision: current };
}

export function spawnNpmLauncher(args: {
  cliArgs: string[];
  mode: LauncherUpdateMode;
  revision: NpmAppRevision;
}): LauncherRun {
  return spawnLauncherProcess({
    args: [
      join(args.revision.packageRoot, "dist", "bb-app.js"),
      ...args.cliArgs,
    ],
    env: createLauncherEnv(args.mode),
  });
}

function asNpmPending(pending: AppUpdatePending | null): NpmPending | null {
  if (
    pending === null ||
    pending.from.kind !== "npm" ||
    pending.to.kind !== "npm"
  ) {
    return null;
  }
  return { ...pending, from: pending.from, to: pending.to };
}

export async function runNpmShim(args: RunNpmShimArgs): Promise<number> {
  const now = args.now ?? Date.now;
  const isUsable = args.isUsable ?? isUsableNpmRevision;
  const nodeAbi = args.nodeAbi ?? process.versions.modules;
  let shuttingDown = false;
  let running: LauncherRun | null = null;
  const removeSignalForwarding = installShimSignalForwarding({
    current: () => running,
    onShutdown: () => {
      shuttingDown = true;
    },
  });

  const select = (state: AppUpdateState | null): NpmAppRevision => {
    if (args.useBundled || state === null) return args.bundled;
    const selection = selectNpmRevision({
      bundled: args.bundled,
      current: state.current,
      isUsable,
      nodeAbi,
    });
    if (selection.reason === "installed-newer") {
      args.output.info(
        `Using bb-app ${selection.revision.version} from an in-app update. Run with --bundled to use ${args.bundled.version}.`,
      );
    } else if (selection.reason === "abi-mismatch" && state.current !== null) {
      args.output.warn(
        `bb-app ${state.current.version} from an in-app update was installed for a different Node.js version; using ${args.bundled.version}.`,
      );
    }
    return selection.revision;
  };

  const rollBack = async (
    pending: NpmPending,
    failure: UpdateFailure,
    logOffset: number | null,
  ): Promise<NpmAppRevision> => {
    await markRollbackStarted({ dataDir: args.dataDir, pendingId: pending.id });
    const restoreError = await restorePendingDatabase({
      dbPath: args.dbPath,
      pending,
    });
    const from = isUsable(pending.from) ? pending.from : args.bundled;
    const recordedFailure: UpdateFailure =
      restoreError === null
        ? failure
        : {
            message: `${failure.message} Restoring the database backup failed: ${restoreError}`,
            phase: "rollback",
          };
    await recordUpdateResult({
      current: installedNpmRevision(from, nodeAbi),
      dataDir: args.dataDir,
      discardBackup: restoreError === null,
      failure: recordedFailure,
      logTail:
        logOffset === null
          ? []
          : await readServerLogTail(args.logDir, logOffset),
      outcome: restoreError === null ? "rolled-back" : "rollback-failed",
      pending,
    });
    args.output.warn(
      `bb-app ${pending.to.version} failed: ${recordedFailure.message} Rolling back to ${from.version}.`,
    );
    return from;
  };

  const cancel = async (pending: AppUpdatePending): Promise<void> => {
    await recordUpdateResult({
      dataDir: args.dataDir,
      discardBackup: true,
      failure: {
        message: `bb was stopped before it restarted into ${pending.to.version}.`,
        phase: "prepare",
      },
      logTail: [],
      outcome: "failed",
      pending,
    });
  };

  const switchTo = async (pending: NpmPending): Promise<NpmAppRevision> => {
    if (!isUsable(pending.to)) {
      return rollBack(
        pending,
        {
          message: `The downloaded bb-app ${pending.to.version} is missing or incomplete.`,
          phase: "install",
        },
        null,
      );
    }
    await mutateAppUpdateState(args.dataDir, (state) => ({
      ...state,
      current: installedNpmRevision(pending.to, nodeAbi),
    }));
    args.output.info(`Restarting into bb-app ${pending.to.version}`);
    return pending.to;
  };

  const resolveStartupPending = async (
    state: AppUpdateState,
  ): Promise<NpmAppRevision | null> => {
    if (state.pending === null) {
      await sweepDatabaseBackups(args.dataDir, null);
      return null;
    }
    const pending = asNpmPending(state.pending);
    if (pending === null) {
      await mutateAppUpdateState(args.dataDir, (current) => ({
        ...current,
        pending: null,
      }));
      await discardDatabaseBackup(state.pending.databaseBackupDir);
      return null;
    }
    if (shouldCommitPendingAtStartup(pending)) {
      await commitPendingUpdate({ dataDir: args.dataDir, pending });
      args.output.info(`Confirmed the update to bb-app ${pending.to.version}`);
      return null;
    }
    return rollBack(pending, describeInterruptedPending(pending), null);
  };

  const runPassive = async (reason: string, launch: NpmAppRevision) => {
    args.output.info(reason);
    running = args.spawnLauncher(launch, "passive");
    const exit = await running.exit;
    running = null;
    return toShimExitCode(exit);
  };

  const lock = await (args.acquireLock ?? acquireShimLock)(args.dataDir);
  try {
    const initialState = await readAppUpdateStateFile(args.dataDir);
    if (lock === null) {
      return await runPassive(
        "Another bb-app is managing this data directory; in-app updates are off for this run.",
        select(initialState),
      );
    }
    if (initialState === null) {
      return await runPassive(
        "bb-app-update.json was written by a newer bb; in-app updates are off for this run.",
        args.bundled,
      );
    }
    let launch =
      (await resolveStartupPending(initialState)) ??
      select(await readAppUpdateStateFile(args.dataDir));
    let launchIsRollback = false;
    let switchedPendingId: string | null = null;
    for (;;) {
      if (shuttingDown) return 0;
      const startedAt = now();
      const logOffset = await readServerLogOffset(args.logDir);
      running = args.spawnLauncher(launch, "npm");
      const exit = await running.exit;
      running = null;

      const state = await readAppUpdateStateFile(args.dataDir);
      const pending = asNpmPending(state?.pending ?? null);
      const restartRequested = exit.code === APP_UPDATE_RESTART_EXIT_CODE;
      if (shuttingDown) {
        if (
          restartRequested &&
          pending !== null &&
          isSameRevision(pending.from, launch)
        ) {
          await cancel(pending);
        }
        return restartRequested ? 0 : toShimExitCode(exit);
      }
      if (restartRequested) {
        launchIsRollback = false;
        if (pending !== null && isSameRevision(pending.from, launch)) {
          launch = await switchTo(pending);
          switchedPendingId = launch === pending.to ? pending.id : null;
        }
        continue;
      }
      if (
        pending !== null &&
        pending.id === switchedPendingId &&
        isSameRevision(pending.to, launch)
      ) {
        if (exit.code === 0) return 0;
        launch = await rollBack(
          pending,
          describeLauncherFailure(pending, exit),
          logOffset,
        );
        switchedPendingId = null;
        launchIsRollback = true;
        continue;
      }
      if (
        launchIsRollback &&
        exit.code !== 0 &&
        now() - startedAt < ROLLBACK_FAILURE_WINDOW_MS
      ) {
        const message = `bb-app ${launch.version} also failed after the rollback (${formatExit(exit)}).`;
        await markRollbackFailed({ dataDir: args.dataDir, message });
        args.output.error(
          `${message} Check ${join(args.logDir, "server-stdio.log")} and restart bb-app.`,
        );
      }
      return toShimExitCode(exit);
    }
  } finally {
    removeSignalForwarding();
    await lock?.release();
  }
}
