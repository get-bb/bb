import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread pane command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("maximizes the current thread pane", async () => {
    vi.stubEnv("BB_THREAD_ID", "thr_current");
    const paneAction = vi.fn(async () => ({ delivered: 2 }));
    stubServerApi({ "v1.threads.:id.pane-action.$post": paneAction });

    await runCommand(["thread", "pane", "maximize"], register);

    expect(paneAction).toHaveBeenCalledWith({
      param: { id: "thr_current" },
      json: { action: "maximize" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread: thr_current",
      "Pane action: maximize",
      "Delivered: 2",
    ]);
  });

  it("targets an explicit thread and prints stable JSON", async () => {
    const paneAction = vi.fn(async () => ({ delivered: 1 }));
    stubServerApi({ "v1.threads.:id.pane-action.$post": paneAction });

    await runCommand(
      ["thread", "pane", "toggle", "thr_explicit", "--json"],
      register,
    );

    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      JSON.stringify(
        {
          threadId: "thr_explicit",
          action: "toggle",
          delivered: 1,
        },
        null,
        2,
      ),
    ]);
  });

  it.each(["spotlight", "clear-spotlight"] as const)(
    "sends the %s action for an explicit thread",
    async (action) => {
      const paneAction = vi.fn(async () => ({ delivered: 1 }));
      stubServerApi({ "v1.threads.:id.pane-action.$post": paneAction });

      await runCommand(["thread", "pane", action, "thr_explicit"], register);

      expect(paneAction).toHaveBeenCalledWith({
        param: { id: "thr_explicit" },
        json: { action },
      });
    },
  );

  it("rejects an unknown action before sending a request", async () => {
    const paneAction = vi.fn(async () => ({ delivered: 1 }));
    stubServerApi({ "v1.threads.:id.pane-action.$post": paneAction });

    await expect(
      runCommand(["thread", "pane", "expand", "thr_explicit"], register),
    ).rejects.toThrow();
    expect(paneAction).not.toHaveBeenCalled();
  });
});
