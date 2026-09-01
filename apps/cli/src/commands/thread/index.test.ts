import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { loadThreadCommandRegistrar } from "./index.js";

async function registeredThreadCommandNames(
  commandName: string,
): Promise<string[]> {
  const program = new Command();
  const register = await loadThreadCommandRegistrar(commandName);
  register(program, () => "http://server");
  const thread = program.commands.find(
    (command) => command.name() === "thread",
  );
  if (thread === undefined) {
    throw new Error("The thread command was not registered.");
  }
  return thread.commands.map((command) => command.name());
}

describe("thread command lazy loading", () => {
  it("loads only the wait module for wait and wait-many", async () => {
    await expect(registeredThreadCommandNames("wait")).resolves.toEqual([
      "wait",
      "wait-many",
    ]);
    await expect(registeredThreadCommandNames("wait-many")).resolves.toEqual([
      "wait",
      "wait-many",
    ]);
  });

  it("loads only the show module for output", async () => {
    await expect(registeredThreadCommandNames("output")).resolves.toEqual([
      "show",
      "log",
      "output",
    ]);
  });
});
