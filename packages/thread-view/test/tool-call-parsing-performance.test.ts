/// <reference types="node" />
import { threadCpuUsage } from "node:process";
import { expect, it } from "vitest";
import { parseShellCommandIntents } from "../src/tool-call-parsing.js";

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
