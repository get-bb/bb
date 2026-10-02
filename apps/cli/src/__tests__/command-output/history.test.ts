import { describe, expect, it, vi } from "vitest";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import {
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerHistoryCommands } from "../../commands/history.js";

describe("bb history command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerHistoryCommands(program, () => "http://server");

  it("lists a page with the requested cursor and limit", async () => {
    const response = { entries: [], nextCursor: null };
    const list = vi.fn(async () => response);
    stubServerApi({ "v1.prompt-history.$get": list });

    await runCommand(
      ["history", "list", "--cursor", "next", "--limit", "25", "--json"],
      register,
    );

    expect(list).toHaveBeenCalledWith({
      query: { cursor: "next", limit: "25" },
    });
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(response, null, 2));
  });
});
