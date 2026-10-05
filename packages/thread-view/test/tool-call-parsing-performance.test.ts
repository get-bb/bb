/// <reference types="node" />
import { threadCpuUsage } from "node:process";
import { expect, it } from "vitest";
import {
  parseSentThreadMessage,
  parseShellCommandIntents,
} from "../src/tool-call-parsing.js";

it("bounds intent parsing work after a script's disqualifying write", () => {
  const payload = "synthetic payload words\n".repeat(20_000);
  const writeFirst = `cat > output.txt <<'EOF'\n${payload}EOF`;
  const readOnly = `cat '${payload}'`;
  expect(parseShellCommandIntents(writeFirst)).toEqual([]);
  expect(parseShellCommandIntents(readOnly)).toEqual([
    { type: "read", cmd: readOnly, name: "cat", path: payload },
  ]);

  const minimumCpu = (command: string): number => {
    const samples: number[] = [];
    for (let sample = 0; sample < 5; sample += 1) {
      const started = threadCpuUsage();
      for (let repeat = 0; repeat < 32; repeat += 1) {
        parseShellCommandIntents(command);
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
