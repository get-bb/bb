import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
} from "../helpers/command-output-harness.js";
import { registerDiagnosticsCommands } from "../../commands/diagnostics.js";

function logLine(overrides: Record<string, unknown>): string {
  return JSON.stringify({
    at: new Date().toISOString(),
    cliVersion: "0.0.0-test",
    code: "unknown_option",
    command: "terminal output",
    exitCode: 1,
    threadId: null,
    token: "--lines",
    ...overrides,
  });
}

describe("bb diagnostics cli-errors", () => {
  setupCommandOutputTestEnvironment();
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "bb-diagnostics-"));
    mkdirSync(join(dataDir, "logs"), { recursive: true });
    vi.stubEnv("BB_DATA_DIR", dataDir);
    vi.stubEnv("BB_CLI_ERROR_LOG", "1");
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("tallies recent failures and leaves out the ones older than --since", async () => {
    writeFileSync(
      join(dataDir, "logs", "cli-errors.jsonl"),
      [
        logLine({}),
        logLine({}),
        logLine({ command: "thread", code: "unknown_command", token: "get" }),
        logLine({ at: "2020-01-01T00:00:00.000Z", token: "--ancient" }),
      ].join("\n"),
    );

    await runCommand(
      ["diagnostics", "cli-errors", "--since", "7d", "--json"],
      registerDiagnosticsCommands,
    );

    const payload = JSON.parse(
      collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}",
    );
    expect(payload.total).toBe(3);
    expect(payload.rows.map((row: { token: string }) => row.token)).toEqual([
      "--lines",
      "get",
    ]);
    expect(payload.rows[0].count).toBe(2);
  });

  it("says where it looked when nothing has failed", async () => {
    await runCommand(
      ["diagnostics", "cli-errors"],
      registerDiagnosticsCommands,
    );

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      `No failed bb invocations recorded in ${join(dataDir, "logs", "cli-errors.jsonl")}`,
    ]);
  });

  it("clears both log generations", async () => {
    const logPath = join(dataDir, "logs", "cli-errors.jsonl");
    writeFileSync(logPath, logLine({}));
    writeFileSync(`${logPath}.1`, logLine({}));

    await runCommand(
      ["diagnostics", "cli-errors", "--clear"],
      registerDiagnosticsCommands,
    );
    await runCommand(
      ["diagnostics", "cli-errors", "--json"],
      registerDiagnosticsCommands,
    );

    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log)).at(-1) ?? "{}")
        .total,
    ).toBe(0);
  });
});
