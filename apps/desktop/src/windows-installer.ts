import { spawnHostProcess as spawn } from "@bb/process-utils";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createInterface } from "node:readline";

const ELECTRON_BUILDER_NSIS_GUID_NAMESPACE =
  "50e065bc-3134-11e6-9bab-38c9862bdaf3";
const COMMAND_EXIT_GRACE_MS = 30_000;

export type WindowsInstallerWaitResult =
  | "finished"
  | "not-running"
  | "timed-out"
  | "unknown";

interface WindowsInstallerWaitCommand {
  args: string[];
  executablePath: string;
}

interface CreateWindowsInstallerWaitCommandArgs {
  appId: string;
  systemRoot: string | undefined;
  timeoutMs: number;
}

interface WaitForWindowsInstallerArgs {
  command: WindowsInstallerWaitCommand;
  onWaiting(): void;
  timeoutMs: number;
}

export function createWindowsInstallerMutexName(appId: string): string {
  const hash = createHash("sha1")
    .update(
      Buffer.from(
        ELECTRON_BUILDER_NSIS_GUID_NAMESPACE.replaceAll("-", ""),
        "hex",
      ),
    )
    .update(appId, "utf8")
    .digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

export function createWindowsInstallerWaitCommand(
  args: CreateWindowsInstallerWaitCommandArgs,
): WindowsInstallerWaitCommand {
  const mutexName = createWindowsInstallerMutexName(args.appId);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$mutex = $null",
    `if (-not [System.Threading.Mutex]::TryOpenExisting('${mutexName}', [ref]$mutex)) { [Console]::Out.WriteLine('not-running'); exit 0 }`,
    "[Console]::Out.WriteLine('waiting'); [Console]::Out.Flush()",
    `try { $acquired = $mutex.WaitOne(${Math.ceil(args.timeoutMs)}) } catch [System.Threading.AbandonedMutexException] { $acquired = $true }`,
    "if ($acquired) { $mutex.ReleaseMutex(); [Console]::Out.WriteLine('finished') } else { [Console]::Out.WriteLine('timed-out') }",
    "$mutex.Dispose()",
  ].join("; ");
  return {
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    executablePath: join(
      args.systemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
  };
}

export async function waitForWindowsInstaller(
  args: WaitForWindowsInstallerArgs,
): Promise<WindowsInstallerWaitResult> {
  const child = spawn(args.command.executablePath, args.command.args, {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  let result: WindowsInstallerWaitResult = "unknown";
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (rawLine) => {
    const line = rawLine.trim();
    if (line === "waiting") {
      args.onWaiting();
    } else if (
      line === "finished" ||
      line === "not-running" ||
      line === "timed-out"
    ) {
      result = line;
    }
  });
  const killTimer = setTimeout(() => {
    child.kill();
  }, args.timeoutMs + COMMAND_EXIT_GRACE_MS);
  try {
    await new Promise<void>((resolvePromise) => {
      child.once("error", () => resolvePromise());
      child.once("close", () => resolvePromise());
    });
  } finally {
    clearTimeout(killTimer);
    lines.close();
  }
  return result;
}
