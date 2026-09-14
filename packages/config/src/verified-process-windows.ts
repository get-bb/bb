// bb-fork(windows): POSIX `ps` cannot read native Windows process details, so the
// bb-fork(windows): verified stop path reads the command line and start time from WMI.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type {
  VerifiedProcessOps,
  WaitForProcessExitArgs,
} from "./verified-process-stop.js";

const execFileAsync = promisify(execFile);
const POLL_INTERVAL_MS = 100;
const POWERSHELL_TIMEOUT_MS = 10_000;
const POWERSHELL_EXECUTABLES = ["powershell.exe", "pwsh.exe"] as const;

export interface WindowsProcessSnapshot {
  command: string | null;
  elapsedSeconds: number | null;
}

export interface WindowsVerifiedProcessOpsOverrides {
  readSnapshot?: (pid: number) => Promise<WindowsProcessSnapshot | null>;
  terminateTree?: (pid: number) => void;
}

function readSnapshotField(
  record: Record<string, unknown>,
  field: string,
): unknown {
  return Object.hasOwn(record, field) ? record[field] : undefined;
}

function toOptionalCommand(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toOptionalElapsedSeconds(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.round(value);
}

export function parseWindowsProcessSnapshot(
  raw: string,
): WindowsProcessSnapshot | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const record = Array.isArray(parsed) ? parsed[0] : parsed;
  if (record === null || typeof record !== "object") {
    return null;
  }

  const fields = record as Record<string, unknown>;
  return {
    command: toOptionalCommand(readSnapshotField(fields, "command")),
    elapsedSeconds: toOptionalElapsedSeconds(
      readSnapshotField(fields, "elapsedSeconds"),
    ),
  };
}

function createSnapshotQuery(pid: number): string {
  return [
    `$process = Get-CimInstance Win32_Process -Filter ('ProcessId=' + ${String(pid)});`,
    "if ($process) {",
    "[pscustomobject]@{",
    "command = $process.CommandLine;",
    "elapsedSeconds = [int][math]::Round(((Get-Date) - $process.CreationDate).TotalSeconds)",
    "} | ConvertTo-Json -Compress",
    "}",
  ].join(" ");
}

export async function readWindowsProcessSnapshot(
  pid: number,
): Promise<WindowsProcessSnapshot | null> {
  const query = createSnapshotQuery(pid);
  for (const executable of POWERSHELL_EXECUTABLES) {
    try {
      const result = await execFileAsync(
        executable,
        ["-NoProfile", "-NonInteractive", "-Command", query],
        { timeout: POWERSHELL_TIMEOUT_MS, windowsHide: true },
      );
      return parseWindowsProcessSnapshot(result.stdout);
    } catch {}
  }
  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function terminateWindowsProcessTree(pid: number): void {
  try {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", () => undefined);
    killer.unref();
  } catch {}
}

async function waitForWindowsProcessExit(
  args: WaitForProcessExitArgs,
): Promise<boolean> {
  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() <= deadline) {
    if (!isProcessAlive(args.pid)) {
      return true;
    }
    await new Promise<void>((resolveWait) => {
      setTimeout(resolveWait, POLL_INTERVAL_MS);
    });
  }
  return !isProcessAlive(args.pid);
}

export function createWindowsVerifiedProcessOps(
  overrides: WindowsVerifiedProcessOpsOverrides = {},
): VerifiedProcessOps {
  const readSnapshot = overrides.readSnapshot ?? readWindowsProcessSnapshot;
  const terminateTree = overrides.terminateTree ?? terminateWindowsProcessTree;
  const snapshots = new Map<number, WindowsProcessSnapshot | null>();

  const snapshotFor = async (
    pid: number,
  ): Promise<WindowsProcessSnapshot | null> => {
    if (snapshots.has(pid)) {
      return snapshots.get(pid) ?? null;
    }
    const snapshot = await readSnapshot(pid);
    if (snapshot !== null) {
      snapshots.set(pid, snapshot);
    }
    return snapshot;
  };

  return {
    isRunning: isProcessAlive,
    kill: (pid) => {
      terminateTree(pid);
    },
    readCommand: async (pid) => (await snapshotFor(pid))?.command ?? null,
    readElapsedSeconds: async (pid) =>
      (await snapshotFor(pid))?.elapsedSeconds ?? null,
    waitForExit: waitForWindowsProcessExit,
  };
}
