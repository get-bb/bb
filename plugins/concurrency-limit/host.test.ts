import { describe, expect, it } from "vitest";
import { computeLoadSample, type LoadSamplerDependencies } from "./host.js";
import { HostLoadCache, SAMPLE_MAX_AGE_MS } from "./load.js";

function deps(
  overrides: Partial<LoadSamplerDependencies> = {},
): LoadSamplerDependencies {
  return {
    platform: () => "darwin",
    totalmem: () => 16_000,
    freemem: () => 8_000,
    loadavg: () => [4, 4, 4],
    cpuCount: () => 8,
    now: () => 1_000,
    ...overrides,
  };
}

describe("computeLoadSample", () => {
  it("reads CPU as load average over core count", () => {
    // Load 4 on 8 cores is a half-full run queue.
    expect(computeLoadSample(deps()).cpuPercent).toBe(50);
  });

  it("clamps a saturated machine to 100 rather than reporting past it", () => {
    // Load average is a queue length, so it legitimately exceeds core count;
    // the contract's output schema caps the field at 100.
    expect(
      computeLoadSample(deps({ loadavg: () => [32, 0, 0] })).cpuPercent,
    ).toBe(100);
  });

  it("reports CPU as unsupported on Windows instead of a permanent zero", () => {
    // os.loadavg() returns zeroes on Windows; without this flag a Windows host
    // would look permanently idle to a CPU threshold.
    const sample = computeLoadSample(
      deps({ platform: () => "win32", loadavg: () => [0, 0, 0] }),
    );
    expect(sample.cpuSupported).toBe(false);
    expect(sample.memoryPercent).toBe(50);
  });

  it("computes memory from used over total", () => {
    expect(
      computeLoadSample(deps({ totalmem: () => 1_000, freemem: () => 250 }))
        .memoryPercent,
    ).toBe(75);
  });

  it("does not divide by zero when the OS reports nothing useful", () => {
    const sample = computeLoadSample(
      deps({ totalmem: () => 0, freemem: () => 0, cpuCount: () => 0 }),
    );
    expect(sample.memoryPercent).toBe(0);
    expect(Number.isFinite(sample.cpuPercent)).toBe(true);
  });
});

describe("HostLoadCache", () => {
  it("discards a reading once it is older than the staleness window", () => {
    // A stale "92% CPU" from a machine that has since gone quiet — or
    // disconnected — would hold work forever with nothing to explain why.
    const cache = new HostLoadCache();
    cache.set("host-a", {
      cpuPercent: 92,
      memoryPercent: 10,
      sampledAt: 1_000,
    });
    expect(cache.get("host-a", 1_000 + SAMPLE_MAX_AGE_MS)).not.toBeNull();
    expect(cache.get("host-a", 1_001 + SAMPLE_MAX_AGE_MS)).toBeNull();
  });

  it("returns null for a host it has never sampled", () => {
    expect(new HostLoadCache().get("host-a", 0)).toBeNull();
  });
});
