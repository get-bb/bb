import { cpuUsage, threadCpuUsage } from "node:process";

export interface CpuClock {
  name: string;
  nowMs: () => number;
}

function processCpuMs(): number {
  const usage = cpuUsage();
  return (usage.user + usage.system) / 1_000;
}

function threadCpuMs(): number {
  const usage = threadCpuUsage();
  return (usage.user + usage.system) / 1_000;
}

export function selectCpuClock(): CpuClock {
  return process.platform === "linux"
    ? { name: "process CPU time (process.cpuUsage)", nowMs: processCpuMs }
    : { name: "thread CPU time (process.threadCpuUsage)", nowMs: threadCpuMs };
}
