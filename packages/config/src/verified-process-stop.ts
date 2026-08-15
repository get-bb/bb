import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 100;

/**
 * How far the recorded start time may sit from the real process start time.
 * A launcher records the time a moment after the process starts, and `ps`
 * reports whole seconds, so the two never match exactly. The window stays small
 * enough that a recycled PID from an earlier session cannot pass.
 */
export const PROCESS_START_TOLERANCE_MS = 60_000;

/**
 * Stopping a PID recorded in a file is only safe when the PID still belongs to
 * the process that wrote it. The operating system reuses PIDs, so a stale file
 * can name an unrelated process. Every caller therefore checks both the command
 * line and the process start time before it sends a signal.
 */
export interface ProcessIdentity {
  command: string | null;
  elapsedSeconds: number | null;
}

export interface VerifiedProcessOps {
  isRunning(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  /** When true, kill is already a tree force-kill and must not be called twice. */
  forceKillOnly?: boolean;
  readIdentity(pid: number): Promise<ProcessIdentity>;
  waitForExit(args: WaitForProcessExitArgs): Promise<boolean>;
}

export interface WaitForProcessExitArgs {
  pid: number;
  timeoutMs: number;
}

export interface StopVerifiedProcessArgs {
  /** How long to wait after SIGKILL. SIGKILL is not catchable, so keep it short. */
  killTimeoutMs: number;
  pid: number;
  processOps?: VerifiedProcessOps;
  signal: NodeJS.Signals;
  /** ISO time the record was written, checked against the real start time. */
  startedAt: string;
  timeoutMs: number;
  /**
   * The `ps` command line must contain at least one of these substrings. Node
   * resolves `argv[1]` to an absolute path, but `ps` shows the command line as
   * it was typed, so a relative invocation never contains the absolute path.
   * This is a weak signal on its own; the start-time check carries the identity.
   */
  verifyTokens: string[];
}

export type StopVerifiedProcessResult =
  | { command: string | null; kind: "unverified"; reason: UnverifiedReason }
  | { kind: "not-running" }
  | { kind: "still-running" }
  | { kind: "stopped"; usedKill: boolean };

export type UnverifiedReason = "command" | "start-time";

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

async function readPsField(pid: number, field: string): Promise<string | null> {
  try {
    const result = await execFileAsync("ps", ["-p", String(pid), "-o", field]);
    return result.stdout.trim();
  } catch {
    return null;
  }
}

interface WindowsProcessIdentity {
  command: string | null;
  elapsedSeconds: number | null;
}

export async function readWindowsProcessIdentity(
  pid: number,
): Promise<WindowsProcessIdentity> {
  try {
    const result = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$p = Get-Process -Id ${pid} -ErrorAction Stop; $c = (Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine; @{ command = $c; start = $p.StartTime.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress`,
      ],
      { timeout: 8_000, windowsHide: true },
    );
    const parsed = JSON.parse(result.stdout) as {
      command?: unknown;
      start?: unknown;
    };
    const command =
      typeof parsed.command === "string" && parsed.command.length > 0
        ? parsed.command
        : null;
    const startedAt =
      typeof parsed.start === "string" ? Date.parse(parsed.start) : Number.NaN;
    return {
      command,
      elapsedSeconds: Number.isNaN(startedAt)
        ? null
        : Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    };
  } catch {
    return { command: null, elapsedSeconds: null };
  }
}

/** Parse the `ps -o etime=` format `[[dd-]hh:]mm:ss` into seconds. */
export function parseElapsedSeconds(rawElapsed: string): number | null {
  const match = rawElapsed
    .trim()
    .match(/^(?:(?:(\d+)-)?(\d+):)?(\d{1,2}):(\d{2})$/u);
  if (match === null) {
    return null;
  }
  const days = Number(match[1] ?? "0");
  const hours = Number(match[2] ?? "0");
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
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

export function killWindowsProcessTree(pid: number): ChildProcess {
  const killer = spawn("taskkill", ["/T", "/F", "/PID", String(pid)], {
    stdio: "ignore",
    windowsHide: true,
  });
  killer.once("error", () => {
    // The wait loop in stopVerifiedProcess is the source of truth.
  });
  return killer;
}

export function createNodeVerifiedProcessOps(
  platform: NodeJS.Platform = process.platform,
): VerifiedProcessOps {
  if (platform === "win32") {
    return {
      forceKillOnly: true,
      isRunning: (pid) => isProcessRunning(pid),
      kill(pid) {
        killWindowsProcessTree(pid);
      },
      async readIdentity(pid) {
        return readWindowsProcessIdentity(pid);
      },
      waitForExit: (args) => waitForProcessExit(args),
    };
  }

  return {
    isRunning: (pid) => isProcessRunning(pid),
    kill(pid, signal) {
      process.kill(pid, signal);
    },
    async readIdentity(pid) {
      const command = await readPsField(pid, "command=");
      const rawElapsed = await readPsField(pid, "etime=");
      return {
        command,
        elapsedSeconds:
          rawElapsed === null ? null : parseElapsedSeconds(rawElapsed),
      };
    },
    waitForExit: (args) => waitForProcessExit(args),
  };
}

interface VerifyProcessIdentityArgs {
  pid: number;
  processOps: VerifiedProcessOps;
  startedAt: string;
  verifyTokens: string[];
}

async function verifyProcessIdentity(
  args: VerifyProcessIdentityArgs,
): Promise<{ command: string | null; reason: UnverifiedReason } | null> {
  const identity = await args.processOps.readIdentity(args.pid);
  const command = identity.command;
  const commandMatches =
    command !== null &&
    args.verifyTokens.some(
      (token) => token.length > 0 && command.includes(token),
    );
  if (!commandMatches) {
    return { command, reason: "command" };
  }

  // The command line alone cannot tell two bb launchers apart, and a recycled
  // PID can carry a matching name. The start time is what proves identity.
  const recordedStart = Date.parse(args.startedAt);
  const elapsedSeconds = identity.elapsedSeconds;
  if (Number.isNaN(recordedStart) || elapsedSeconds === null) {
    return { command, reason: "start-time" };
  }
  const actualStart = Date.now() - elapsedSeconds * 1_000;
  if (Math.abs(actualStart - recordedStart) > PROCESS_START_TOLERANCE_MS) {
    return { command, reason: "start-time" };
  }
  return null;
}

/**
 * Send `signal` to a PID, then escalate to SIGKILL when it does not exit in
 * time. Signals nothing unless the process still matches the record, and
 * reports `still-running` when even SIGKILL does not end it, so callers never
 * treat a surviving process as stopped.
 */
export async function stopVerifiedProcess(
  args: StopVerifiedProcessArgs,
): Promise<StopVerifiedProcessResult> {
  const processOps = args.processOps ?? createNodeVerifiedProcessOps();

  if (!processOps.isRunning(args.pid)) {
    return { kind: "not-running" };
  }

  const mismatch = await verifyProcessIdentity({
    pid: args.pid,
    processOps,
    startedAt: args.startedAt,
    verifyTokens: args.verifyTokens,
  });
  if (mismatch !== null) {
    return {
      command: mismatch.command,
      kind: "unverified",
      reason: mismatch.reason,
    };
  }

  processOps.kill(args.pid, args.signal);
  const exited = await processOps.waitForExit({
    pid: args.pid,
    timeoutMs: args.timeoutMs,
  });
  if (exited || !processOps.isRunning(args.pid)) {
    return { kind: "stopped", usedKill: processOps.forceKillOnly === true };
  }

  if (processOps.forceKillOnly === true) {
    return processOps.isRunning(args.pid)
      ? { kind: "still-running" }
      : { kind: "stopped", usedKill: true };
  }

  processOps.kill(args.pid, "SIGKILL");
  const killed = await processOps.waitForExit({
    pid: args.pid,
    timeoutMs: args.killTimeoutMs,
  });
  if (!killed && processOps.isRunning(args.pid)) {
    return { kind: "still-running" };
  }
  return { kind: "stopped", usedKill: true };
}
