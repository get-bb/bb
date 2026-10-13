import { describe, expect, it } from "vitest";
import type { CliRunner } from "./cli-runner.js";
import {
  CommandIndexUnavailableError,
  createCommandIndexLoader,
  searchCommands,
  parseCommandIndex,
} from "./command-index.js";

const INDEX_JSON = JSON.stringify({
  chapter: "commands",
  commands: [
    {
      path: "thread list",
      aliases: [],
      arguments: "",
      description: "List threads",
      options: ["--json"],
    },
    {
      path: "thread tell",
      aliases: ["message"],
      arguments: "<id>",
      description: "Send a message to a thread",
      options: ["--json"],
    },
  ],
});

function fakeRunner(outputs: { exitCode: number; stdout: string }[]) {
  let calls = 0;
  const run: CliRunner = async () => {
    const output = outputs[Math.min(calls, outputs.length - 1)];
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      exitCode: output?.exitCode ?? 1,
      stdout: output?.stdout ?? "",
      stderr: "",
      timedOut: false,
      truncated: false,
    };
  };
  return { run, calls: () => calls };
}

describe("createCommandIndexLoader", () => {
  it("runs the CLI once for concurrent and repeated loads, then again after the cache expires", async () => {
    let now = 1_000;
    const runner = fakeRunner([{ exitCode: 0, stdout: INDEX_JSON }]);
    const load = createCommandIndexLoader(runner.run, () => now);
    const [first, second] = await Promise.all([load(), load()]);
    expect(first).toBe(second);
    expect(first.paths.has("thread tell")).toBe(true);
    await load();
    expect(runner.calls()).toBe(1);
    now += 5 * 60 * 1000 + 1;
    await load();
    expect(runner.calls()).toBe(2);
  });

  it("fails clearly on an old CLI and retries on the next load", async () => {
    const runner = fakeRunner([
      { exitCode: 0, stdout: '{"chapter":"overview"}' },
      { exitCode: 1, stdout: "" },
      { exitCode: 0, stdout: "not json" },
      { exitCode: 0, stdout: INDEX_JSON },
    ]);
    const load = createCommandIndexLoader(runner.run);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(load()).rejects.toBeInstanceOf(CommandIndexUnavailableError);
    }
    expect((await load()).commands).toHaveLength(2);
  });
});

describe("searchCommands", () => {
  const index = parseCommandIndex(INDEX_JSON);

  it("ranks by the words in the query and respects the limit", () => {
    expect(searchCommands(index, "send message", 5)[0]?.usage).toBe(
      "bb thread tell <id>",
    );
    expect(searchCommands(index, "thread", 1)).toHaveLength(1);
    expect(searchCommands(index, "nothing matches this", 5)).toEqual([]);
  });

  it("lists commands for an empty query", () => {
    expect(searchCommands(index, "", 10).map((match) => match.usage)).toEqual([
      "bb thread list",
      "bb thread tell <id>",
    ]);
  });
});
