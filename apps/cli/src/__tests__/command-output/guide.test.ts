import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
} from "../helpers/command-output-harness.js";
import { registerGuideCommand } from "../../commands/guide.js";

describe("bb guide command output", () => {
  setupCommandOutputTestEnvironment();

  it("bb guide unknown chapter lists available chapters", async () => {
    await expect(
      runCommand(["guide", "missing"], registerGuideCommand),
    ).rejects.toThrow("process.exit:1");

    const errorOutput = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(errorOutput).toContain("Unknown guide chapter 'missing'");
    expect(errorOutput).toContain(
      "Available: threads, environments, agent-configuration, providers, projects, machines, terminals, browser, customization, plugins, automations, json.",
    );
  });

  it("bb guide accepts the singular and synonym names agents guess", async () => {
    await runCommand(["guide", "thread", "--json"], registerGuideCommand);
    await runCommand(["guide", "host", "--json"], registerGuideCommand);

    const chapters = collectLogLines(vi.mocked(console.log)).map(
      (line) => JSON.parse(line).chapter,
    );
    expect(chapters).toEqual(["threads", "machines"]);
  });

  it("bb guide commands <group> lists each command once with its options and aliases", async () => {
    await runCommand(["guide", "commands", "terminal"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain(
      "bb terminal output|read <terminalId>  [--since-seq <n>] [--tail-bytes <n>] [--limit-chunks <n>] [--json]\n    Print terminal output",
    );
    expect(output).not.toContain("bb thread ");
  }, 30_000);

  it("bb guide commands without a group leaves options out and says how to get them", async () => {
    await runCommand(["guide", "commands"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("bb thread tell|message|send <id> [message]\n");
    expect(output).toContain("bb guide commands <group>");
  }, 30_000);

  it("bb guide commands rejects a group that does not exist", async () => {
    await expect(
      runCommand(["guide", "commands", "nope"], registerGuideCommand),
    ).rejects.toThrow("process.exit:1");

    const errorOutput = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(errorOutput).toContain("Unknown command group 'nope'.");
    expect(errorOutput).toContain("Command groups: browser, status");
  }, 30_000);

  it("bb guide terminals documents explicit scopes and ID-only mutations", async () => {
    await runCommand(["guide", "terminals"], registerGuideCommand);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain("exactly one explicit scope");
    expect(output).toContain("bb terminal list --thread <thread-id>");
    expect(output).toContain("bb terminal rename <terminal-id> <title>");
  });
});
