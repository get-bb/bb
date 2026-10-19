/// <reference types="node" />
import { threadCpuUsage } from "node:process";
import { expect, it } from "vitest";
import {
  parseSentThreadMessage,
  parseShellCommandIntents,
} from "../src/tool-call-parsing.js";

it("bounds intent parsing work after a script's disqualifying write", () => {
  const readOnly = "rg needle src;".repeat(64);
  const writeFirst = `cat > output.txt; ${readOnly}`;
  expect(parseShellCommandIntents(writeFirst)).toEqual([]);
  expect(parseShellCommandIntents(readOnly)).toEqual([
    { type: "search", cmd: readOnly, query: "needle", path: "src" },
  ]);

  const minimumCpu = (command: string): number => {
    const samples: number[] = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const started = threadCpuUsage();
      for (let repeat = 0; repeat < 32; repeat += 1) {
        parseShellCommandIntents(`BENCH_SAMPLE=${sample}_${repeat} ${command}`);
      }
      const cpu = threadCpuUsage(started);
      samples.push(cpu.user + cpu.system);
    }
    return Math.min(...samples);
  };

  expect(minimumCpu(writeFirst)).toBeLessThan(minimumCpu(readOnly) / 8);
});

it("keeps bb thread tell parsing linear on unterminated heredocs", () => {
  const command = `bb thread tell thr_wrkr234567 --message-file - <<'EOF'\n${"x <<a\n".repeat(16_000)}`;
  const call = { command, exitCode: 0, status: "completed" } as const;
  expect(parseSentThreadMessage(call)).toBeNull();

  const started = threadCpuUsage();
  for (let repeat = 0; repeat < 32; repeat += 1) {
    parseSentThreadMessage(call);
  }
  const cpu = threadCpuUsage(started);
  expect(cpu.user + cpu.system).toBeLessThan(500_000);
});

it("reuses shell summaries across repeated timeline builds", () => {
  const payload = "rg needle src;".repeat(64);
  const commands = Array.from(
    { length: 64 },
    (_, index) => `rg needle path-${index}; ${payload}`,
  );
  for (const command of commands) {
    expect(parseShellCommandIntents(command)[0]?.type).toBe("search");
  }
  const minimumCpu = (reuse: boolean): number => {
    const samples: number[] = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const started = threadCpuUsage();
      for (let repeat = 0; repeat < 8; repeat += 1) {
        for (const command of commands) {
          parseShellCommandIntents(
            reuse ? command : `BENCH_COLD=${sample}_${repeat} ${command}`,
          );
        }
      }
      const cpu = threadCpuUsage(started);
      samples.push(cpu.user + cpu.system);
    }
    return Math.min(...samples);
  };
  const reusedCpu = minimumCpu(true);
  expect(reusedCpu).toBeLessThan(minimumCpu(false) / 5);
});

it("scans long quoted thread messages in chunks without summary caching", () => {
  const message = Array.from({ length: 4_000 }, () => "payload").join(" ");
  const quoted = `bb thread tell thr_wrkr234567 '${message}'`;
  const escaped = `bb thread tell thr_wrkr234567 ${message.replaceAll(" ", "\\ ")}`;
  const parse = (command: string) =>
    parseSentThreadMessage({ command, exitCode: 0, status: "completed" });
  for (const command of [quoted, escaped]) {
    expect(parse(command)).toEqual({ threadId: "thr_wrkr234567", message });
  }
  const minimumCpu = (command: string): number => {
    const samples: number[] = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const start = threadCpuUsage();
      for (let repeat = 0; repeat < 16; repeat += 1) parse(command);
      const cpu = threadCpuUsage(start);
      samples.push(cpu.user + cpu.system);
    }
    return Math.min(...samples);
  };
  expect(minimumCpu(quoted)).toBeLessThan(minimumCpu(escaped) / 4);
});
