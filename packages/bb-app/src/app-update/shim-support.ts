import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  APP_UPDATE_LOG_TAIL_LINES,
  APP_UPDATE_MODE_ENV_NAME,
  APP_UPDATE_PASSIVE_MODE,
  APP_UPDATE_SHIM_PROTOCOL_ENV_NAME,
  APP_UPDATE_SHIM_PROTOCOL_VERSION,
  formatAppUpdateBackupsDir,
  formatAppUpdateShimLockPath,
  mutateAppUpdateState,
  type AppRevision,
  type AppUpdateFailurePhase,
  type AppUpdateMode,
  type AppUpdateOutcome,
  type AppUpdatePending,
  type InstalledNpmAppRevision,
  type NpmAppRevision,
} from "@bb/config/app-update";
import {
  waitForProcessExit,
  type ChildProcessExitResult,
} from "@bb/config/child-process-exit";
import { isProcessRunning } from "@bb/config/verified-process-stop";
import { restoreDatabase } from "./database-backup.js";

const LOG_TAIL_BYTES = 64 * 1024;
const SHUTDOWN_KILL_AFTER_MS = 12 * 1000;
export const ROLLBACK_FAILURE_WINDOW_MS = 3 * 60 * 1000;

export type LauncherUpdateMode = AppUpdateMode | typeof APP_UPDATE_PASSIVE_MODE;

export interface LauncherRun {
  exit: Promise<ChildProcessExitResult>;
  kill(signal: NodeJS.Signals): void;
}

export interface ShimOutput {
  error(message: string): void;
  info(message: string): void;
  warn(message: string): void;
}

export interface ShimPaths {
  dataDir: string;
  dbPath: string;
  logDir: string;
}

export interface UpdateFailure {
  message: string;
  phase: AppUpdateFailurePhase;
}

export interface ShimLock {
  release(): Promise<void>;
}

export type AcquireShimLock = (dataDir: string) => Promise<ShimLock | null>;

const shimLockFileSchema = z
  .object({
    entryPath: z.string().min(1),
    pid: z.number().int().positive(),
    startedAt: z.string().min(1),
  })
  .passthrough();
export type ShimLockFile = z.infer<typeof shimLockFileSchema>;

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function createLauncherEnv(mode: LauncherUpdateMode): NodeJS.ProcessEnv {
  return {
    ...process.env,
    [APP_UPDATE_MODE_ENV_NAME]: mode,
    [APP_UPDATE_SHIM_PROTOCOL_ENV_NAME]: String(
      APP_UPDATE_SHIM_PROTOCOL_VERSION,
    ),
  };
}

export function spawnLauncherProcess(args: {
  args: string[];
  env: NodeJS.ProcessEnv;
}): LauncherRun {
  const child = spawn(process.execPath, args.args, {
    env: args.env,
    stdio: "inherit",
  });
  return {
    exit: waitForProcessExit(child),
    kill(signal) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill(signal);
      }
    },
  };
}

export function installShimSignalForwarding(args: {
  current: () => LauncherRun | null;
  onShutdown: () => void;
}): () => void {
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  const forward = (signal: NodeJS.Signals): void => {
    args.onShutdown();
    args.current()?.kill(signal);
    killTimer ??= setTimeout(() => {
      args.current()?.kill("SIGKILL");
    }, SHUTDOWN_KILL_AFTER_MS);
    killTimer.unref();
  };
  const onSigint = (): void => forward("SIGINT");
  const onSigterm = (): void => forward("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return () => {
    if (killTimer !== null) clearTimeout(killTimer);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
}

async function readShimLockFile(path: string): Promise<ShimLockFile | null> {
  try {
    const parsed = shimLockFileSchema.safeParse(
      JSON.parse(await readFile(path, "utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function readLiveShimLock(
  dataDir: string,
): Promise<ShimLockFile | null> {
  const holder = await readShimLockFile(formatAppUpdateShimLockPath(dataDir));
  return holder !== null && isProcessRunning(holder.pid) ? holder : null;
}

export const acquireShimLock: AcquireShimLock = async (dataDir) => {
  const path = formatAppUpdateShimLockPath(dataDir);
  await mkdir(dataDir, { recursive: true });
  const record: ShimLockFile = {
    entryPath: process.argv[1] ?? "bb-app",
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(path, `${JSON.stringify(record)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      return {
        async release() {
          const holder = await readShimLockFile(path);
          if (holder?.pid === process.pid) await rm(path, { force: true });
        },
      };
    } catch (error) {
      if (!hasErrorCode(error, "EEXIST")) throw error;
      const holder = await readShimLockFile(path);
      if (
        holder !== null &&
        holder.pid !== process.pid &&
        isProcessRunning(holder.pid)
      ) {
        return null;
      }
      await rm(path, { force: true });
    }
  }
  return null;
};

export function toShimExitCode(exit: ChildProcessExitResult): number {
  if (exit.code !== null) return exit.code;
  return exit.signal === "SIGINT" || exit.signal === "SIGTERM" ? 0 : 1;
}

export function formatExit(exit: ChildProcessExitResult): string {
  if (exit.code !== null) return `exit code ${String(exit.code)}`;
  return `signal ${exit.signal ?? "unknown"}`;
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export function isSamePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

export function isSameRevision(left: AppRevision, right: AppRevision): boolean {
  if (left.kind === "npm" && right.kind === "npm") {
    return (
      left.version === right.version &&
      isSamePath(left.packageRoot, right.packageRoot)
    );
  }
  if (left.kind === "source" && right.kind === "source") {
    return left.commit === right.commit;
  }
  return false;
}

export function installedNpmRevision(
  revision: NpmAppRevision,
  nodeAbi: string,
): InstalledNpmAppRevision {
  return {
    kind: "npm",
    nodeAbi,
    packageRoot: revision.packageRoot,
    version: revision.version,
  };
}

export function formatRevision(revision: AppRevision): string {
  return revision.kind === "npm"
    ? revision.version
    : `${revision.version} (${revision.commit.slice(0, 10)})`;
}

export function shouldCommitPendingAtStartup(
  pending: AppUpdatePending,
): boolean {
  return (
    pending.healthyAt !== null &&
    pending.failure === null &&
    pending.rollbackStartedAt === null
  );
}

export function describeLauncherFailure(
  pending: AppUpdatePending,
  exit: ChildProcessExitResult,
): UpdateFailure {
  if (pending.failure !== null) {
    return { message: pending.failure.message, phase: pending.failure.phase };
  }
  const label = formatRevision(pending.to);
  return pending.healthyAt === null
    ? {
        message: `bb ${label} did not start (${formatExit(exit)}).`,
        phase: "startup",
      }
    : {
        message: `bb ${label} stopped unexpectedly (${formatExit(exit)}).`,
        phase: "probation",
      };
}

export function describeInterruptedPending(
  pending: AppUpdatePending,
): UpdateFailure {
  if (pending.failure !== null) {
    return { message: pending.failure.message, phase: pending.failure.phase };
  }
  return {
    message: `bb stopped before the update to ${formatRevision(pending.to)} finished starting.`,
    phase: "startup",
  };
}

export async function readLogTail(
  path: string,
  fromOffset = 0,
  lines = APP_UPDATE_LOG_TAIL_LINES,
): Promise<string[]> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    return [];
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(
      fromOffset > size ? 0 : fromOffset,
      size - LOG_TAIL_BYTES,
    );
    const length = size - start;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    return buffer
      .toString("utf8")
      .split(/\r?\n/u)
      .filter((line) => line.trim() !== "")
      .slice(-lines);
  } finally {
    await handle.close();
  }
}

function serverLogPath(logDir: string): string {
  return join(logDir, "server-stdio.log");
}

export async function readServerLogOffset(logDir: string): Promise<number> {
  try {
    return (await stat(serverLogPath(logDir))).size;
  } catch {
    return 0;
  }
}

export function readServerLogTail(
  logDir: string,
  fromOffset = 0,
): Promise<string[]> {
  return readLogTail(serverLogPath(logDir), fromOffset);
}

export async function discardDatabaseBackup(
  backupDir: string | null,
): Promise<void> {
  if (backupDir !== null) {
    await rm(backupDir, { force: true, recursive: true }).catch(
      () => undefined,
    );
  }
}

export async function sweepDatabaseBackups(
  dataDir: string,
  keepBackupDir: string | null,
): Promise<void> {
  const backupsDir = formatAppUpdateBackupsDir(dataDir);
  let entries: string[];
  try {
    entries = await readdir(backupsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const backupDir = join(backupsDir, entry);
    if (keepBackupDir !== null && isSamePath(backupDir, keepBackupDir)) {
      continue;
    }
    await rm(backupDir, { force: true, recursive: true }).catch(
      () => undefined,
    );
  }
}

export async function markRollbackStarted(args: {
  dataDir: string;
  pendingId: string;
}): Promise<void> {
  await mutateAppUpdateState(args.dataDir, (state) =>
    state.pending?.id !== args.pendingId ||
    state.pending.rollbackStartedAt !== null
      ? state
      : {
          ...state,
          pending: {
            ...state.pending,
            rollbackStartedAt: new Date().toISOString(),
          },
        },
  );
}

export async function restorePendingDatabase(args: {
  dbPath: string;
  pending: AppUpdatePending;
}): Promise<string | null> {
  if (args.pending.databaseBackupDir === null) return null;
  try {
    await restoreDatabase({
      backupDir: args.pending.databaseBackupDir,
      dbPath: args.dbPath,
    });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function commitPendingUpdate(args: {
  dataDir: string;
  pending: AppUpdatePending;
}): Promise<void> {
  await mutateAppUpdateState(args.dataDir, (state) =>
    state.pending?.id === args.pending.id ? { ...state, pending: null } : state,
  );
  await discardDatabaseBackup(args.pending.databaseBackupDir);
}

export async function recordUpdateResult(args: {
  current?: InstalledNpmAppRevision;
  dataDir: string;
  discardBackup: boolean;
  failure: UpdateFailure | null;
  logTail: string[];
  outcome: AppUpdateOutcome;
  pending: AppUpdatePending;
}): Promise<void> {
  await mutateAppUpdateState(args.dataDir, (state) => ({
    ...state,
    ...(args.current === undefined ? {} : { current: args.current }),
    lastResult: {
      acknowledged: false,
      finishedAt: new Date().toISOString(),
      from: args.pending.from,
      id: args.pending.id,
      logTail: args.logTail,
      message: args.failure?.message ?? null,
      outcome: args.outcome,
      phase: args.failure?.phase ?? null,
      to: args.pending.to,
    },
    pending: state.pending?.id === args.pending.id ? null : state.pending,
  }));
  if (args.discardBackup) {
    await discardDatabaseBackup(args.pending.databaseBackupDir);
  }
}

export async function markRollbackFailed(args: {
  dataDir: string;
  message: string;
}): Promise<void> {
  await mutateAppUpdateState(args.dataDir, (state) =>
    state.lastResult === null
      ? state
      : {
          ...state,
          lastResult: {
            ...state.lastResult,
            acknowledged: false,
            message: `${state.lastResult.message ?? "The update failed."} ${args.message}`,
            outcome: "rollback-failed",
            phase: "rollback",
          },
        },
  );
}
