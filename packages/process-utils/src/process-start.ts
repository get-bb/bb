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
  if (process.platform === "win32") return probeWindowsStartBatched(pid);
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

const WINDOWS_PROBE_BATCH_MS = 50;

let windowsBatch: Map<number, ((probe: ProcessStartProbe) => void)[]> | null =
  null;

function probeWindowsStartBatched(pid: number): Promise<ProcessStartProbe> {
  return new Promise((resolve) => {
    if (windowsBatch === null) {
      const batch = new Map<number, ((probe: ProcessStartProbe) => void)[]>();
      windowsBatch = batch;
      setTimeout(() => {
        windowsBatch = null;
        void probeWindowsStarts([...batch.keys()]).then((probes) => {
          for (const [batchPid, waiters] of batch) {
            const probe = probes.get(batchPid) ?? { state: "unknown" };
            for (const waiter of waiters) waiter(probe);
          }
        });
      }, WINDOWS_PROBE_BATCH_MS).unref();
    }
    const waiters = windowsBatch.get(pid);
    if (waiters === undefined) windowsBatch.set(pid, [resolve]);
    else waiters.push(resolve);
  });
}

async function probeWindowsStarts(
  pids: readonly number[],
): Promise<Map<number, ProcessStartProbe>> {
  const unknown = new Map<number, ProcessStartProbe>(
    pids.map((pid) => [pid, { state: "unknown" }]),
  );
  const filter = pids.map((pid) => `ProcessId = ${pid}`).join(" OR ");
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
        `$items = @(Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { @{ pid = $_.ProcessId; startedAt = ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } })`,
        "ConvertTo-Json -InputObject $items -Compress",
      ].join("; "),
    ],
    { timeout: 30_000 },
  );
  if (result.failed) return unknown;
  let value: unknown;
  try {
    value = result.stdout.trim() === "" ? [] : JSON.parse(result.stdout);
  } catch {
    return unknown;
  }
  if (!Array.isArray(value)) return unknown;
  const probes = new Map<number, ProcessStartProbe>(
    pids.map((pid) => [pid, { state: "gone" }]),
  );
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return unknown;
    const pid: unknown = Reflect.get(entry, "pid");
    const startedAt: unknown = Reflect.get(entry, "startedAt");
    if (typeof pid !== "number" || typeof startedAt !== "number")
      return unknown;
    probes.set(pid, { state: "running", startId: String(startedAt) });
  }
  return probes;
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
