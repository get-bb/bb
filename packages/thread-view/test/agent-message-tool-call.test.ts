import { describe, expect, it } from "vitest";
import { parseAgentMessageToolCall } from "../src/agent-message-tool-call.js";

const ARGS = { threadId: "thr_wrkr234567", message: "Is it ready?" };

describe("parseAgentMessageToolCall", () => {
  it("reads the recipient and message of a bb thread message call", () => {
    expect(
      parseAgentMessageToolCall({
        status: "completed",
        toolName: "bb:bb_thread_message",
        toolArgs: ARGS,
      }),
    ).toEqual(ARGS);
  });

  it.each([
    [
      "a same-named tool on another server",
      "completed",
      "mcp:bb_thread_message",
      ARGS,
    ],
    ["a failed call", "error", "bb:bb_thread_message", ARGS],
    [
      "a path-like recipient",
      "completed",
      "bb:bb_thread_message",
      { threadId: "../hosts/h/suspend#", message: "hi" },
    ],
    ["a call without arguments", "completed", "bb:bb_thread_message", null],
  ])("ignores %s", (_case, status, toolName, toolArgs) => {
    expect(
      parseAgentMessageToolCall({ status, toolName, toolArgs }),
    ).toBeNull();
  });
});
