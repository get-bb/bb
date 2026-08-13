import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { filterSerialLines, SerialFilterError } from "./filter.js";
import type { SerialLine } from "./ring-buffer.js";

function line(text: string, cursor = 1): SerialLine {
  return { cursor, at: "2026-08-13T12:00:00.000Z", dir: "rx", text };
}

describe("serial regex filter", () => {
  it("is per-read and never mutates the underlying lines", async () => {
    const lines = [line("boot ok", 1), line("sensor error", 2)];
    const errors = await filterSerialLines("error", lines);
    const boots = await filterSerialLines("boot", lines);
    expect([...errors]).toEqual([1]);
    expect([...boots]).toEqual([0]);
    expect(lines.map((entry) => entry.text)).toEqual(["boot ok", "sensor error"]);
  });

  it("returns a typed recoverable regex-engine error", async () => {
    await expect(filterSerialLines("[", [line("boot")]))
      .rejects.toEqual(expect.objectContaining({
        code: "INVALID_SERIAL_FILTER",
      } satisfies Partial<SerialFilterError>));
  });

  it("hard-aborts the reviewer's exact guard repro and alternation bombs", async () => {
    const cases = [
      {
        pattern: `(${"a\\b".repeat(44)}`,
        text: "anything",
      },
      { pattern: "(a|a)+b", text: "a".repeat(40) },
      { pattern: "(x|x)*y", text: "x".repeat(40) },
    ];

    for (const candidate of cases) {
      const startedAt = performance.now();
      await expect(filterSerialLines(candidate.pattern, [line(candidate.text)], {
        executionTimeoutMs: 25,
        startupTimeoutMs: 1_000,
      })).rejects.toEqual(expect.objectContaining({ code: "INVALID_SERIAL_FILTER" }));
      expect(performance.now() - startedAt).toBeLessThan(1_500);
    }
  }, 10_000);

  it("supports named capture groups and ordinary filters within the work budget", async () => {
    await expect(filterSerialLines("(?<stage>stage=1[0-9])", [
      line("stage=12", 1),
      line("stage=22", 2),
    ])).resolves.toEqual(new Set([0]));
  });
});
