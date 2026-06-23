import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  setupCommandOutputTestEnvironment,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread output command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("bb thread output requires a thread id or --self", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-output-context");
    const getOutput = vi.fn(async () => ({ output: "FINAL" }));
    stubServerApi({ "v1.threads.:id.output.$get": getOutput });

    await expect(runCommand(["thread", "output"], register)).rejects.toThrow(
      "process.exit:1",
    );

    expect(getOutput).not.toHaveBeenCalled();
    expect(collectLogLines(vi.mocked(console.error))).toContain(
      "Error: Missing thread ID. Pass <threadId> or use --self.",
    );
  });

  it("bb thread output --self resolves from BB_THREAD_ID", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-output-context");
    const getOutput = vi.fn(async () => ({ output: "FINAL" }));
    stubServerApi({ "v1.threads.:id.output.$get": getOutput });

    await runCommand(["thread", "output", "--self"], register);

    expect(getOutput).toHaveBeenCalledWith({
      param: { id: "thread-output-context" },
    });
    expect(collectLogLines(vi.mocked(console.error))).not.toContain(
      "Thread thread-output-context (from BB_THREAD_ID)",
    );
    expect(collectLogLines(vi.mocked(console.log))).toContain("FINAL");
  });

  it("bb thread output --json prints the raw output payload", async () => {
    const getOutput = vi.fn(async () => ({ output: "FINAL" }));
    stubServerApi({ "v1.threads.:id.output.$get": getOutput });

    await runCommand(
      ["thread", "output", "thread-json-output", "--json"],
      register,
    );

    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0])),
    ).toEqual({
      output: "FINAL",
    });
  });
});
