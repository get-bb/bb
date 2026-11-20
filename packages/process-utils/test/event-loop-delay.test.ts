import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import { startEventLoopDelaySampler } from "../src/event-loop-delay.js";
import { execHostFile } from "../src/host-process.js";

vi.mock("../src/host-process.js", () => ({ execHostFile: vi.fn() }));

describe("event loop delay sampler", () => {
  let wallMs: number;
  let monotonicMs: number;
  let uptimeMs: number;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(execHostFile).mockReset();
    wallMs = 1_000_000;
    monotonicMs = 0;
    uptimeMs = 0;
    vi.spyOn(Date, "now").mockImplementation(() => wallMs);
    vi.spyOn(process.hrtime, "bigint").mockImplementation(
      () => BigInt(monotonicMs) * 1_000_000n,
    );
    vi.spyOn(os, "uptime").mockImplementation(() => uptimeMs / 1_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function stubPlatform(platform: NodeJS.Platform) {
    vi.stubGlobal(
      "process",
      Object.create(process, { platform: { value: platform } }),
    );
  }

  function advanceSample(gaps: {
    wallMs: number;
    monotonicMs: number;
    uptimeMs: number;
  }) {
    wallMs += gaps.wallMs;
    monotonicMs += gaps.monotonicMs;
    uptimeMs += gaps.uptimeMs;
    return vi.advanceTimersByTimeAsync(5_000);
  }

  it("reports a long awake stall on Linux", async () => {
    stubPlatform("linux");
    const onSample = vi.fn();
    const sampler = startEventLoopDelaySampler({ onSample });
    try {
      await advanceSample({
        wallMs: 95_000,
        monotonicMs: 95_000,
        uptimeMs: 95_000,
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
  });

  it("does not let a wall clock jump turn an awake Linux stall into sleep", async () => {
    stubPlatform("linux");
    const onSample = vi.fn();
    const sampler = startEventLoopDelaySampler({ onSample });
    try {
      await advanceSample({
        wallMs: 95_000,
        monotonicMs: 1_000,
        uptimeMs: 1_000,
      });
      expect(onSample).toHaveBeenCalledWith({
        stall: expect.objectContaining({ maxDelayMs: 1_000 }),
        suspension: null,
      });
    } finally {
      sampler.stop();
    }
  });

  it("keeps a macOS stall when the kernel sleep record precedes the sample", async () => {
    stubPlatform("darwin");
    vi.mocked(execHostFile).mockResolvedValue({
      stdout: "{ sec = 900, usec = 0 }\n{ sec = 990, usec = 0 }\n",
      stderr: "",
    });
    const onSample = vi.fn();
    const sampler = startEventLoopDelaySampler({ onSample });
    try {
      await advanceSample({
        wallMs: 95_000,
        monotonicMs: 95_000,
        uptimeMs: 95_000,
      });
      expect(onSample).toHaveBeenCalledWith({
        stall: expect.objectContaining({ maxDelayMs: 95_000 }),
        suspension: null,
      });
    } finally {
      sampler.stop();
    }
  });

  it("reports both suspension and the remaining awake delay on macOS", async () => {
    stubPlatform("darwin");
    vi.mocked(execHostFile).mockResolvedValue({
      stdout: "{ sec = 1001, usec = 0 }\n{ sec = 1091, usec = 0 }\n",
      stderr: "",
    });
    const onSample = vi.fn();
    const sampler = startEventLoopDelaySampler({ onSample });
    try {
      await advanceSample({
        wallMs: 95_000,
        monotonicMs: 95_000,
        uptimeMs: 95_000,
      });
      expect(onSample).toHaveBeenCalledWith({
        stall: expect.objectContaining({ maxDelayMs: 5_000 }),
        suspension: expect.objectContaining({ durationMs: 90_000 }),
      });
    } finally {
      sampler.stop();
    }
  });

  it.each(["linux", "darwin"] as const)(
    "reports system suspension separately on %s",
    async (platform) => {
      stubPlatform(platform);
      const sysctl = vi.mocked(execHostFile).mockResolvedValue({
        stdout: "{ sec = 1000, usec = 0 }\n{ sec = 1090, usec = 0 }\n",
        stderr: "",
      });
      const onSample = vi.fn();
      const sampler = startEventLoopDelaySampler({ onSample });
      try {
        await advanceSample({
          wallMs: 90_050,
          monotonicMs: platform === "linux" ? 50 : 90_050,
          uptimeMs: 90_050,
        });
        expect(onSample).toHaveBeenCalledWith({
          stall: null,
          suspension: expect.objectContaining({ durationMs: 90_000 }),
        });
        expect(sysctl).toHaveBeenCalledTimes(platform === "darwin" ? 1 : 0);

        await advanceSample({ wallMs: 5_000, monotonicMs: 50, uptimeMs: 50 });
        expect(onSample).toHaveBeenLastCalledWith({
          stall: null,
          suspension: null,
        });
      } finally {
        sampler.stop();
      }
    },
  );

  it("treats a long gap as probable sleep on Windows", async () => {
    stubPlatform("win32");
    const onSample = vi.fn();
    const sampler = startEventLoopDelaySampler({ onSample });
    try {
      await advanceSample({ wallMs: 90_000, monotonicMs: 90_000, uptimeMs: 0 });
      expect(onSample).toHaveBeenLastCalledWith({
        stall: null,
        suspension: null,
      });

      await advanceSample({ wallMs: 3_000, monotonicMs: 3_000, uptimeMs: 0 });
      expect(onSample).toHaveBeenLastCalledWith({
        stall: expect.objectContaining({ maxDelayMs: 3_000 }),
        suspension: null,
      });
      expect(execHostFile).not.toHaveBeenCalled();
    } finally {
      sampler.stop();
    }
  });
});
