import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread subagents command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("lists children in a provider-neutral table and JSON", async () => {
    const children = [
      {
        childRef: "child-1",
        parentToolCallId: "call-1",
        label: "CHILD_ALPHA",
        subagentType: "general-purpose",
        status: "running",
      },
    ];
    stubServerApi({
      "v1.threads.:id.subagents.$get": vi.fn(async () => children),
    });

    await runCommand(["thread", "subagents", "list", "thread-1"], register);
    expect(collectLogLines(vi.mocked(console.log)).join("\n")).toContain(
      "CHILD_ALPHA",
    );

    await runCommand(
      ["thread", "subagents", "list", "thread-1", "--json"],
      register,
    );
    expect(
      JSON.parse(String(vi.mocked(console.log).mock.calls.at(-1)?.[0])),
    ).toEqual(children);
  });

  it("sends exact Unicode message text and reports the accepted message id", async () => {
    const post = vi.fn(async () => ({
      childRef: "child-1",
      messageId: "message-1",
    }));
    stubServerApi({ "v1.threads.:id.subagents.tell.$post": post });
    const text = "Hello 😀 مراجعة";

    await runCommand(
      ["thread", "subagents", "tell", "child-1", text, "thread-1"],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      param: { id: "thread-1" },
      json: { childRef: "child-1", text },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Message message-1 accepted for subagent child-1",
    );
  });

  it("cancels only the requested child", async () => {
    const post = vi.fn(async () => ({
      childRef: "child-1",
      status: "cancelled",
    }));
    stubServerApi({ "v1.threads.:id.subagents.cancel.$post": post });

    await runCommand(
      ["thread", "subagents", "cancel", "child-1", "thread-1"],
      register,
    );

    expect(post).toHaveBeenCalledWith({
      param: { id: "thread-1" },
      json: { childRef: "child-1" },
    });
    expect(collectLogLines(vi.mocked(console.log))).toContain(
      "Subagent child-1 cancelled",
    );
  });
});
