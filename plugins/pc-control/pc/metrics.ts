import type { SystemSnapshot } from "./schemas.js";

export interface OsCpuTimes {
  idle: number;
  total: number;
}

export interface OsMetricsSource {
  cpus(): OsCpuTimes[];
  totalmem(): number;
  freemem(): number;
  uptime(): number;
}

export interface MetricsDeps {
  readonly os: OsMetricsSource;
  readonly now: () => number;
  readonly delay: (ms: number) => Promise<void>;
}

const FIRST_SAMPLE_DELAY_MS = 300;
const MIN_SAMPLE_INTERVAL_MS = 500;

function deltaPercent(
  idleDelta: number,
  totalDelta: number,
): number | null {
  if (totalDelta <= 0) return null;
  const percent = ((totalDelta - idleDelta) / totalDelta) * 100;
  return Math.min(100, Math.max(0, percent));
}

function sumCpuTimes(times: readonly OsCpuTimes[]): OsCpuTimes {
  let idle = 0;
  let total = 0;
  for (const entry of times) {
    idle += entry.idle;
    total += entry.total;
  }
  return { idle, total };
}

function usedPercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (used / total) * 100));
}

export class CpuPercentSampler {
  private previous: { times: OsCpuTimes; at: number } | null = null;
  private lastResult: number | null = null;

  constructor(private readonly deps: Pick<MetricsDeps, "now" | "delay">) {}

  async percent(os: Pick<OsMetricsSource, "cpus">): Promise<number | null> {
    const now = this.deps.now();
    const current = sumCpuTimes(os.cpus());
    const previous = this.previous;
    if (
      previous !== null &&
      now - previous.at < MIN_SAMPLE_INTERVAL_MS
    ) {
      return this.lastResult;
    }
    if (previous === null) {
      this.previous = { times: current, at: now };
      await this.deps.delay(FIRST_SAMPLE_DELAY_MS);
      const second = sumCpuTimes(os.cpus());
      const secondAt = this.deps.now();
      this.previous = { times: second, at: secondAt };
      const value = deltaPercent(
        second.idle - current.idle,
        second.total - current.total,
      );
      if (value !== null) this.lastResult = value;
      return value ?? this.lastResult;
    }
    this.previous = { times: current, at: now };
    const value = deltaPercent(
      current.idle - previous.times.idle,
      current.total - previous.times.total,
    );
    if (value !== null) this.lastResult = value;
    return value ?? this.lastResult;
  }

  reset(): void {
    this.previous = null;
    this.lastResult = null;
  }
}

export async function collectSystemSnapshot(
  deps: MetricsDeps,
  sampler: CpuPercentSampler,
): Promise<SystemSnapshot> {
  const cpuPercent = await sampler.percent(deps.os);
  const memoryTotalBytes = deps.os.totalmem();
  const memoryUsedBytes = Math.max(
    0,
    memoryTotalBytes - deps.os.freemem(),
  );
  return {
    cpuPercent,
    cpuCores: Math.max(1, deps.os.cpus().length),
    memoryTotalBytes,
    memoryUsedBytes,
    memoryUsedPercent: usedPercent(memoryUsedBytes, memoryTotalBytes),
    uptimeSeconds: deps.os.uptime(),
    collectedAt: new Date(deps.now()).toISOString(),
  };
}
