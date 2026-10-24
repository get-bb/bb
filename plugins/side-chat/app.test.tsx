// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(cleanup);

describe("SideChatPanel", () => {
  const params = {
    threadId: "thr_fork",
    sourceThreadId: "thr_src",
    sourceMessageText: "the **anchor** message",
    sourceSeqEnd: 7,
  };

  it("send-to-main sends the message text to the source thread, queueing it if that thread is busy", async () => {
    const send = vi.fn(async () => ({ ok: true, delivery: "sent" }) as never);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_src", params },
      { rpc: {}, sdk: { threads: { send } } },
    );

    fireEvent.click(slot.getByTestId("bb-thread-chat-action-send-to-main"));

    await waitFor(() => {
      expect(send).toHaveBeenCalledWith({
        threadId: "thr_src",
        mode: "queue-if-active",
        input: [{ type: "text", text: "test message text", mentions: [] }],
        senderThreadId: "thr_fork",
      });
    });
    expect(slot.rpcCalls).toEqual([]);
  });

  it("reports a missing thread reference for malformed params", () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_src", params: { bogus: true } },
      { rpc: {} },
    );
    expect(slot.getByRole("alert").textContent).toContain(
      "missing its thread reference",
    );
  });
});
