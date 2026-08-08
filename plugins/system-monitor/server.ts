import { readFile, statfs } from "node:fs/promises";
import {
  arch,
  cpus,
  freemem,
  homedir,
  hostname,
  loadavg,
  platform,
  release,
  totalmem,
  uptime,
} from "node:os";
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

const SAMPLE_DURATION_MS = 200;

const usageSchema = z.object({
  usedBytes: z.number().int().nonnegative(),
  availableBytes: z.number().int().nonnegative(),
  totalBytes: z.number().int().nonnegative(),
  usedPercent: z.number().min(0).max(100),
});

export const statsSchema = z.object({
  sampledAt: z.number().int().nonnegative(),
  hostname: z.string(),
  platform: z.string(),
  release: z.string(),
  architecture: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  cpu: z.object({
    usagePercent: z.number().min(0).max(100),
    logicalCores: z.number().int().positive(),
    model: z.string(),
    speedMHz: z.number().positive().nullable(),
  }),
  memory: usageSchema,
  disk: usageSchema.extend({ path: z.string() }),
  loadAverage: z.tuple([z.number(), z.number(), z.number()]),
});

export const rpcContract = defineRpcContract({
  stats: { input: z.null(), output: statsSchema },
});

type CpuTicks = { idle: number; total: number };
type SystemStats = z.infer<typeof statsSchema>;

function cpuTicks(): CpuTicks {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

function percent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cpuSpeedMHz(
  cpuList: ReturnType<typeof cpus>,
): Promise<number | null> {
  const reportedSpeeds = cpuList
    .map((cpu) => cpu.speed)
    .filter((speed) => speed > 0);
  if (reportedSpeeds.length > 0) {
    return (
      reportedSpeeds.reduce((sum, speed) => sum + speed, 0) /
      reportedSpeeds.length
    );
  }

  if (platform() !== "linux") return null;
  try {
    const cpuInfo = await readFile("/proc/cpuinfo", "utf8");
    const speeds = Array.from(
      cpuInfo.matchAll(/^cpu MHz\s*:\s*([\d.]+)$/gim),
      (match) => Number(match[1]),
    ).filter((speed) => Number.isFinite(speed) && speed > 0);
    if (speeds.length === 0) return null;
    return speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
  } catch {
    return null;
  }
}

async function collectStats(): Promise<SystemStats> {
  const before = cpuTicks();
  const diskPath = homedir();
  const diskPromise = statfs(diskPath, { bigint: true });
  await sleep(SAMPLE_DURATION_MS);
  const after = cpuTicks();
  const disk = await diskPromise;

  const cpuTotal = after.total - before.total;
  const cpuIdle = after.idle - before.idle;
  const cpuUsage = cpuTotal > 0 ? percent(cpuTotal - cpuIdle, cpuTotal) : 0;

  const memoryTotal = totalmem();
  const memoryAvailable = freemem();
  const memoryUsed = memoryTotal - memoryAvailable;

  const diskTotal = Number(disk.bsize * disk.blocks);
  const diskAvailable = Number(disk.bsize * disk.bavail);
  const diskUsed = diskTotal - diskAvailable;
  const cpuList = cpus();
  const speedMHz = await cpuSpeedMHz(cpuList);
  const [oneMinute = 0, fiveMinutes = 0, fifteenMinutes = 0] = loadavg();

  return {
    sampledAt: Date.now(),
    hostname: hostname(),
    platform: platform(),
    release: release(),
    architecture: arch(),
    uptimeSeconds: uptime(),
    cpu: {
      usagePercent: cpuUsage,
      logicalCores: Math.max(1, cpuList.length),
      model: cpuList[0]?.model.trim() || "Unknown CPU",
      speedMHz,
    },
    memory: {
      usedBytes: memoryUsed,
      availableBytes: memoryAvailable,
      totalBytes: memoryTotal,
      usedPercent: percent(memoryUsed, memoryTotal),
    },
    disk: {
      path: diskPath,
      usedBytes: diskUsed,
      availableBytes: diskAvailable,
      totalBytes: diskTotal,
      usedPercent: percent(diskUsed, diskTotal),
    },
    loadAverage: [oneMinute, fiveMinutes, fifteenMinutes],
  };
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${minutes}m`]
    .filter(Boolean)
    .join(" ");
}

function formatStats(stats: SystemStats): string {
  return [
    `Host      ${stats.hostname} (${stats.platform} ${stats.architecture})`,
    `CPU       ${stats.cpu.usagePercent.toFixed(1)}% / ${stats.cpu.logicalCores} logical cores / ${stats.cpu.speedMHz === null ? "speed unavailable" : `${Math.round(stats.cpu.speedMHz)} MHz`}`,
    `Memory    ${formatBytes(stats.memory.usedBytes)} / ${formatBytes(stats.memory.totalBytes)} (${stats.memory.usedPercent.toFixed(1)}%)`,
    `Disk      ${formatBytes(stats.disk.availableBytes)} available / ${formatBytes(stats.disk.totalBytes)} (${stats.disk.usedPercent.toFixed(1)}% used)`,
    `Load      ${stats.loadAverage.map((value) => value.toFixed(2)).join("  ")}`,
    `Uptime    ${formatUptime(stats.uptimeSeconds)}`,
  ].join("\n");
}

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    stats: collectStats,
  });

  bb.cli.register({
    name: "system-monitor",
    summary: "Show CPU, memory, disk, load, and uptime for the bb server host",
    commands: [
      {
        name: "show",
        summary: "Print the current machine statistics",
        usage: "bb system-monitor [show] [--json]",
      },
    ],
    async run(argv) {
      if (argv.includes("--help") || argv.includes("-h")) {
        return {
          exitCode: 0,
          stdout:
            "Usage: bb system-monitor [show] [--json]\n\nShows statistics for the host running the bb server.",
        };
      }

      const positional = argv.filter((arg) => !arg.startsWith("-"));
      if (
        positional.length > 1 ||
        (positional[0] && positional[0] !== "show")
      ) {
        return {
          exitCode: 2,
          stderr: `Unknown command: ${positional.join(" ")}\nUsage: bb system-monitor [show] [--json]`,
        };
      }

      const stats = await collectStats();
      return {
        exitCode: 0,
        stdout: argv.includes("--json")
          ? JSON.stringify(stats, null, 2)
          : formatStats(stats),
      };
    },
  });
}
