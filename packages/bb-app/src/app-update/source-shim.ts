import {
  APP_UPDATE_RESTART_EXIT_CODE,
  mutateAppUpdateState,
  readAppUpdateStateFile,
  type AppUpdatePending,
  type SourceAppRevision,
} from "@bb/config/app-update";
import type { ChildProcessExitResult } from "@bb/config/child-process-exit";
import type { RunCommand } from "./run-command.js";
import { fastForwardSource } from "./source-checkout.js";
import {
  acquireShimLock,
  formatRevision,
  installShimSignalForwarding,
  toShimExitCode,
  type AcquireShimLock,
  type LauncherRun,
  type LauncherUpdateMode,
  type ShimOutput,
} from "./shim-support.js";

type SourcePending = AppUpdatePending & {
  from: SourceAppRevision;
  to: SourceAppRevision;
};

export interface RunSourceShimArgs {
  acquireLock?: AcquireShimLock;
  dataDir: string;
  installDependencies: () => Promise<void>;
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
      await mutateAppUpdateState(args.dataDir, (state) => ({
        ...state,
        lastResult: {
          acknowledged: false,
          finishedAt: new Date().toISOString(),
          from: pending.from,
          id: pending.id,
          logTail: [],
          message: errorMessage(error),
          outcome: "failed",
          phase: "install",
          to: pending.to,
        },
        pending: state.pending?.id === pending.id ? null : state.pending,
      }));
      args.output.warn(`Could not update bb: ${errorMessage(error)}`);
      return true;
    }
    try {
      await args.installDependencies();
      await args.prepareRuntime();
      return true;
    } catch (error) {
      args.output.error(
        `Rebuilding bb ${formatRevision(pending.to)} failed: ${errorMessage(error)} Fix the build and run pnpm start again.`,
      );
      return false;
    }
  };

  const run = async (
    mode: LauncherUpdateMode,
  ): Promise<ChildProcessExitResult> => {
    running = args.spawnLauncher(mode);
    const exit = await running.exit;
    running = null;
    return exit;
  };

  const lock = await (args.acquireLock ?? acquireShimLock)(args.dataDir);
  try {
    if (lock === null) {
      args.output.info(
        "Another bb is managing this data directory; in-app updates are off for this run.",
      );
      return toShimExitCode(await run("passive"));
    }
    if ((await readAppUpdateStateFile(args.dataDir)) === null) {
      args.output.info(
        "bb-app-update.json was written by a newer bb; in-app updates are off for this run.",
      );
      return toShimExitCode(await run("passive"));
    }
    for (;;) {
      const exit = await run("source");
      if (exit.code !== APP_UPDATE_RESTART_EXIT_CODE) {
        return toShimExitCode(exit);
      }
      if (shuttingDown) return 0;
      const pending = asSourcePending(
        (await readAppUpdateStateFile(args.dataDir))?.pending ?? null,
      );
      if (
        pending !== null &&
        (await readHead()) === pending.from.commit &&
        !(await applyPending(pending))
      ) {
        return 1;
      }
    }
  } finally {
    removeSignalForwarding();
    await lock?.release();
  }
}
