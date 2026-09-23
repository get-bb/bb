import { join } from "node:path";
import {
  APP_UPDATE_RESTART_EXIT_CODE,
  mutateAppUpdateState,
  readAppUpdateStateFile,
  type AppUpdatePending,
  type SourceAppRevision,
} from "@bb/config/app-update";
import type { RunCommand } from "./run-command.js";
import { fastForwardSource, revertSource } from "./source-checkout.js";
import {
  acquireShimLock,
  commitPendingUpdate,
  describeInterruptedPending,
  describeLauncherFailure,
  discardDatabaseBackup,
  formatExit,
  formatRevision,
  installShimSignalForwarding,
  markRollbackFailed,
  markRollbackStarted,
  readServerLogOffset,
  readServerLogTail,
  recordUpdateResult,
  restorePendingDatabase,
  ROLLBACK_FAILURE_WINDOW_MS,
  shouldCommitPendingAtStartup,
  sweepDatabaseBackups,
  toShimExitCode,
  type AcquireShimLock,
  type LauncherRun,
  type LauncherUpdateMode,
  type ShimOutput,
  type ShimPaths,
  type UpdateFailure,
} from "./shim-support.js";

type SourcePending = AppUpdatePending & {
  from: SourceAppRevision;
  to: SourceAppRevision;
};

export interface RunSourceShimArgs extends ShimPaths {
  acquireLock?: AcquireShimLock;
  installDependencies: () => Promise<void>;
  now?: () => number;
  output: ShimOutput;
  prepareRuntime: () => Promise<void>;
  readHead: () => Promise<string>;
  repoRoot: string;
  runner: RunCommand;
  spawnLauncher: (mode: LauncherUpdateMode) => LauncherRun;
}

function asSourcePending(
  pending: AppUpdatePending | null,
): SourcePending | null {
  if (
    pending === null ||
    pending.from.kind !== "source" ||
    pending.to.kind !== "source"
  ) {
    return null;
  }
  return { ...pending, from: pending.from, to: pending.to };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runSourceShim(args: RunSourceShimArgs): Promise<number> {
  const now = args.now ?? Date.now;
  let shuttingDown = false;
  let running: LauncherRun | null = null;
  const removeSignalForwarding = installShimSignalForwarding({
    current: () => running,
    onShutdown: () => {
      shuttingDown = true;
    },
  });

  const readHead = async (): Promise<string | null> => {
    try {
      return await args.readHead();
    } catch {
      return null;
    }
  };

  const rebuild = async (): Promise<void> => {
    await args.installDependencies();
    await args.prepareRuntime();
  };

  const recordCancelled = async (
    pending: SourcePending,
    message: string,
  ): Promise<void> => {
    await recordUpdateResult({
      dataDir: args.dataDir,
      discardBackup: true,
      failure: { message, phase: "prepare" },
      logTail: [],
      outcome: "failed",
      pending,
    });
  };

  const rollBack = async (
    pending: SourcePending,
    failure: UpdateFailure,
    logOffset: number | null,
  ): Promise<boolean> => {
    args.output.warn(
      `bb ${formatRevision(pending.to)} failed: ${failure.message} Rolling back to ${formatRevision(pending.from)}.`,
    );
    await markRollbackStarted({ dataDir: args.dataDir, pendingId: pending.id });
    const logTail =
      logOffset === null ? [] : await readServerLogTail(args.logDir, logOffset);
    const recordRollbackFailure = async (
      message: string,
      discardBackup: boolean,
    ): Promise<false> => {
      await recordUpdateResult({
        dataDir: args.dataDir,
        discardBackup,
        failure: {
          message: `${failure.message} ${message}`,
          phase: "rollback",
        },
        logTail,
        outcome: "rollback-failed",
        pending,
      });
      args.output.error(message);
      return false;
    };
    try {
      await revertSource({
        repoRoot: args.repoRoot,
        runner: args.runner,
        to: pending.from.commit,
      });
    } catch (error) {
      return recordRollbackFailure(
        `Rolling back to ${formatRevision(pending.from)} failed: ${errorMessage(error)}`,
        false,
      );
    }
    const restoreError = await restorePendingDatabase({
      dbPath: args.dbPath,
      pending,
    });
    if (restoreError !== null) {
      return recordRollbackFailure(
        `Restoring the database backup failed: ${restoreError}`,
        false,
      );
    }
    try {
      await rebuild();
    } catch (error) {
      return recordRollbackFailure(
        `Rebuilding ${formatRevision(pending.from)} failed: ${errorMessage(error)}`,
        true,
      );
    }
    await recordUpdateResult({
      dataDir: args.dataDir,
      discardBackup: true,
      failure,
      logTail,
      outcome: "rolled-back",
      pending,
    });
    return true;
  };

  const applyPending = async (pending: SourcePending): Promise<boolean> => {
    args.output.info(`Updating bb to ${formatRevision(pending.to)}`);
    try {
      await fastForwardSource({
        from: pending.from.commit,
        repoRoot: args.repoRoot,
        runner: args.runner,
        to: pending.to.commit,
      });
    } catch (error) {
      await recordUpdateResult({
        dataDir: args.dataDir,
        discardBackup: true,
        failure: { message: errorMessage(error), phase: "install" },
        logTail: [],
        outcome: "failed",
        pending,
      });
      args.output.warn(`Could not update bb: ${errorMessage(error)}`);
      return true;
    }
    try {
      await rebuild();
      return true;
    } catch (error) {
      return rollBack(
        pending,
        { message: errorMessage(error), phase: "install" },
        null,
      );
    }
  };

  const resolveStartupPending = async (
    pending: AppUpdatePending | null,
  ): Promise<boolean> => {
    if (pending === null) {
      await sweepDatabaseBackups(args.dataDir, null);
      return true;
    }
    const sourcePending = asSourcePending(pending);
    if (sourcePending === null) {
      await mutateAppUpdateState(args.dataDir, (current) => ({
        ...current,
        pending: null,
      }));
      await discardDatabaseBackup(pending.databaseBackupDir);
      return true;
    }
    if (shouldCommitPendingAtStartup(sourcePending)) {
      await commitPendingUpdate({ dataDir: args.dataDir, pending });
      args.output.info(
        `Confirmed the update to bb ${formatRevision(sourcePending.to)}`,
      );
      return true;
    }
    const head = await readHead();
    if (head === sourcePending.to.commit) {
      return rollBack(
        sourcePending,
        describeInterruptedPending(sourcePending),
        null,
      );
    }
    await recordCancelled(
      sourcePending,
      head === sourcePending.from.commit
        ? `bb stopped before the update to ${formatRevision(sourcePending.to)} started.`
        : "The checkout changed while an update was pending.",
    );
    return true;
  };

  const lock = await (args.acquireLock ?? acquireShimLock)(args.dataDir);
  const runPassive = async (reason: string): Promise<number> => {
    args.output.info(reason);
    running = args.spawnLauncher("passive");
    const exit = await running.exit;
    running = null;
    return toShimExitCode(exit);
  };

  try {
    const initialState = await readAppUpdateStateFile(args.dataDir);
    if (lock === null) {
      return await runPassive(
        "Another bb is managing this data directory; in-app updates are off for this run.",
      );
    }
    if (initialState === null) {
      return await runPassive(
        "bb-app-update.json was written by a newer bb; in-app updates are off for this run.",
      );
    }
    if (!(await resolveStartupPending(initialState.pending))) return 1;
    let launchIsRollback = false;
    let switchedPendingId: string | null = null;
    for (;;) {
      if (shuttingDown) return 0;
      const startedAt = now();
      const logOffset = await readServerLogOffset(args.logDir);
      running = args.spawnLauncher("source");
      const exit = await running.exit;
      running = null;

      const pending = asSourcePending(
        (await readAppUpdateStateFile(args.dataDir))?.pending ?? null,
      );
      const head = pending === null ? null : await readHead();
      const restartRequested = exit.code === APP_UPDATE_RESTART_EXIT_CODE;
      if (shuttingDown) {
        if (
          restartRequested &&
          pending !== null &&
          head === pending.from.commit
        ) {
          await recordCancelled(
            pending,
            `bb was stopped before it restarted into ${formatRevision(pending.to)}.`,
          );
        }
        return restartRequested ? 0 : toShimExitCode(exit);
      }
      if (restartRequested) {
        launchIsRollback = false;
        if (pending !== null && head === pending.from.commit) {
          if (!(await applyPending(pending))) return 1;
          switchedPendingId =
            (await readHead()) === pending.to.commit ? pending.id : null;
        }
        continue;
      }
      if (
        pending !== null &&
        pending.id === switchedPendingId &&
        head === pending.to.commit
      ) {
        if (exit.code === 0) return 0;
        if (
          !(await rollBack(
            pending,
            describeLauncherFailure(pending, exit),
            logOffset,
          ))
        ) {
          return 1;
        }
        switchedPendingId = null;
        launchIsRollback = true;
        continue;
      }
      if (
        launchIsRollback &&
        exit.code !== 0 &&
        now() - startedAt < ROLLBACK_FAILURE_WINDOW_MS
      ) {
        const message = `bb also failed after the rollback (${formatExit(exit)}).`;
        await markRollbackFailed({ dataDir: args.dataDir, message });
        args.output.error(
          `${message} Check ${join(args.logDir, "server-stdio.log")} and restart bb.`,
        );
      }
      return toShimExitCode(exit);
    }
  } finally {
    removeSignalForwarding();
    await lock?.release();
  }
}
