import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import {
  APP_UPDATE_MODE_ENV_NAME,
  APP_UPDATE_PASSIVE_MODE,
  APP_UPDATE_SHIM_PROTOCOL_ENV_NAME,
  APP_UPDATE_SHIM_PROTOCOL_VERSION,
  formatAppUpdateShimLockPath,
  type AppRevision,
  type AppUpdateMode,
  type InstalledNpmAppRevision,
  type NpmAppRevision,
} from "@bb/config/app-update";
import {
  waitForProcessExit,
  type ChildProcessExitResult,
} from "@bb/config/child-process-exit";
import { isProcessRunning } from "@bb/config/verified-process-stop";

const SHUTDOWN_KILL_AFTER_MS = 12 * 1000;

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
