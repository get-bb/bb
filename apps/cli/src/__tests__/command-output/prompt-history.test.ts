import { describe, expect, it, vi } from "vitest";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import { registerPromptHistoryCommands } from "../../commands/prompt-history.js";

describe("bb prompt-history command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerPromptHistoryCommands(program, () => "http://server");

  it("lists a page with the requested cursor and limit", async () => {
    const response = { entries: [], nextCursor: null };
    const list = vi.fn(async () => response);
    stubServerApi({ "v1.prompt-history.$get": list });

    await runCommand(
      ["prompt-history", "list", "--cursor", "next", "--limit", "25", "--json"],
      register,
    );

    expect(list).toHaveBeenCalledWith({
      query: { cursor: "next", limit: "25" },
    });
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(response, null, 2));
  });

  it("prints prompts as a table with the next page command", async () => {
    stubServerApi({
      "v1.prompt-history.$get": async () => ({
        entries: [
          {
            id: "phist_1",
            createdAt: Date.UTC(2026, 9, 1, 12),
            input: [
              { type: "text", text: "Fix the\nlogin flow", mentions: [] },
              { type: "localFile", path: "/tmp/spec.md", name: "spec.md" },
            ],
            projectId: "proj_1",
            threadId: "thr_1",
          },
        ],
        nextCursor: "abc",
      }),
    });

    await runCommand(["prompt-history", "list", "--limit", "1"], register);

    const output = collectLogLines(vi.mocked(console.log)).join("\n");
    expect(output).toContain(
      "2026-10-01T12:00:00.000Z  thr_1   Fix the login flow [file spec.md]",
    );
    expect(output).toContain(
      "Next page: bb prompt-history list --cursor abc --limit 1",
    );
  });
});
