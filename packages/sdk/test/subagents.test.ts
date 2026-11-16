import { describe, expect, it, vi } from "vitest";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";

function transportReturning(body: unknown) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    Response.json(body),
  );
  return {
    fetch,
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      fetch,
      runtime: "node",
    }),
  };
}

describe("SDK subagents", () => {
  it("lists provider-neutral children", async () => {
    const child = {
      childRef: "child-1",
      parentToolCallId: "call-1",
      label: "CHILD_ALPHA",
      subagentType: "general-purpose",
      status: "running",
    };
    const { fetch, transport } = transportReturning([child]);
    const sdk = createBbSdk({ transport });
    await expect(
      sdk.threads.subagents.list({ threadId: "thr_1" }),
    ).resolves.toEqual([child]);
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "http://bb.test/api/v1/threads/thr_1/subagents",
    );
  });

  it("sends exact message text and cancellation to the requested child", async () => {
    const { fetch, transport } = transportReturning({
      childRef: "child-1",
      messageId: "message-1",
    });
    const sdk = createBbSdk({ transport });
    await expect(
      sdk.threads.subagents.tell({
        threadId: "thr_1",
        childRef: "child-1",
        text: "Hello 😀 مراجعة",
      }),
    ).resolves.toEqual({ childRef: "child-1", messageId: "message-1" });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ childRef: "child-1", text: "Hello 😀 مراجعة" }),
    });

    const cancel = transportReturning({
      childRef: "child-1",
      status: "cancelled",
    });
    const cancelSdk = createBbSdk({ transport: cancel.transport });
    await expect(
      cancelSdk.threads.subagents.cancel({
        threadId: "thr_1",
        childRef: "child-1",
      }),
    ).resolves.toEqual({ childRef: "child-1", status: "cancelled" });
    expect(cancel.fetch.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ childRef: "child-1" }),
    });
  });
});
