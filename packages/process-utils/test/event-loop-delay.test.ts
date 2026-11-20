import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import childProcess from "node:child_process";
import os from "node:os";
import { startEventLoopDelaySampler } from "../src/event-loop-delay.js";

describe("event loop delay sampler", () => {
  let wallMs: number;
  let monotonicMs: number;
  let uptimeMs: number;
  let cpuMs: number;

  beforeEach(() => {
    vi.useFakeTimers();
    wallMs = 1_000_000;
    monotonicMs = 0;
    uptimeMs = 0;
    cpuMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => wallMs);
    vi.spyOn(process.hrtime, "bigint").mockImplementation(
      () => BigInt(monotonicMs) * 1_000_000n,
    );
    vi.spyOn(process, "cpuUsage").mockImplementation(() => ({
      user: cpuMs * 1_000,
      system: 0,
    }));
    vi.spyOn(os, "availableParallelism").mockReturnValue(4);
    vi.spyOn(os, "uptime").mockImplementation(() => uptimeMs / 1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function advanceSample(gaps: {
    wallMs: number;
    monotonicMs: number;
    uptimeMs: number;
    cpuMs: number;
  }) {
    wallMs += gaps.wallMs;
    monotonicMs += gaps.monotonicMs;
    uptimeMs += gaps.uptimeMs;
    cpuMs += gaps.cpuMs;
    vi.advanceTimersByTime(5_000);
  }

  it.each([0, 75_000])(
    "reports a long awake stall with %d ms of process CPU",
    (cpuMs) => {
      vi.stubGlobal(
        "process",
        Object.create(process, { platform: { value: "linux" } }),
      );
      const onSample = vi.fn();
      const sampler = startEventLoopDelaySampler({ onSample });
      try {
        advanceSample({
          wallMs: 95_000,
          monotonicMs: 95_000,
          uptimeMs: 95_000,
          cpuMs,
        });
        expect(onSample).toHaveBeenCalledWith({
          stall: expect.objectContaining({
            intervalMs: 5_000,
            maxDelayMs: 95_000,
            resolutionMs: 50,
            thresholdMs: 500,
          }),
          suspension: null,
        });
      } finally {
        sampler.stop();
      }
    },
  );

  it("does not let a wall clock jump turn an awake Linux stall into sleep", () => {
    vi.stubGlobal(
      "process",
      Object.create(process, { platform: { value: "linux" } }),
    );
    const onSample = vi.fn();
    const sampler = startEventLoopDelaySampler({ onSample });
    try {
      advanceSample({
        wallMs: 95_000,
        monotonicMs: 1_000,
        uptimeMs: 1_000,
        cpuMs: 0,
      });
      expect(onSample).toHaveBeenCalledWith({
        stall: expect.objectContaining({ maxDelayMs: 1_000 }),
        suspension: null,
      });
    } finally {
      sampler.stop();
    }
  });

  it("keeps a macOS stall when the kernel sleep record precedes the sample", () => {
    vi.stubGlobal(
      "process",
      Object.create(process, { platform: { value: "darwin" } }),
    );
    vi.spyOn(childProcess, "execFileSync").mockReturnValue(
      "{ sec = 900, usec = 0 }\n{ sec = 990, usec = 0 }\n",
    );
    const onSample = vi.fn();
    const sampler = startEventLoopDelaySampler({ onSample });
    try {
      advanceSample({
        wallMs: 95_000,
        monotonicMs: 95_000,
        uptimeMs: 95_000,
        cpuMs: 0,
      });
      expect(onSample).toHaveBeenCalledWith({
        stall: expect.objectContaining({ maxDelayMs: 95_000 }),
        suspension: null,
      });
    } finally {
      sampler.stop();
    }
  });

  it("keeps a macOS stall when CPU use exceeds the apparent awake period", () => {
    vi.stubGlobal(
      "process",
      Object.create(process, { platform: { value: "darwin" } }),
    );
    vi.spyOn(childProcess, "execFileSync").mockReturnValue(
      "{ sec = 1000, usec = 0 }\n{ sec = 1090, usec = 0 }\n",
    );
    const onSample = vi.fn();
    const sampler = startEventLoopDelaySampler({ onSample });
    try {
      advanceSample({
        wallMs: 90_050,
        monotonicMs: 90_050,
        uptimeMs: 90_050,
        cpuMs: 75_000,
      });
      expect(onSample).toHaveBeenCalledWith({
        stall: expect.objectContaining({ maxDelayMs: 90_050 }),
        suspension: null,
      });
    } finally {
      sampler.stop();
    }
  });

  it("reports both suspension and the remaining awake delay on macOS", () => {
    vi.stubGlobal(
      "process",
      Object.create(process, { platform: { value: "darwin" } }),
    );
    vi.spyOn(childProcess, "execFileSync").mockReturnValue(
      "{ sec = 1001, usec = 0 }\n{ sec = 1091, usec = 0 }\n",
    );
    const onSample = vi.fn();
    const sampler = startEventLoopDelaySampler({ onSample });
    try {
      advanceSample({
        wallMs: 95_000,
        monotonicMs: 95_000,
        uptimeMs: 95_000,
        cpuMs: 150,
      });
      expect(onSample).toHaveBeenCalledWith({
        stall: expect.objectContaining({ maxDelayMs: 5_000 }),
        suspension: expect.objectContaining({
          durationMs: 90_000,
          processCpuMs: 150,
        }),
      });
    } finally {
      sampler.stop();
    }
  });

  it.each(["linux", "darwin"])(
    "reports system suspension separately on %s",
    (platform) => {
      vi.stubGlobal(
        "process",
        Object.create(process, { platform: { value: platform } }),
      );
      const sysctl = vi
        .spyOn(childProcess, "execFileSync")
        .mockReturnValue(
          "{ sec = 1000, usec = 0 }\n{ sec = 1090, usec = 0 }\n",
        );
      const onSample = vi.fn();
      const sampler = startEventLoopDelaySampler({ onSample });
      try {
        advanceSample({
          wallMs: 90_050,
          monotonicMs: platform === "linux" ? 50 : 90_050,
          uptimeMs: 90_050,
          cpuMs: 2,
        });
        expect(onSample).toHaveBeenCalledWith({
          stall: null,
          suspension: expect.objectContaining({
            durationMs: 90_000,
            processCpuMs: 2,
          }),
        });
        expect(sysctl).toHaveBeenCalledTimes(platform === "darwin" ? 1 : 0);

        advanceSample({
          wallMs: 5_000,
          monotonicMs: 50,
          uptimeMs: 50,
          cpuMs: 2,
        });
        expect(onSample).toHaveBeenLastCalledWith({
          stall: null,
          suspension: null,
        });
      } finally {
        sampler.stop();
      }
    },
  );
});
