import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendCliErrorLogEntry,
  type CliErrorLogEntry,
  formatCliErrorLogPath,
  readCliErrorLogEntries,
} from "../cli-error-log.js";
import { tallyCliErrors } from "../commands/diagnostics.js";

function entry(overrides: Partial<CliErrorLogEntry>): CliErrorLogEntry {
  return {
    at: "2026-09-18T00:00:00.000Z",
    cliVersion: "0.0.0-test",
    code: "unknown_option",
    command: "terminal output",
    exitCode: 1,
    threadId: "thr_1",
    token: "--lines",
    ...overrides,
  };
}

describe("cli error log", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bb-cli-error-log-"));
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("appends one JSON line per failure under the data dir", () => {
    const env = { BB_DATA_DIR: dataDir };
    appendCliErrorLogEntry(entry({}), env);
    appendCliErrorLogEntry(entry({ token: "--tail" }), env);

    const lines = readFileSync(formatCliErrorLogPath({ dataDir }), "utf8")
      .trim()
      .split("\n");
    expect(lines.map((line) => JSON.parse(line).token)).toEqual([
      "--lines",
      "--tail",
    ]);
  });

  it("writes nothing when recording is switched off", () => {
    appendCliErrorLogEntry(entry({}), {
      BB_DATA_DIR: dataDir,
      BB_CLI_ERROR_LOG: "0",
    });
    expect(readCliErrorLogEntries({ dataDir })).toEqual([]);
  });

  it("rotates an oversized log and still reads both generations", () => {
    const logPath = formatCliErrorLogPath({ dataDir });
    mkdirSync(join(dataDir, "logs"), { recursive: true });
    const old = `${JSON.stringify(entry({ token: "--old" }))}\n`;
    writeFileSync(
      logPath,
      old.repeat(Math.ceil((2 * 1024 * 1024) / old.length)),
    );

    appendCliErrorLogEntry(entry({ token: "--new" }), { BB_DATA_DIR: dataDir });

    expect(statSync(`${logPath}.1`).size).toBeGreaterThan(2 * 1024 * 1024 - 1);
    expect(readFileSync(logPath, "utf8").trim().split("\n")).toHaveLength(1);
    const tokens = new Set(
      readCliErrorLogEntries({ dataDir }).map((row) => row.token),
    );
    expect(tokens).toEqual(new Set(["--old", "--new"]));
  });

  it("skips corrupt and foreign lines instead of failing the tally", () => {
    const logPath = formatCliErrorLogPath({ dataDir });
    mkdirSync(join(dataDir, "logs"), { recursive: true });
    writeFileSync(
      logPath,
      [
        "{not json",
        JSON.stringify({ unrelated: true }),
        JSON.stringify(entry({})),
        "",
      ].join("\n"),
    );
    expect(readCliErrorLogEntries({ dataDir })).toEqual([entry({})]);
  });

  it("never throws when the data dir cannot be written", () => {
    const blocked = join(dataDir, "file");
    writeFileSync(blocked, "");
    expect(() =>
      appendCliErrorLogEntry(entry({}), { BB_DATA_DIR: blocked }),
    ).not.toThrow();
  });
});

describe("tallyCliErrors", () => {
  it("groups by command, code, and token, most frequent first", () => {
    const rows = tallyCliErrors([
      entry({ at: "2026-09-18T00:00:01.000Z" }),
      entry({ at: "2026-09-18T00:00:03.000Z" }),
      entry({ command: "thread", code: "unknown_command", token: "get" }),
      entry({ token: "--tail", at: "2026-09-18T00:00:02.000Z" }),
    ]);
    expect(rows[0]).toEqual({
      code: "unknown_option",
      command: "terminal output",
      count: 2,
      lastAt: "2026-09-18T00:00:03.000Z",
      token: "--lines",
    });
    expect(rows).toHaveLength(3);
  });
});
