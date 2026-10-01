import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 100;

const PROCESS_START_TOLERANCE_MS = 60_000;

export interface VerifiedProcessOps {
  isRunning(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  readCommand(pid: number): Promise<string | null>;
  readElapsedSeconds(pid: number): Promise<number | null>;
  waitForExit(args: WaitForProcessExitArgs): Promise<boolean>;
}

export interface WaitForProcessExitArgs {
  pid: number;
  timeoutMs: number;
}

interface StopVerifiedProcessArgs {
  killTimeoutMs: number;
  pid: number;
  processOps?: VerifiedProcessOps;
  signal: NodeJS.Signals;
  startedAt: string;
  timeoutMs: number;
  verifyTokens: string[];
}

type StopVerifiedProcessResult =
  | { command: string | null; kind: "unverified"; reason: UnverifiedReason }
  | { kind: "not-running" }
  | { kind: "still-running" }
  | { kind: "stopped"; usedKill: boolean };

type UnverifiedReason = "command" | "start-time";

interface SleepArgs {
  delayMs: number;
}

async function sleep(args: SleepArgs): Promise<void> {
  await new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, args.delayMs);
  });
}

export function isProcessRunning(pid: number): boolean {
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

const windowsProcessSchema = z.object({
  command: z.string().nullable(),
  startedAt: z.number().finite(),
});

async function readWindowsProcess(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const { stdout } = await execFileAsync(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        [
          "$ErrorActionPreference = 'Stop'",
          "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
          `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | ForEach-Object { @{ command = $_.CommandLine; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } | ConvertTo-Json -Compress }`,
        ].join("; "),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const value: unknown = JSON.parse(stdout);
    const result = windowsProcessSchema.safeParse(value);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

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

export function createNodeVerifiedProcessOps(): VerifiedProcessOps {
  return {
    isRunning: (pid) => isProcessRunning(pid),
    kill(pid, signal) {
      process.kill(pid, signal);
    },
    async readCommand(pid) {
      return process.platform === "win32"
        ? ((await readWindowsProcess(pid))?.command ?? null)
        : readPsField(pid, "command=");
    },
    async readElapsedSeconds(pid) {
      if (process.platform === "win32") {
        const info = await readWindowsProcess(pid);
        return info === null ? null : (Date.now() - info.startedAt) / 1_000;
      }
      const rawElapsed = await readPsField(pid, "etime=");
      return rawElapsed === null ? null : parseElapsedSeconds(rawElapsed);
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
  const command = await args.processOps.readCommand(args.pid);
  const commandMatches =
    command !== null &&
    args.verifyTokens.some(
      (token) => token.length > 0 && command.includes(token),
    );
  if (!commandMatches) {
    return { command, reason: "command" };
  }

  const recordedStart = Date.parse(args.startedAt);
  const elapsedSeconds = await args.processOps.readElapsedSeconds(args.pid);
  if (Number.isNaN(recordedStart) || elapsedSeconds === null) {
    return { command, reason: "start-time" };
  }
  const actualStart = Date.now() - elapsedSeconds * 1_000;
  if (Math.abs(actualStart - recordedStart) > PROCESS_START_TOLERANCE_MS) {
    return { command, reason: "start-time" };
  }
  return null;
}

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
    return { kind: "stopped", usedKill: false };
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
