/// <reference types="node" />
import { threadCpuUsage } from "node:process";
import { expect, it } from "vitest";
import {
  parseSentThreadMessage,
  parseShellCommandIntents,
} from "../src/tool-call-parsing.js";

let benchmarkRun = 0;

function fastestSampleMs(
  workloads: readonly ((run: number) => void)[],
  repeats: number,
): number[] {
  const fastest = workloads.map(() => Number.POSITIVE_INFINITY);
  for (let sample = 0; sample < 7; sample += 1) {
    workloads.forEach((workload, index) => {
      const started = performance.now();
      for (let repeat = 0; repeat < repeats; repeat += 1) {
        benchmarkRun += 1;
        workload(benchmarkRun);
      }
      fastest[index] = Math.min(fastest[index]!, performance.now() - started);
    });
  }
  return fastest;
}

it("bounds intent parsing work after a script's disqualifying write", () => {
  const readOnly = "rg needle src;".repeat(64);
  const writeFirst = `cat > output.txt; ${readOnly}`;
  expect(parseShellCommandIntents(writeFirst)).toEqual([]);
  expect(parseShellCommandIntents(readOnly)).toEqual([
    { type: "search", cmd: readOnly, query: "needle", path: "src" },
  ]);

  const [writeFirstMs, readOnlyMs] = fastestSampleMs(
    [writeFirst, readOnly].map(
      (command) => (run: number) =>
        parseShellCommandIntents(`BENCH_SAMPLE=${run} ${command}`),
    ),
    32,
  );
  expect(writeFirstMs).toBeLessThan(readOnlyMs! / 8);
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
  const [reusedMs, coldMs] = fastestSampleMs(
    [
      () => {
        for (const command of commands) parseShellCommandIntents(command);
      },
      (run: number) => {
        for (const command of commands) {
          parseShellCommandIntents(`BENCH_COLD=${run} ${command}`);
        }
      },
    ],
    8,
  );
  expect(reusedMs).toBeLessThan(coldMs! / 5);
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
  const [quotedMs, escapedMs] = fastestSampleMs(
    [quoted, escaped].map((command) => () => parse(command)),
    16,
  );
  expect(quotedMs).toBeLessThan(escapedMs! / 4);
});
