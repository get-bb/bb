import type { ProcessListOutput, ProcessSample } from "./schemas.js";

export type CommandRunner = (
  file: string,
  args: readonly string[],
  options?: { timeoutMs?: number; maxOutputBytes?: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface RawProcessEntry {
  pid: number;
  name: string;
  cpuSeconds: number | null;
  memoryBytes: number | null;
  exePath: string | null;
}

export interface PsEntry {
  pid: number;
  name: string;
  cpuPercent: number | null;
  memoryBytes: number;
}

const LIST_TIMEOUT_MS = 15_000;
const LIST_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_PROCESS_SAMPLES = 500;

const WINDOWS_LIST_SCRIPT =
  "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
  "$ProgressPreference='SilentlyContinue'; " +
  "Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64,Path | " +
  "ConvertTo-Csv -NoTypeInformation";

export function windowsListArgs(): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    WINDOWS_LIST_SCRIPT,
  ];
}

export const POSIX_LIST_ARGS = [
  "-axo",
  "pid=,pcpu=,rss=,comm=",
] as const;

export function parseCsvLine(line: string): string[] | null {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAny = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      sawAny = true;
      continue;
    }
    if (char === ",") {
      fields.push(field);
      field = "";
      sawAny = true;
      continue;
    }
    field += char;
  }
  if (inQuotes) return null;
  if (!sawAny && field.length === 0) return null;
  fields.push(field);
  return fields;
}

function parseNumeric(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const normalized = trimmed.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  if (/[\0\r\n]/u.test(trimmed)) return null;
  return trimmed;
}

export function parseWindowsCsv(stdout: string): RawProcessEntry[] {
  const entries: RawProcessEntry[] = [];
  const lines = stdout.split(/\r?\n/u);
  let headerIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const fields = parseCsvLine(lines[index] ?? "");
    if (fields === null) continue;
    const joined = fields.join(",").toLowerCase();
    if (joined === "id,processname,cpu,workingset64,path") {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex === -1) return entries;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const fields = parseCsvLine(lines[index] ?? "");
    if (fields === null || fields.length < 5) continue;
    const pid = parseNumeric(fields[0] ?? "");
    const name = sanitizeName(fields[1] ?? "");
    if (pid === null || !Number.isInteger(pid) || pid <= 0) continue;
    if (name === null) continue;
    const cpuSeconds = parseNumeric(fields[2] ?? "");
    const memoryBytes = parseNumeric(fields[3] ?? "");
    const exePathRaw = (fields[4] ?? "").trim();
    entries.push({
      pid,
      name,
      cpuSeconds: cpuSeconds !== null && cpuSeconds >= 0 ? cpuSeconds : null,
      memoryBytes:
        memoryBytes !== null && memoryBytes >= 0
          ? Math.round(memoryBytes)
          : null,
      exePath: exePathRaw.length > 0 ? exePathRaw : null,
    });
  }
  return entries;
}

export function parsePosixPs(stdout: string): RawProcessEntry[] {
  const entries: RawProcessEntry[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = /^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/u.exec(trimmed);
    if (match === null) continue;
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const name = sanitizeName(match[4] ?? "");
    if (name === null) continue;
    const pcpu = Number(match[2]);
    entries.push({
      pid,
      name,
      cpuSeconds: Number.isFinite(pcpu) ? pcpu : null,
      memoryBytes: Math.round(Number(match[3]) * 1024),
      exePath: null,
    });
  }
  return entries;
}

const PROCESS_MIN_INTERVAL_MS = 250;

export class ProcessCpuTracker {
  private previous: { at: number; cpuSeconds: Map<number, number> } | null =
    null;
  private lastPercents = new Map<number, number>();

  constructor(private readonly now: () => number) {}

  toSamples(
    entries: readonly RawProcessEntry[],
    posixCpuPercent: boolean,
  ): ProcessSample[] {
    const at = this.now();
    if (posixCpuPercent) {
      return entries.map((entry) => ({
        pid: entry.pid,
        name: entry.name,
        cpuPercent:
          entry.cpuSeconds !== null
            ? Math.min(100, Math.max(0, entry.cpuSeconds))
            : null,
        memoryBytes: entry.memoryBytes ?? 0,
      }));
    }
    const previous = this.previous;
    if (previous !== null && at - previous.at < PROCESS_MIN_INTERVAL_MS) {
      return entries.map((entry) => ({
        pid: entry.pid,
        name: entry.name,
        cpuPercent: this.lastPercents.get(entry.pid) ?? null,
        memoryBytes: entry.memoryBytes ?? 0,
      }));
    }
    const nextCpu = new Map<number, number>();
    const samples: ProcessSample[] = [];
    for (const entry of entries) {
      let cpuPercent: number | null = null;
      if (entry.cpuSeconds !== null) {
        const prior = previous?.cpuSeconds.get(entry.pid);
        if (previous !== null && prior !== undefined) {
          const elapsedSeconds = (at - previous.at) / 1000;
          const cpuDelta = entry.cpuSeconds - prior;
          if (elapsedSeconds > 0 && cpuDelta >= 0) {
            cpuPercent = Math.min(
              100,
              Math.max(0, (cpuDelta / elapsedSeconds) * 100),
            );
          }
        }
        nextCpu.set(entry.pid, entry.cpuSeconds);
      }
      if (cpuPercent !== null) {
        this.lastPercents.set(entry.pid, cpuPercent);
      }
      samples.push({
        pid: entry.pid,
        name: entry.name,
        cpuPercent: cpuPercent ?? this.lastPercents.get(entry.pid) ?? null,
        memoryBytes: entry.memoryBytes ?? 0,
      });
    }
    this.previous = nextCpu.size > 0 ? { at, cpuSeconds: nextCpu } : null;
    return samples;
  }

  reset(): void {
    this.previous = null;
    this.lastPercents = new Map();
  }
}

export function rankProcesses(
  samples: readonly ProcessSample[],
): { processes: ProcessSample[]; truncated: boolean } {
  const sorted = [...samples].sort((a, b) => {
    const aCpu = a.cpuPercent ?? -1;
    const bCpu = b.cpuPercent ?? -1;
    if (aCpu !== bCpu) return bCpu - aCpu;
    return b.memoryBytes - a.memoryBytes;
  });
  return {
    processes: sorted.slice(0, MAX_PROCESS_SAMPLES),
    truncated: sorted.length > MAX_PROCESS_SAMPLES,
  };
}

export async function collectProcessList(
  deps: {
    run: CommandRunner;
    platform: NodeJS.Platform;
    now: () => number;
    tracker: ProcessCpuTracker;
  },
  powershellPath: string,
): Promise<ProcessListOutput> {
  const posix = deps.platform !== "win32";
  const result = posix
    ? await deps.run("ps", POSIX_LIST_ARGS, {
        timeoutMs: LIST_TIMEOUT_MS,
        maxOutputBytes: LIST_MAX_OUTPUT_BYTES,
      })
    : await deps.run(powershellPath, windowsListArgs(), {
        timeoutMs: LIST_TIMEOUT_MS,
        maxOutputBytes: LIST_MAX_OUTPUT_BYTES,
      });
  if (result.exitCode !== 0) {
    throw new Error(
      `Process listing failed: ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  const entries = posix
    ? parsePosixPs(result.stdout)
    : parseWindowsCsv(result.stdout);
  const samples = deps.tracker.toSamples(entries, posix);
  const ranked = rankProcesses(samples);
  return {
    collectedAt: new Date(deps.now()).toISOString(),
    processes: ranked.processes,
    truncated: ranked.truncated,
  };
}
