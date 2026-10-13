import { rm, rmdir } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { ServerMoveStepId } from "@bb/domain";
import { readServerMovedFile } from "@bb/server-archive";
import type { ServerMoveStatus } from "@bb/server-contract";
import type { ServerLogger } from "../../types.js";
import { SERVER_MOVE_WORK_DIR_NAME } from "./coordinator.js";
import {
  readServerMoveRunFile,
  removeServerMoveRunFile,
  type ServerMoveRunFile,
} from "./run-state.js";
import {
  restoreOldServerDaemonConfig,
  unlockOldServerDataDir,
} from "./switch.js";

export type RestoredServerMoveRun =
  | { kind: "completed"; movedAt: number; run: ServerMoveRunFile }
  | { kind: "ended"; run: ServerMoveRunFile }
  | { kind: "recovery_required"; run: ServerMoveRunFile };

export interface ReconcileServerMoveRunAtBootArgs {
  dataDir: string;
  logger: Pick<ServerLogger, "error" | "info" | "warn">;
  now: number;
}

const RESTARTED_MESSAGE =
  "The server restarted before the move finished, so nothing switched over";

function unfinishedStepId(status: ServerMoveStatus): ServerMoveStepId {
  return (
    status.steps.find((step) => step.status === "running")?.id ??
    status.steps.find((step) => step.status === "pending")?.id ??
    "switch"
  );
}

function abandonedStatus(
  status: ServerMoveStatus,
  now: number,
): ServerMoveStatus {
  return {
    ...status,
    state: "failed",
    cancellable: false,
    finishedAt: now,
    error: { step: unfinishedStepId(status), message: RESTARTED_MESSAGE },
    steps: status.steps.map((step) =>
      step.status === "running"
        ? { ...step, status: "failed", message: RESTARTED_MESSAGE }
        : step,
    ),
  };
}

function completedStatus(
  status: ServerMoveStatus,
  now: number,
): ServerMoveStatus {
  return {
    ...status,
    state: "completed",
    cancellable: false,
    error: null,
    finishedAt: status.finishedAt ?? now,
    steps: status.steps.map((step) =>
      step.id === "switch"
        ? {
            ...step,
            status: "done",
            message: `The server now runs on ${status.targetHostName}`,
          }
        : step,
    ),
  };
}

function recoveryStatus(status: ServerMoveStatus): ServerMoveStatus {
  const name = status.targetHostName;
  return {
    ...status,
    state: "recovery_required",
    cancellable: true,
    finishedAt: null,
    error: status.error ?? {
      step: "switch",
      message: `The server restarted before ${name} confirmed it took over`,
    },
    steps: status.steps.map((step) =>
      step.id === "switch"
        ? {
            ...step,
            status: "running",
            message: `Waiting for ${name} to confirm it took over`,
          }
        : step,
    ),
  };
}

async function readRunFile(
  args: ReconcileServerMoveRunAtBootArgs,
): Promise<ServerMoveRunFile | null> {
  try {
    return await readServerMoveRunFile(args.dataDir);
  } catch (error) {
    args.logger.error(
      { err: error },
      "Ignoring an unreadable server-move-run.json at boot",
    );
    return null;
  }
}

async function removeWorkDir(
  args: ReconcileServerMoveRunAtBootArgs,
  workDir: string,
): Promise<void> {
  const moveRoot = resolve(args.dataDir, SERVER_MOVE_WORK_DIR_NAME);
  const target = resolve(workDir);
  if (!target.startsWith(`${moveRoot}${sep}`)) {
    args.logger.warn(
      { workDir },
      "Not removing a recorded server move work directory outside the data directory",
    );
    return;
  }
  try {
    await rm(target, { force: true, recursive: true });
    await rmdir(moveRoot).catch(() => undefined);
  } catch (error) {
    args.logger.warn(
      { err: error, workDir },
      "Could not remove a server move work directory at boot",
    );
  }
}

async function bestEffort(
  args: ReconcileServerMoveRunAtBootArgs,
  message: string,
  work: () => Promise<void>,
): Promise<void> {
  try {
    await work();
  } catch (error) {
    args.logger.error({ err: error }, message);
  }
}

export async function reconcileServerMoveRunAtBoot(
  args: ReconcileServerMoveRunAtBootArgs,
): Promise<RestoredServerMoveRun | null> {
  const run = await readRunFile(args);
  if (run === null) {
    return null;
  }
  const moveId = run.status.moveId;
  await removeWorkDir(args, run.workDir);
  const lock = await readServerMovedFile(args.dataDir).catch(() => null);
  const locked = lock !== null && lock.moveId === moveId;
  const terminal =
    run.status.state === "failed" || run.status.state === "cancelled";
  if (lock !== null && locked && !terminal) {
    if (run.activationConfirmedAt !== null) {
      args.logger.info(
        { moveId },
        "Republishing a committed server move after a restart",
      );
      return {
        kind: "completed",
        movedAt: lock.movedAt,
        run: { ...run, status: completedStatus(run.status, args.now) },
      };
    }
    args.logger.warn(
      { moveId },
      "A server move restarted before the target confirmed activation; recovery is required",
    );
    return {
      kind: "recovery_required",
      run: { ...run, status: recoveryStatus(run.status) },
    };
  }
  if (!terminal && run.activationConfirmedAt !== null) {
    await bestEffort(
      args,
      "Could not remove server-move-run.json at boot",
      () => removeServerMoveRunFile(args.dataDir),
    );
    args.logger.info(
      { moveId },
      "Forgetting a committed server move whose old copy was unlocked",
    );
    return null;
  }
  if (locked) {
    await bestEffort(
      args,
      "Could not remove server-moved.json for an abandoned server move",
      () => unlockOldServerDataDir(args.dataDir),
    );
  }
  const configBackup = run.configBackup;
  if (configBackup !== null) {
    await bestEffort(
      args,
      "Could not restore config.json for an abandoned server move",
      () => restoreOldServerDaemonConfig(configBackup),
    );
  }
  args.logger.warn(
    { moveId, state: run.status.state },
    "Abandoned a server move that did not finish before a restart",
  );
  return {
    kind: "ended",
    run: terminal
      ? run
      : { ...run, status: abandonedStatus(run.status, args.now) },
  };
}
