import { readProcessIdentity, type ProcessIdentity } from "@bb/process-utils";

const POLL_INTERVAL_MS = 100;

const PROCESS_START_TOLERANCE_MS = 60_000;

export interface VerifiedProcessOps {
  isRunning(pid: number): boolean;
  kill(pid: number, signal: NodeJS.Signals): void;
  readIdentity(pid: number): Promise<ProcessIdentity | null>;
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
    readIdentity: readProcessIdentity,
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
  const command = identity?.command ?? null;
  const commandMatches =
    command !== null &&
    args.verifyTokens.some(
      (token) => token.length > 0 && command.includes(token),
    );
  if (!commandMatches) {
    return { command, reason: "command" };
  }

  const recordedStart = Date.parse(args.startedAt);
  const actualStart = identity?.startedAt ?? null;
  if (Number.isNaN(recordedStart) || actualStart === null) {
    return { command, reason: "start-time" };
  }
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
