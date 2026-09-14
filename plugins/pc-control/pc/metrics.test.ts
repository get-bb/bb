import { describe, expect, it } from "vitest";
import {
  CpuPercentSampler,
  collectSystemSnapshot,
  type MetricsDeps,
  type OsMetricsSource,
} from "./metrics.js";

function fakeOs(overrides?: Partial<Record<keyof OsMetricsSource, unknown>>): OsMetricsSource {
  return {
    cpus: () => [
      { idle: 90, total: 100 },
      { idle: 80, total: 100 },
    ],
    totalmem: () => 16 * 1024 ** 3,
    freemem: () => 4 * 1024 ** 3,
    uptime: () => 3_600,
    ...overrides,
  } as OsMetricsSource;
}

function fakeDeps(
  os: OsMetricsSource,
  clock: number[] = [1_000, 2_000, 3_000],
): MetricsDeps {
  let tick = 0;
  return {
    os,
    now: () => clock[Math.min(tick, clock.length - 1)] ?? 1_000,
    delay: async () => {
      tick += 1;
    },
  };
}

describe("CpuPercentSampler", () => {
  it("produces a percent from the first short window after a delay", async () => {
    let call = 0;
    const os = fakeOs({
      cpus: (() => {
        call += 1;
        return call === 1
          ? [{ idle: 90, total: 100 }]
          : [{ idle: 99, total: 110 }];
      }) as OsMetricsSource["cpus"],
    });
    const deps = fakeDeps(os, [0, 1_000]);
    const sampler = new CpuPercentSampler(deps);
    const percent = await sampler.percent(os);
    expect(percent).toBeCloseTo(10, 5);
  });

  it("returns null while waiting for a second sample window", async () => {
    let idle = 100;
    let total = 200;
    const os = fakeOs({
      cpus: () => [{ idle, total }],
    });
    const clock = [0, 1_000, 2_000, 3_000];
    let tick = 0;
    const deps: MetricsDeps = {
      os,
      now: () => clock[Math.min(tick, clock.length - 1)] ?? 0,
      delay: async () => {
        tick += 1;
      },
    };
    const sampler = new CpuPercentSampler(deps);
    expect(await sampler.percent(os)).toBeNull();
    idle = 200;
    total = 400;
    tick += 1;
    const second = await sampler.percent(os);
    expect(second).toBeCloseTo(50, 5);
  });

  it("serves the cached value to a caller that arrives too soon", async () => {
    let phase = 0;
    const os = fakeOs({
      cpus: (() => {
        if (phase === 0) return [{ idle: 90, total: 100 }];
        if (phase === 1) return [{ idle: 99, total: 110 }];
        return [{ idle: 176, total: 220 }];
      }) as OsMetricsSource["cpus"],
    });
    const clock = [0, 300, 2_300, 4_000];
    let tick = 0;
    const deps: MetricsDeps = {
      os,
      now: () => clock[Math.min(tick, clock.length - 1)] ?? 0,
      delay: async () => {
        tick += 1;
        phase = 1;
      },
    };
    const sampler = new CpuPercentSampler(deps);
    const first = await sampler.percent(os);
    expect(first).toBeCloseTo(10, 5);
    const tooSoon = await sampler.percent(os);
    expect(tooSoon).toBeCloseTo(10, 5);
    phase = 2;
    tick = 3;
    const later = await sampler.percent(os);
    expect(later).toBeCloseTo(30, 5);
  });

  it("clamps out-of-range deltas", async () => {
    let idle = 50;
    let total = 100;
    const os = fakeOs({
      cpus: () => [{ idle, total }],
    });
    const clock = [0, 1_000, 2_000, 3_000];
    let tick = 0;
    const deps: MetricsDeps = {
      os,
      now: () => clock[Math.min(tick, clock.length - 1)] ?? 0,
      delay: async () => {
        tick += 1;
      },
    };
    const sampler = new CpuPercentSampler(deps);
    await sampler.percent(os);
    idle = 0;
    total = 120;
    tick += 1;
    expect(await sampler.percent(os)).toBe(100);
  });
});

describe("collectSystemSnapshot", () => {
  it("assembles cpu, memory, and uptime without spawning anything", async () => {
    const os = fakeOs();
    const deps = fakeDeps(os);
    const sampler = new CpuPercentSampler(deps);
    const snapshot = await collectSystemSnapshot(deps, sampler);
    expect(snapshot.cpuCores).toBe(2);
    expect(snapshot.memoryTotalBytes).toBe(16 * 1024 ** 3);
    expect(snapshot.memoryUsedBytes).toBe(12 * 1024 ** 3);
    expect(snapshot.memoryUsedPercent).toBeCloseTo(75, 5);
    expect(snapshot.uptimeSeconds).toBe(3_600);
    expect(snapshot.collectedAt).toBe("1970-01-01T00:00:02.000Z");
  });
});
