import { describe, expect, it, vi } from "vitest";
import { snapshotTarget } from "./snapshot.js";
import type { DebugGdbSession } from "./session.js";

describe("target snapshot", () => {
  it("briefly halts, never resets, records exact perturbation, and resumes", async () => {
    const transcript: string[] = [];
    const session: DebugGdbSession = {
      deviceId: "probe-rs:serial-hash",
      serverKind: "openocd",
      executeCommand: async (command) => ({ kind: "result", token: 1, class: "done", results: { command } }),
      halt: async () => { transcript.push("halt"); },
      continue: async () => { transcript.push("continue"); },
      readRegisters: async () => { transcript.push("registers"); return { pc: "0x0800" }; },
      readMemory: async (addr, bytes) => { transcript.push(`memory:${addr}:${bytes}`); return Uint8Array.from([1, 2]); },
      backtrace: async () => { transcript.push("backtrace"); return [{ level: 0, address: "0x0800", function: "main", file: "main.c", line: 1 }]; },
      rtosTasks: async () => { transcript.push("tasks"); return { method: "server", tasks: [] }; },
      setBreakpoint: vi.fn(),
      dispose: async () => undefined,
    };
    const ticks = [100, 112];
    const snapshot = await snapshotTarget(session, {
      memoryRegions: [{ addr: "0x2000", bytes: 2 }],
      writeMemoryArtifact: async () => ".fs-bench/probe-runs/run/memory.bin",
      now: () => new Date("2026-08-13T12:00:00.000Z"),
      monotonicNowMs: () => ticks.shift()!,
    });
    expect(snapshot).toEqual({
      deviceId: session.deviceId,
      takenAt: "2026-08-13T12:00:00.000Z",
      perturbation: { halted: true, haltMs: 12 },
      registers: { pc: "0x0800" },
      frames: [{ level: 0, address: "0x0800", function: "main", file: "main.c", line: 1 }],
      tasks: [],
      memoryRegions: [{ addr: "0x2000", bytes: 2, artifactPath: ".fs-bench/probe-runs/run/memory.bin" }],
    });
    expect(transcript[0]).toBe("halt");
    expect(transcript.at(-1)).toBe("continue");
    expect(transcript.join(" ")).not.toMatch(/reset|erase|flash/iu);
  });

  it("records no perturbation for non-stop reads", async () => {
    const session = {
      deviceId: "probe",
      serverKind: "jlink" as const,
      setBreakpoint: vi.fn(),
      readRegisters: async () => ({}),
      readMemory: async () => new Uint8Array(),
      backtrace: async () => [],
      rtosTasks: async () => ({ method: "server" as const, tasks: [] }),
      dispose: async () => undefined,
    };
    await expect(snapshotTarget(session, { nonStop: true })).resolves.toMatchObject({
      perturbation: { halted: false, haltMs: null },
    });
  });
});
