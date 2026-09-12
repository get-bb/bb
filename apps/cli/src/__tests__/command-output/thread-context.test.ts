import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread context", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("prints provider-defined categories and marks deferred counts separately", async () => {
    const get = vi.fn(async () => ({
      usage: {
        usedTokens: 100,
        modelContextWindow: 1_000,
        estimated: true,
        snapshot: {
          capturedAt: "2026-09-11T12:00:00.000Z",
          categories: [
            {
              id: "custom",
              label: "Custom category",
              kind: "used",
              tokens: 100,
              entries: [{ id: "file", label: "project.md", tokens: 100 }],
            },
            {
              id: "deferred",
              label: "Future tools",
              kind: "deferred",
              tokens: 500,
              entries: [],
            },
          ],
        },
      },
    }));
    stubServerApi({ "v1.threads.:id.context.$get": get });
    await runCommand(["thread", "context", "thread-1"], register);
    expect(get).toHaveBeenCalledWith({ param: { id: "thread-1" } });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Estimated context: 100 / 1,000 tokens",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Custom category: 100",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "  project.md: 100",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Future tools (deferred): 500",
    );
  });

  it("returns explicit missing usage in JSON", async () => {
    stubServerApi({
      "v1.threads.:id.context.$get": vi.fn(async () => ({ usage: null })),
    });
    await runCommand(["thread", "context", "thread-1", "--json"], register);
    expect(
      JSON.parse(collectLogLines(vi.mocked(console.log)).join("\n")),
    ).toEqual({ usage: null });
  });
});
