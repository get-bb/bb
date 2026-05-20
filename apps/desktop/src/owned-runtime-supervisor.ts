import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const OWNED_RUNTIME_PID_FILE_NAME = "owned-runtime.json";
const POLL_INTERVAL_MS = 100;

const execFileAsync = promisify(execFile);

const ownedRuntimePidFileSchema = z.object({
  bridgePath: z.string().min(1),
  pid: z.number().int().positive(),
  serverUrl: z.string().min(1),
  startedAt: z.string().min(1),
});

export type ReapStaleOwnedRuntimeResult =
  | ClearedStaleOwnedRuntimePidFileResult
  | NoStaleOwnedRuntimePidFileResult
  | ReapedStaleOwnedRuntimeResult
  | SkippedStaleOwnedRuntimeResult;

export interface OwnedRuntimePidFile {
  bridgePath: string;
  pid: number;
  serverUrl: string;
  startedAt: string;
}

export interface WriteOwnedRuntimePidFileArgs {
  bridgePath: string;
  pid: number;
  serverUrl: string;
  userDataPath: string;
}

export interface ClearOwnedRuntimePidFileArgs {
  userDataPath: string;
}

export interface ReadOwnedRuntimePidFileArgs {
  userDataPath: string;
}

export interface ReapStaleOwnedRuntimeArgs {
  processOps?: OwnedRuntimeProcessOps;
  signal: NodeJS.Signals;
  timeoutMs: number;
  userDataPath: string;
}

export interface OwnedRuntimeProcessOps {
  isRunning(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  readCommand(pid: number): Promise<string | null>;
  waitForExit(args: WaitForProcessExitArgs): Promise<boolean>;
}

export interface WaitForProcessExitArgs {
  pid: number;
  timeoutMs: number;
}

export interface NoStaleOwnedRuntimePidFileResult {
  kind: "no-pid-file";
}

export interface ClearedStaleOwnedRuntimePidFileResult {
  kind: "cleared-stale-pid-file";
  pid: number;
}

export interface ReapedStaleOwnedRuntimeResult {
  kind: "reaped";
  pid: number;
}

export interface SkippedStaleOwnedRuntimeResult {
  command: string | null;
  kind: "skipped-unverified-process";
  pid: number;
}

interface SleepArgs {
  delayMs: number;
}

function ownedRuntimePidFilePath(userDataPath: string): string {
  return join(userDataPath, OWNED_RUNTIME_PID_FILE_NAME);
}

async function sleep(args: SleepArgs): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, args.delayMs);
  });
}

async function readProcessCommand(pid: number): Promise<string | null> {
  try {
    const result = await execFileAsync("ps", [
      "-p",
      String(pid),
      "-o",
      "command=",
    ]);
    return result.stdout.trim();
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(
  args: WaitForProcessExitArgs,
): Promise<boolean> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() <= deadline) {
    if (!isProcessRunning(args.pid)) {
      return true;
    }
    await sleep({ delayMs: POLL_INTERVAL_MS });
  }
  return !isProcessRunning(args.pid);
}

export function createNodeOwnedRuntimeProcessOps(): OwnedRuntimeProcessOps {
  return {
    isRunning: (pid) => isProcessRunning(pid),
    kill(pid, signal) {
      process.kill(pid, signal);
    },
    readCommand: (pid) => readProcessCommand(pid),
    waitForExit: (args) => waitForProcessExit(args),
  };
}

export async function writeOwnedRuntimePidFile(
  args: WriteOwnedRuntimePidFileArgs,
): Promise<void> {
  const pidFile: OwnedRuntimePidFile = {
    bridgePath: args.bridgePath,
    pid: args.pid,
    serverUrl: args.serverUrl,
    startedAt: new Date().toISOString(),
  };
  await mkdir(args.userDataPath, { recursive: true });
  await writeFile(
    ownedRuntimePidFilePath(args.userDataPath),
    `${JSON.stringify(pidFile, null, 2)}\n`,
    "utf8",
  );
}

export async function clearOwnedRuntimePidFile(
  args: ClearOwnedRuntimePidFileArgs,
): Promise<void> {
  await rm(ownedRuntimePidFilePath(args.userDataPath), { force: true });
}

export async function readOwnedRuntimePidFile(
  args: ReadOwnedRuntimePidFileArgs,
): Promise<OwnedRuntimePidFile | null> {
  try {
    const rawPidFile = await readFile(
      ownedRuntimePidFilePath(args.userDataPath),
      "utf8",
    );
    const parsed = ownedRuntimePidFileSchema.safeParse(JSON.parse(rawPidFile));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function reapStaleOwnedRuntime(
  args: ReapStaleOwnedRuntimeArgs,
): Promise<ReapStaleOwnedRuntimeResult> {
  const processOps = args.processOps ?? createNodeOwnedRuntimeProcessOps();
  const pidFile = await readOwnedRuntimePidFile({
    userDataPath: args.userDataPath,
  });

  if (pidFile === null) {
    return { kind: "no-pid-file" };
  }

  if (!processOps.isRunning(pidFile.pid)) {
    await clearOwnedRuntimePidFile({ userDataPath: args.userDataPath });
    return {
      kind: "cleared-stale-pid-file",
      pid: pidFile.pid,
    };
  }

  const command = await processOps.readCommand(pidFile.pid);
  if (command === null || !command.includes(pidFile.bridgePath)) {
    return {
      command,
      kind: "skipped-unverified-process",
      pid: pidFile.pid,
    };
  }

  processOps.kill(pidFile.pid, args.signal);
  const exited = await processOps.waitForExit({
    pid: pidFile.pid,
    timeoutMs: args.timeoutMs,
  });
  if (!exited && processOps.isRunning(pidFile.pid)) {
    processOps.kill(pidFile.pid, "SIGKILL");
    await processOps.waitForExit({
      pid: pidFile.pid,
      timeoutMs: args.timeoutMs,
    });
  }

  await clearOwnedRuntimePidFile({ userDataPath: args.userDataPath });
  return {
    kind: "reaped",
    pid: pidFile.pid,
  };
}
