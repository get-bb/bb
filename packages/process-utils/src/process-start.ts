import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export interface ProcessTableEntry {
  pid: number;
  ppid: number;
  pgid: number;
  startId: string;
}

export type ProcessStartProbe =
  | { state: "running"; startId: string }
  | { state: "gone" }
  | { state: "unknown" };

export interface ProcessIdentity {
  command: string | null;
  startedAt: number | null;
}

export type ProcessIdentityProbe =
  | { state: "running"; identity: ProcessIdentity }
  | { state: "gone" }
  | { state: "unknown" };

interface CommandResult {
  stdout: string;
  exitCode: number | null;
  failed: boolean;
}

function runCommand(
  command: string,
  args: readonly string[],
  options: { env?: NodeJS.ProcessEnv; timeout: number },
): Promise<CommandResult> {
  const cwd =
    process.platform === "win32"
      ? (process.env.SystemRoot ?? "C:\\Windows")
      : "/";
  return new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        env: options.env,
        maxBuffer: 16 * 1024 * 1024,
        timeout: options.timeout,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error === null) {
          resolve({ stdout, exitCode: 0, failed: false });
          return;
        }
        resolve({
          stdout,
          exitCode: typeof error.code === "number" ? error.code : null,
          failed: true,
        });
      },
    );
    child.stdin?.end();
  });
}

let linuxBootId: Promise<string> | null = null;

function readLinuxBootId(): Promise<string> {
  linuxBootId ??= readFile("/proc/sys/kernel/random/boot_id", "utf8").then(
    (text) => text.trim(),
  );
  return linuxBootId;
}

function parseLinuxStat(
  pid: number,
  line: string,
  bootId: string,
): ProcessTableEntry | null {
  const fields = line.slice(line.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z" || fields[0] === "X") return null;
  const ppid = Number(fields[1]);
  const pgid = Number(fields[2]);
  const ticks = fields[19];
  if (
    !Number.isSafeInteger(ppid) ||
    !Number.isSafeInteger(pgid) ||
    ticks === undefined ||
    !/^\d+$/u.test(ticks)
  )
    return null;
  return { pid, ppid, pgid, startId: `${bootId}:${ticks}` };
}

async function readLinuxEntry(
  pid: number,
  bootId: string,
): Promise<ProcessTableEntry | null> {
  try {
    return parseLinuxStat(
      pid,
      await readFile(`/proc/${pid}/stat`, "utf8"),
      bootId,
    );
  } catch {
    return null;
  }
}

async function readLinuxProcessTable(): Promise<ProcessTableEntry[]> {
  const bootId = await readLinuxBootId();
  const entries = await Promise.all(
    (await readdir("/proc"))
      .filter((entry) => /^\d+$/u.test(entry))
      .map((entry) => readLinuxEntry(Number(entry), bootId)),
  );
  return entries.filter((entry) => entry !== null);
}

const PS_COLUMNS = [
  "-o",
  "pid=",
  "-o",
  "ppid=",
  "-o",
  "pgid=",
  "-o",
  "stat=",
  "-o",
  "lstart=",
];

function parsePsEntries(stdout: string): ProcessTableEntry[] {
  return stdout.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S.*?)\s*$/u.exec(line);
    if (match === null || match[4]?.startsWith("Z")) return [];
    return [
      {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        startId: (match[5] ?? "").replace(/\s+/gu, " "),
      },
    ];
  });
}

function runPs(selector: readonly string[]): Promise<CommandResult> {
  return runCommand("ps", [...selector, ...PS_COLUMNS], {
    env: { ...process.env, LC_ALL: "C", LANG: "C", TZ: "UTC0" },
    timeout: 5_000,
  });
}

export async function readProcessTable(): Promise<ProcessTableEntry[]> {
  if (process.platform === "linux") return readLinuxProcessTable();
  const result = await runPs(["-A"]);
  if (result.failed) throw new Error("ps could not list processes");
  return parsePsEntries(result.stdout);
}

export async function probeProcessStart(
  pid: number,
): Promise<ProcessStartProbe> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { state: "gone" };
  if (process.platform === "win32") {
    const probe = await probeWindowsProcessIdentity(pid);
    if (probe.state !== "running") return probe;
    return probe.identity.startedAt === null
      ? { state: "unknown" }
      : { state: "running", startId: String(probe.identity.startedAt) };
  }
  if (process.platform === "linux") {
    let bootId: string;
    try {
      bootId = await readLinuxBootId();
    } catch {
      return { state: "unknown" };
    }
    let line: string;
    try {
      line = await readFile(`/proc/${pid}/stat`, "utf8");
    } catch (error) {
      return error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
        ? { state: "gone" }
        : { state: "unknown" };
    }
    const entry = parseLinuxStat(pid, line, bootId);
    return entry === null
      ? { state: "gone" }
      : { state: "running", startId: entry.startId };
  }
  const result = await runPs(["-p", String(pid)]);
  const entry = parsePsEntries(result.stdout).find(
    (candidate) => candidate.pid === pid,
  );
  if (entry !== undefined) return { state: "running", startId: entry.startId };
  return result.failed &&
    !(result.exitCode === 1 && result.stdout.trim() === "")
    ? { state: "unknown" }
    : { state: "gone" };
}

export async function probeWindowsProcessIdentity(
  pid: number,
): Promise<ProcessIdentityProbe> {
  const result = await runCommand(
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
    { timeout: 30_000 },
  );
  if (result.failed) return { state: "unknown" };
  if (result.stdout.trim() === "") return { state: "gone" };
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    return { state: "unknown" };
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("command" in value) ||
    !("startedAt" in value) ||
    (typeof value.command !== "string" && value.command !== null) ||
    typeof value.startedAt !== "number" ||
    !Number.isFinite(value.startedAt)
  )
    return { state: "unknown" };
  return {
    state: "running",
    identity: { command: value.command, startedAt: value.startedAt },
  };
}
