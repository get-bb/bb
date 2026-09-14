import { execFile, spawn } from "node:child_process";
import { stat as fsStat } from "node:fs/promises";
import os from "node:os";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { pcControlHostContract } from "./host-contract.js";
import {
  CpuPercentSampler,
  collectSystemSnapshot,
  type MetricsDeps,
} from "./pc/metrics.js";
import type { SystemSnapshot } from "./pc/schemas.js";
import {
  ProcessCpuTracker,
  collectProcessList,
  parsePosixPs,
  parseWindowsCsv,
  windowsListArgs,
  type CommandRunner,
  type RawProcessEntry,
} from "./pc/process-listing.js";
import {
  entryMatchesIdentity,
  startManagedApp,
  stopManagedProcesses,
  type AppsDeps,
} from "./pc/apps.js";

const POWERSHELL_CANDIDATES = ["powershell.exe", "pwsh.exe"];
const POWERSHELL_PROBE_TIMEOUT_MS = 8_000;
const LIST_TIMEOUT_MS = 15_000;

const nodeRunner: CommandRunner = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: options?.timeoutMs ?? LIST_TIMEOUT_MS,
        maxBuffer: options?.maxOutputBytes ?? 4 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
        killSignal: "SIGKILL",
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ stdout, stderr, exitCode: 0 });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (typeof code === "number") {
          resolve({ stdout, stderr, exitCode: code });
          return;
        }
        reject(new Error(`${file} failed to run: ${error.message}`));
      },
    );
  });

let resolvedPowershell: string | null = null;

async function defaultResolvePowershell(): Promise<string> {
  if (resolvedPowershell !== null) return resolvedPowershell;
  for (const candidate of POWERSHELL_CANDIDATES) {
    try {
      const result = await nodeRunner(
        candidate,
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$PSVersionTable.PSVersion.Major",
        ],
        { timeoutMs: POWERSHELL_PROBE_TIMEOUT_MS },
      );
      if (result.exitCode === 0 && /^\d+/u.test(result.stdout.trim())) {
        resolvedPowershell = candidate;
        return candidate;
      }
    } catch {}
  }
  throw new Error(
    "PowerShell was not found on this host; process listing is unavailable.",
  );
}

function osCpuTimes(): Array<{ idle: number; total: number }> {
  return os.cpus().map((cpu) => {
    const { idle, irq, nice, sys, user } = cpu.times;
    return { idle, total: idle + irq + nice + sys + user };
  });
}

const nodeMetricsDeps: MetricsDeps = {
  os: {
    cpus: osCpuTimes,
    totalmem: () => os.totalmem(),
    freemem: () => os.freemem(),
    uptime: () => os.uptime(),
  },
  now: () => Date.now(),
  delay: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

async function rawEntriesFor(
  platform: NodeJS.Platform,
  run: CommandRunner,
  resolvePowershell: () => Promise<string>,
): Promise<readonly RawProcessEntry[]> {
  if (platform === "win32") {
    const result = await run(
      await resolvePowershell(),
      windowsListArgs(),
      { timeoutMs: LIST_TIMEOUT_MS },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Process listing failed: ${result.stderr.trim().slice(0, 300)}`,
      );
    }
    return parseWindowsCsv(result.stdout);
  }
  const result = await run(
    "ps",
    ["-axo", "pid=,pcpu=,rss=,comm="],
    { timeoutMs: LIST_TIMEOUT_MS },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Process listing failed: ${result.stderr.trim().slice(0, 300)}`,
    );
  }
  return parsePosixPs(result.stdout);
}

export interface PcControlHostDeps {
  readonly metrics?: MetricsDeps;
  readonly run?: CommandRunner;
  readonly platform?: NodeJS.Platform;
  readonly spawnFn?: AppsDeps["spawn"];
  readonly stat?: AppsDeps["stat"];
  readonly powershellPath?: () => Promise<string>;
}

export function createPcControlHostEntry(deps: PcControlHostDeps = {}) {
  const metrics = deps.metrics ?? nodeMetricsDeps;
  const platform = deps.platform ?? process.platform;
  const run = deps.run ?? nodeRunner;
  const resolvePowershell = deps.powershellPath ?? defaultResolvePowershell;
  const listRaw = () => rawEntriesFor(platform, run, resolvePowershell);
  const cpuSampler = new CpuPercentSampler(metrics);
  const cpuTracker = new ProcessCpuTracker(metrics.now);
  const apps: AppsDeps = {
    run,
    spawn:
      deps.spawnFn ??
      ((file, args, options) => spawn(file, args, options)),
    stat:
      deps.stat ??
      (async (target) => {
        try {
          const stats = await fsStat(target);
          return {
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
          };
        } catch {
          return null;
        }
      }),
    platform,
    listRaw,
    delay: metrics.delay,
    now: metrics.now,
  };
  return experimental_defineHostEntry({
    contract: pcControlHostContract,
    handlers: {
      async systemSnapshot() {
        return roundSnapshot(
          await collectSystemSnapshot(metrics, cpuSampler),
        );
      },
      async listProcesses() {
        const result = await collectProcessList(
          {
            run,
            platform,
            now: metrics.now,
            tracker: cpuTracker,
          },
          await resolvePowershellFor(platform, resolvePowershell),
        );
        return {
          collectedAt: result.collectedAt,
          truncated: result.truncated,
          processes: result.processes.map((sample) => ({
            ...sample,
            cpuPercent:
              sample.cpuPercent === null ? null : round1(sample.cpuPercent),
          })),
        };
      },
      async resolveProcessMatches({ matchers }) {
        const entries = await listRaw();
        return {
          matches: matchers.map((matcher) => ({
            key: matcher.key,
            pids: entries
              .filter((entry) =>
                entryMatchesIdentity(entry, matcher.processName, matcher.exePath),
              )
              .slice(0, 32)
              .map((entry) => entry.pid),
          })),
        };
      },
      async startApp(input) {
        return await startManagedApp(apps, input);
      },
      async stopProcesses(input) {
        return await stopManagedProcesses(apps, input);
      },
    },
  });
}

async function resolvePowershellFor(
  platform: NodeJS.Platform,
  resolvePowershell: () => Promise<string>,
): Promise<string> {
  if (platform !== "win32") return "ps";
  return await resolvePowershell();
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundSnapshot(snapshot: SystemSnapshot): SystemSnapshot {
  return {
    ...snapshot,
    cpuPercent:
      snapshot.cpuPercent === null ? null : round1(snapshot.cpuPercent),
    memoryUsedPercent: round1(snapshot.memoryUsedPercent),
  };
}

export default createPcControlHostEntry({});
