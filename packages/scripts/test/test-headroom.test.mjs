import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  NEAR_LIMIT_FRACTION,
  parseDurationRecord,
  readDurationRecords,
  summarizeTestHeadroom,
  testHeadroomMarkdown,
} from "../../../scripts/lib/test-headroom.mjs";

const record = (overrides) => ({
  run: "1",
  file: "packages/db/test/a.test.ts",
  name: "a > b",
  platform: "win32",
  state: "passed",
  durationMs: 1000,
  timeoutMs: 15000,
  ...overrides,
});

describe("summarizeTestHeadroom", () => {
  it("lists a test once per platform with its worst run and how often it came near the limit", () => {
    const rows = summarizeTestHeadroom([
      record({ run: "1", durationMs: 9000 }),
      record({ run: "2", durationMs: 15000, state: "failed" }),
      record({ run: "3", durationMs: 4000 }),
      record({ run: "1", platform: "linux", durationMs: 8000 }),
    ]);

    expect(rows).toEqual([
      {
        platform: "win32",
        file: "packages/db/test/a.test.ts",
        name: "a > b",
        nearRuns: 2,
        failedRuns: 1,
        worstDurationMs: 15000,
        timeoutMs: 15000,
        worstFraction: 1,
      },
      {
        platform: "linux",
        file: "packages/db/test/a.test.ts",
        name: "a > b",
        nearRuns: 1,
        failedRuns: 0,
        worstDurationMs: 8000,
        timeoutMs: 15000,
        worstFraction: 8000 / 15000,
      },
    ]);
  });

  it("leaves out tests that never reached the near-limit fraction", () => {
    expect(
      summarizeTestHeadroom([
        record({ durationMs: 15000 * NEAR_LIMIT_FRACTION - 1 }),
      ]),
    ).toEqual([]);
  });

  it("compares each run against the timeout that test actually had", () => {
    const rows = summarizeTestHeadroom([
      record({ run: "1", durationMs: 4000, timeoutMs: 5000 }),
      record({ run: "2", durationMs: 9000, timeoutMs: 20000 }),
    ]);

    expect(rows).toMatchObject([
      { worstDurationMs: 4000, timeoutMs: 5000, nearRuns: 1 },
    ]);
  });
});

describe("readDurationRecords", () => {
  it("reads every artifact under a run directory and skips malformed lines", () => {
    const root = mkdtempSync(join(tmpdir(), "bb-test-headroom-"));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "41", "test-timings-windows-app-1-1"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "41", "test-timings-windows-app-1-1", "123.jsonl"),
      [
        JSON.stringify(record({ run: undefined })),
        "not json",
        JSON.stringify({ file: "x" }),
        "",
      ].join("\n"),
    );
    writeFileSync(join(root, "41", "turbo-summary.json"), "{}");

    expect(readDurationRecords(root)).toEqual([
      {
        run: "41",
        file: "packages/db/test/a.test.ts",
        name: "a > b",
        platform: "win32",
        state: "passed",
        durationMs: 1000,
        timeoutMs: 15000,
      },
    ]);
  });

  it("rejects records without a usable timeout", () => {
    expect(
      parseDurationRecord(JSON.stringify(record({ timeoutMs: 0 }))),
    ).toBeNull();
  });
});

describe("testHeadroomMarkdown", () => {
  it("names each test with its worst duration against its timeout", () => {
    const markdown = testHeadroomMarkdown(
      summarizeTestHeadroom([
        record({ durationMs: 12000, name: "suite > a | b" }),
      ]),
      3,
    );

    expect(markdown).toContain(
      "1 tests used at least 50% of their timeout in 3 recent main runs",
    );
    expect(markdown).toContain(
      "| 12.0 s (80%) | 15.0 s | 1 | 0 | win32 | `packages/db/test/a.test.ts` › suite > a \\| b |",
    );
  });
});
