import { Command, CommanderError } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loggableToken, summarizeCommanderError } from "../commander-errors.js";

function buildProgram(): Command {
  const program = new Command().name("bb");
  const thread = program.command("thread");
  thread
    .command("spawn")
    .requiredOption("--project <id>", "Project ID")
    .option("--reasoning-level <level>");
  thread.command("show [id]");
  program.command("browser").command("instances").requiredOption("--host <id>");
  program.command("terminal").command("output <terminalId>");
  return program;
}

async function summarize(
  args: string[],
  code: string,
  message: string,
  hostId: string | null = null,
) {
  return summarizeCommanderError({
    argv: ["node", "bb", ...args],
    error: new CommanderError(1, code, message),
    program: buildProgram(),
    resolveHostId: async () => hostId,
  });
}

describe("summarizeCommanderError", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fills in the current project for a missing --project", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj_abc");
    const summary = await summarize(
      ["thread", "spawn", "--prompt", "hi"],
      "commander.missingMandatoryOptionValue",
      "error: required option '--project <id>' not specified",
    );
    expect(summary.code).toBe("missing_required");
    expect(summary.message).toBe(
      "required option '--project <id>' not specified",
    );
    expect(summary.hintLines).toEqual([
      "This thread's project is proj_abc; add --project proj_abc.",
      "Usage: bb thread spawn [options]",
    ]);
  });

  it("points at the listing command when there is no current project", async () => {
    vi.stubEnv("BB_PROJECT_ID", "");
    const summary = await summarize(
      ["thread", "spawn"],
      "commander.missingMandatoryOptionValue",
      "error: required option '--project <id>' not specified",
    );
    expect(summary.hintLines[0]).toBe(
      "List project IDs with `bb project list`.",
    );
  });

  it("never echoes a context ID that is not a plain identifier", async () => {
    vi.stubEnv("BB_PROJECT_ID", "proj_x; rm -rf /");
    const summary = await summarize(
      ["thread", "spawn"],
      "commander.missingMandatoryOptionValue",
      "error: required option '--project <id>' not specified",
    );
    expect(summary.hintLines.join("\n")).not.toContain("rm -rf");
  });

  it("fills in the machine this thread runs on for a missing --host", async () => {
    const summary = await summarize(
      ["browser", "instances"],
      "commander.missingMandatoryOptionValue",
      "error: required option '--host <id>' not specified",
      "host_abc",
    );
    expect(summary.hintLines[0]).toBe(
      "This thread runs on host_abc; add --host host_abc.",
    );
  });

  it("falls back to the machine list when the host cannot be resolved", async () => {
    const summary = await summarize(
      ["browser", "instances"],
      "commander.missingMandatoryOptionValue",
      "error: required option '--host <id>' not specified",
    );
    expect(summary.hintLines[0]).toBe(
      "List machine IDs with `bb machine list`.",
    );
  });

  it("names the closest option and lists the valid ones", async () => {
    const summary = await summarize(
      ["thread", "spawn", "--reasoning", "high"],
      "commander.unknownOption",
      "error: unknown option '--reasoning'",
    );
    expect(summary.code).toBe("unknown_option");
    expect(summary.token).toBe("--reasoning");
    expect(summary.hintLines).toEqual([
      "Did you mean --reasoning-level?",
      "Usage: bb thread spawn [options]",
      "Options: --project <id>, --reasoning-level <level>",
    ]);
  });

  it("suggests the real verb and lists the group's commands", async () => {
    const summary = await summarize(
      ["thread", "info", "thr_1"],
      "commander.unknownCommand",
      "error: unknown command 'info'",
    );
    expect(summary.hintLines).toEqual([
      "Did you mean: bb thread show?",
      "Commands: spawn, show",
    ]);
  });

  it("says a top-level unknown command may belong to a plugin that is not enabled", async () => {
    const summary = await summarize(
      ["memory", "add"],
      "commander.unknownCommand",
      "error: unknown command 'memory'",
    );
    expect(summary.hintLines).toEqual([
      "Commands: thread, browser, terminal",
      "Plugins add commands only while they are installed and enabled. If 'memory' is a plugin command, check `bb plugin list`.",
    ]);
  });

  it("tells a caller with a terminal ID missing how to list this thread's terminals", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr_abc");
    const summary = await summarize(
      ["terminal", "output"],
      "commander.missingArgument",
      "error: missing required argument 'terminalId'",
    );
    expect(summary.hintLines).toEqual([
      "List this thread's terminal IDs with `bb terminal list --thread thr_abc`.",
      "Usage: bb terminal output [options] <terminalId>",
    ]);
  });
});

describe("loggableToken", () => {
  const cases: Array<[string, string | null, string | null]> = [
    ["commander.unknownOption", "--api-token=SYNTHETIC_SECRET", "--api-token"],
    ["commander.unknownOption", "--lines", "--lines"],
    ["commander.unknownOption", "-x", "-x"],
    ["commander.unknownOption", "--Bearer-abc123", null],
    ["commander.unknownOption", "--key9", null],
    ["commander.unknownCommand", "get", "get"],
    ["commander.unknownCommand", "a secret message", null],
    ["commander.unknownCommand", "sk-live-51H8", null],
    ["commander.unknownCommand", "Hunter2", null],
    ["commander.invalidArgument", "--limit <count>", null],
    ["commander.missingArgument", "terminalId", null],
    ["commander.unknownCommand", null, null],
  ];
  it.each(cases)("%s %j -> %j", (code, token, expected) => {
    expect(loggableToken(code, token)).toBe(expected);
  });
});
