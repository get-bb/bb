import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));
const { parsePanelParams } = await import("./app");

afterEach(() => {
  vi.unstubAllGlobals();
});

function rpcResponse(result: unknown): Response {
  return new Response(JSON.stringify({ ok: true, result }), { status: 200 });
}

function stubRpcFetch(handler: (method: string, input: unknown) => unknown) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(url).split("/rpc/")[1] ?? "";
    const input: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    return rpcResponse(handler(decodeURIComponent(method), input));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const message = {
  id: "msg_1",
  threadId: "thr_src",
  role: "assistant" as const,
  text: "whole message text",
  sourceSeqEnd: 42,
  experimental_messageSeq: 42,
};

describe("parsePanelParams", () => {
  it("narrows persisted params and rejects malformed values", () => {
    expect(
      parsePanelParams({
        threadId: "thr_fork",
        sourceThreadId: "thr_src",
        sourceMessageText: "anchor",
        sourceSeqEnd: 5,
      }),
    ).toEqual({
      threadId: "thr_fork",
      sourceThreadId: "thr_src",
      sourceMessageText: "anchor",
      sourceSeqEnd: 5,
    });
    expect(
      parsePanelParams({ threadId: "thr_fork", sourceThreadId: "thr_src" }),
    ).toEqual({
      threadId: "thr_fork",
      sourceThreadId: "thr_src",
      sourceMessageText: "",
      sourceSeqEnd: null,
    });
    expect(parsePanelParams(null)).toBeNull();
    expect(parsePanelParams({ threadId: "thr_fork" })).toBeNull();
  });
});

describe("reply-in-side-chat message action", () => {
  it("creates the fork then opens the panel tab pointing at it", async () => {
    const inputs: unknown[] = [];
    const fetchMock = stubRpcFetch((method, input) => {
      expect(method).toBe("createSideChat");
      inputs.push(input);
      return { threadId: "thr_fork" };
    });
    const openPanel = vi.fn(() => true);

    await app.messageActions[0]!.run({
      threadId: "thr_src",
      message,
      openPanel,
      composer: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/side-chat/rpc/createSideChat",
      expect.objectContaining({ method: "POST" }),
    );
    expect(inputs).toEqual([
      {
        sourceThreadId: "thr_src",
        sourceSeqEnd: 42,
        anchorText: "whole message text",
      },
    ]);
    expect(openPanel).toHaveBeenCalledWith({
      actionId: "side-chat",
      title: "Side chat",
      params: {
        threadId: "thr_fork",
        sourceThreadId: "thr_src",
        sourceMessageText: "whole message text",
        sourceSeqEnd: 42,
      },
    });
  });

  it("single-flights a double invocation while the first fork RPC is pending", async () => {
    let resolveRpc!: () => void;
    const deferred = new Promise<void>((resolve) => {
      resolveRpc = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await deferred;
      return rpcResponse({ threadId: "thr_fork" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const openPanel = vi.fn(() => true);
    const context = {
      threadId: "thr_src",
      message,
      openPanel,
      composer: null,
    };

    const first = app.messageActions[0]!.run(context);
    const second = app.messageActions[0]!.run(context);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRpc();
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(openPanel).toHaveBeenCalledTimes(1);

    await app.messageActions[0]!.run(context);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("anchors on the selection when invoked from the selection menu", async () => {
    stubRpcFetch(() => ({ threadId: "thr_fork" }));
    const openPanel = vi.fn(() => true);

    await app.messageActions[0]!.run({
      threadId: "thr_src",
      message,
      selectedText: "just this part",
      openPanel,
      composer: null,
    });

    expect(openPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Side chat",
        params: expect.objectContaining({
          sourceMessageText: "just this part",
        }),
      }),
    );
  });
});
