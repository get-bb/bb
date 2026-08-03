import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 100;

/**
 * Stopping a PID recorded in a file is only safe when the PID still belongs to
 * the process that wrote it. The operating system reuses PIDs, so a stale file
 * can name an unrelated process. Every caller therefore verifies the command
 * line before it sends a signal.
 */
export interface VerifiedProcessOps {
  isRunning(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  readCommand(pid: number): Promise<string | null>;
  waitForExit(args: WaitForProcessExitArgs): Promise<boolean>;
}

export interface WaitForProcessExitArgs {
  pid: number;
  timeoutMs: number;
}

export interface StopVerifiedProcessArgs {
  pid: number;
  processOps?: VerifiedProcessOps;
  signal: NodeJS.Signals;
  timeoutMs: number;
  /**
   * The `ps` command line must contain at least one of these substrings for the
   * PID to be trusted. Callers pass more than one when the same process can
   * appear under different spellings: Node resolves `argv[1]` to an absolute
   * path, but `ps` shows the command line as it was typed, so a relative
   * invocation never contains the absolute path.
   */
  verifyTokens: string[];
}

export type StopVerifiedProcessResult =
  | { kind: "not-running" }
  | { command: string | null; kind: "unverified" }
  | { kind: "stopped"; usedKill: boolean };

interface SleepArgs {
  delayMs: number;
}

async function sleep(args: SleepArgs): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, args.delayMs);
  });
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

export function createNodeVerifiedProcessOps(): VerifiedProcessOps {
  return {
    isRunning: (pid) => isProcessRunning(pid),
    kill(pid, signal) {
      process.kill(pid, signal);
    },
    readCommand: (pid) => readProcessCommand(pid),
    waitForExit: (args) => waitForProcessExit(args),
  };
}

/**
 * Send `signal` to a PID, then escalate to SIGKILL when it does not exit in
 * time. Returns `unverified` without signalling anything when the command line
 * matches none of `verifyTokens`.
 */
export async function stopVerifiedProcess(
  args: StopVerifiedProcessArgs,
): Promise<StopVerifiedProcessResult> {
  const processOps = args.processOps ?? createNodeVerifiedProcessOps();

  if (!processOps.isRunning(args.pid)) {
    return { kind: "not-running" };
  }

  const command = await processOps.readCommand(args.pid);
  const verified =
    command !== null &&
    args.verifyTokens.some(
      (token) => token.length > 0 && command.includes(token),
    );
  if (!verified) {
    return { command, kind: "unverified" };
  }

  processOps.kill(args.pid, args.signal);
  const exited = await processOps.waitForExit({
    pid: args.pid,
    timeoutMs: args.timeoutMs,
  });
  if (exited || !processOps.isRunning(args.pid)) {
    return { kind: "stopped", usedKill: false };
  }

  processOps.kill(args.pid, "SIGKILL");
  await processOps.waitForExit({
    pid: args.pid,
    timeoutMs: args.timeoutMs,
  });
  return { kind: "stopped", usedKill: true };
}
