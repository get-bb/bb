import { Command } from "commander";
import { describe, expect, it } from "vitest";
import {
  formatOptionList,
  formatUsageLine,
  hasHelpFlag,
  resolveInvocation,
  suggestCommand,
  suggestOption,
} from "../command-resolution.js";

function buildProgram(): Command {
  const program = new Command().name("bb");
  const thread = program.command("thread");
  thread.command("show [id]").aliases(["get"]).option("--json");
  thread.command("tell <id> [message]").option("--mode <mode>");
  thread.command("log [id]").option("--limit <count>").option("--json");
  thread
    .command("spawn")
    .option("--reasoning-level <level>")
    .option("--parent-thread <id>");
  const terminal = program.command("terminal");
  terminal
    .command("output <terminalId>")
    .option("--tail-bytes <n>")
    .option("--json");
  terminal.command("wait <terminalId>").option("--exit").option("--regex <p>");
  program.command("machine").command("list");
  program.command("provider").command("models [providerId]");
  return program;
}

function argv(...args: string[]): string[] {
  return ["node", "bb", ...args];
}

describe("resolveInvocation", () => {
  it("stops at the first operand a pure group does not know", () => {
    const invocation = resolveInvocation(
      buildProgram(),
      argv("thread", "message", "thr_1", "hello"),
    );
    expect(invocation.path).toEqual(["thread"]);
    expect(invocation.unknownSubcommand).toBe("message");
  });

  it("does not mistake a positional argument for an unknown subcommand", () => {
    const invocation = resolveInvocation(
      buildProgram(),
      argv("thread", "tell", "thr_1", "status"),
    );
    expect(invocation.path).toEqual(["thread", "tell"]);
    expect(invocation.unknownSubcommand).toBeNull();
  });

  it("skips the value of an option it knows so the value is not read as a subcommand", () => {
    const invocation = resolveInvocation(
      buildProgram(),
      argv("thread", "log", "--limit", "show", "thr_1"),
    );
    expect(invocation.path).toEqual(["thread", "log"]);
  });

  it("resolves an alias to the canonical command path", () => {
    const invocation = resolveInvocation(
      buildProgram(),
      argv("thread", "get", "thr_1"),
    );
    expect(invocation.path).toEqual(["thread", "show"]);
  });

  it("ignores everything after the option terminator", () => {
    expect(hasHelpFlag(argv("terminal", "create", "--", "ls", "--help"))).toBe(
      false,
    );
    expect(hasHelpFlag(argv("thread", "create", "-h"))).toBe(true);
  });
});

describe("suggestCommand", () => {
  const cases: Array<[string[], string | null]> = [
    [["thread", "message"], "bb thread tell"],
    [["thread", "timeline"], "bb thread log"],
    [["thread", "create"], "bb thread spawn"],
    [["thread", "shwo"], "bb thread show"],
    [["terminal", "read"], "bb terminal output"],
    [["host"], "bb machine"],
    [["models"], "bb provider models"],
    [["thread", "zzzzzz"], null],
    [["tasks"], null],
  ];
  it.each(cases)("suggests for %j", (args, expected) => {
    expect(
      suggestCommand(resolveInvocation(buildProgram(), argv(...args))),
    ).toBe(expected);
  });

  it("only suggests a synonym the group really has", () => {
    expect(
      suggestCommand(resolveInvocation(buildProgram(), argv("machine", "get"))),
    ).toBeNull();
  });
});

describe("suggestOption", () => {
  const program = buildProgram();
  const spawn = resolveInvocation(program, argv("thread", "spawn")).command;
  const output = resolveInvocation(program, argv("terminal", "output")).command;
  const wait = resolveInvocation(program, argv("terminal", "wait")).command;

  it("prefers a declared synonym over spelling distance", () => {
    expect(suggestOption(output, "--lines")).toBe("--tail-bytes");
    expect(suggestOption(wait, "--status")).toBe("--exit");
    expect(suggestOption(wait, "--pattern")).toBe("--regex");
  });

  it("finds the longer flag a guess is a prefix of", () => {
    expect(suggestOption(spawn, "--reasoning")).toBe("--reasoning-level");
    expect(suggestOption(spawn, "--parent=thr_1")).toBe("--parent-thread");
  });

  it("returns nothing when no flag is close", () => {
    expect(suggestOption(output, "--frobnicate")).toBeNull();
  });
});

describe("usage formatting", () => {
  it("prints the full command path and hides hidden options", () => {
    const program = buildProgram();
    const invocation = resolveInvocation(
      program,
      argv("terminal", "output", "term_1"),
    );
    invocation.command.addOption(
      new Command().createOption("--thread <id>").hideHelp(),
    );
    expect(formatUsageLine(invocation)).toBe(
      "Usage: bb terminal output [options] <terminalId>",
    );
    expect(formatOptionList(invocation.command)).toBe(
      "--tail-bytes <n>, --json",
    );
  });
});
