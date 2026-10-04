import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  type FakePluginHost,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";
import { TOOL_NAME } from "./tool-definition.js";

const VISIBLE_THREAD = {
  originKind: null,
  originPluginId: null,
  visibility: "visible",
};
const SIDE_CHAT = {
  originKind: "fork",
  originPluginId: "side-chat",
  visibility: "hidden",
};

function createHost(
  recipient: object = VISIBLE_THREAD,
  send: () => Promise<unknown> = async () => ({ ok: true, delivery: "sent" }),
  permissionModes: Record<string, string> = {},
): FakePluginHost {
  const host = createFakePluginHost({
    pluginId: "bb--agent-messages",
    sdk: {
      threads: {
        get: async () => recipient,
        send,
        defaultExecutionOptions: async ({ threadId }) => ({
          permissionMode: permissionModes[threadId] ?? "auto",
        }),
      },
    },
  });
  plugin(host.bb);
  return host;
}

function message(host: FakePluginHost, threadId: string) {
  return host.harness.callAgentTool(
    TOOL_NAME,
    { threadId, message: "Ready?" },
    { threadId: "thr_sender" },
  );
}

describe("bb_thread_message", () => {
  it("delivers the message as sent by the calling thread", async () => {
    const host = createHost();

    expect(await message(host, "thr_worker")).toBe("Delivered to thr_worker.");
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([
      [
        {
          threadId: "thr_worker",
          input: [{ type: "text", text: "Ready?", mentions: [] }],
          mode: "steer-if-active",
          senderThreadId: "thr_sender",
        },
      ],
    ]);
  });

  it.each([
    ["its own thread", "thr_sender", VISIBLE_THREAD],
    ["a side chat", "thr_sidechat", SIDE_CHAT],
  ])("refuses to message %s", async (_case, threadId, recipient) => {
    const host = createHost(recipient);

    expect(await message(host, threadId)).toMatchObject({ isError: true });
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("refuses a recipient with broader permissions than the sender", async () => {
    const host = createHost(VISIBLE_THREAD, undefined, {
      thr_sender: "accept-edits",
      thr_worker: "full",
    });

    expect(await message(host, "thr_worker")).toMatchObject({ isError: true });
    expect(host.harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it.each(["../hosts/host_x/suspend#", "./thr_sender", "thr_%2e%2e"])(
    "rejects the path-like thread id %s before any request",
    async (threadId) => {
      const host = createHost();

      await expect(message(host, threadId)).rejects.toThrow(
        /arguments are invalid/,
      );
      expect(host.harness.sdk.calls).toEqual([]);
    },
  );

  it("reports a failed delivery as an error", async () => {
    const host = createHost(VISIBLE_THREAD, async () => {
      throw new Error("Thread is archived");
    });

    expect(await message(host, "thr_worker")).toEqual({
      content: [
        {
          type: "text",
          text: "The message was not delivered: Thread is archived",
        },
      ],
      isError: true,
    });
  });
});
