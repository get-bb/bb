/// <reference types="node" />
import { threadCpuUsage } from "node:process";
import { expect, it } from "vitest";
import {
  parseSentThreadMessage,
  parseShellCommandIntents,
} from "../src/tool-call-parsing.js";

let benchmarkRun = 0;

function fastestCpuUsPerRun(
  workloads: readonly ((run: number) => void)[],
  batchSize: number,
): number[] {
  for (const workload of workloads) workload(++benchmarkRun);
  const fastest = workloads.map(() => Number.POSITIVE_INFINITY);
  for (let sample = 0; sample < 3; sample += 1) {
    workloads.forEach((workload, index) => {
      const started = threadCpuUsage();
      let runs = 0;
      let elapsedCpuUs = 0;
      do {
        for (let repeat = 0; repeat < batchSize; repeat += 1) {
          workload(++benchmarkRun);
        }
        runs += batchSize;
        const cpu = threadCpuUsage(started);
        elapsedCpuUs = cpu.user + cpu.system;
      } while (elapsedCpuUs < 100_000);
      fastest[index] = Math.min(fastest[index]!, elapsedCpuUs / runs);
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

  const [writeFirstCpuUs, readOnlyCpuUs] = fastestCpuUsPerRun(
    [writeFirst, readOnly].map(
      (command) => (run: number) =>
        parseShellCommandIntents(`BENCH_SAMPLE=${run} ${command}`),
    ),
    32,
  );
  expect(writeFirstCpuUs).toBeLessThan(readOnlyCpuUs! / 3);
});

it("keeps bb thread tell parsing linear on unterminated heredocs", () => {
  const command = `bb thread tell thr_wrkr234567 --message-file - <<'EOF'\n${"x <<a\n".repeat(16_000)}`;
  const call = (repeat: number) =>
    ({
      command: `${command}${repeat}`,
      exitCode: 0,
      status: "completed",
    }) as const;
  expect(parseSentThreadMessage(call(-1))).toBeNull();

  const started = threadCpuUsage();
  for (let repeat = 0; repeat < 32; repeat += 1) {
    parseSentThreadMessage(call(repeat));
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
  const [reusedCpuUs, coldCpuUs] = fastestCpuUsPerRun(
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
  expect(reusedCpuUs).toBeLessThan(coldCpuUs! / 5);
});

it("scans long quoted thread messages in chunks", () => {
  const message = Array.from({ length: 4_000 }, () => "payload").join(" ");
  const quoted = `bb thread tell thr_wrkr234567 '${message}'`;
  const escaped = `bb thread tell thr_wrkr234567 ${message.replaceAll(" ", "\\ ")}`;
  const parse = (command: string) =>
    parseSentThreadMessage({ command, exitCode: 0, status: "completed" });
  for (const command of [quoted, escaped]) {
    expect(parse(command)).toEqual({ threadId: "thr_wrkr234567", message });
    expect(
      parse(command.replace("thread tell ", "thread tell --model probe ")),
    ).toEqual({ threadId: "thr_wrkr234567", message });
  }
  const [quotedCpuUs, escapedCpuUs] = fastestCpuUsPerRun(
    [quoted, escaped].map(
      (command) => (run: number) =>
        parse(command.replace("thread tell ", `thread tell --model m${run} `)),
    ),
    16,
  );
  expect(quotedCpuUs).toBeLessThan(escapedCpuUs! / 4);
});

it("reuses bb thread tell parses across repeated timeline builds", () => {
  const payload = Array.from({ length: 4_000 }, () => "payload").join(" ");
  const commands = Array.from(
    { length: 64 },
    (_, index) => `cat notes-${index}.txt; echo '${payload}'`,
  );
  const parse = (command: string) =>
    parseSentThreadMessage({ command, exitCode: 0, status: "completed" });
  for (const command of commands) expect(parse(command)).toBeNull();
  const [reusedCpuUs, coldCpuUs] = fastestCpuUsPerRun(
    [
      () => {
        for (const command of commands) parse(command);
      },
      (run: number) => {
        for (const command of commands) parse(`${command} ${run}`);
      },
    ],
    8,
  );
  expect(reusedCpuUs).toBeLessThan(coldCpuUs! / 5);
});
