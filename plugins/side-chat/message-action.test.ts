import { experimental_makePanelController } from "@get-bb/plugin-sdk/testing";
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

function panelStub() {
  return experimental_makePanelController({
    openTab: vi.fn(() => true),
  });
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
    const experimental_panel = panelStub();

    await app.messageActions[0]!.run({
      threadId: "thr_src",
      message,
      experimental_panel,
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
    expect(experimental_panel.openTab).toHaveBeenCalledWith({
      tab: {
        id: "side-chat",
        context: { kind: "thread" },
        availability: "action",
      },
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
    const experimental_panel = panelStub();
    const context = {
      threadId: "thr_src",
      message,
      experimental_panel,
      composer: null,
    };

    const first = app.messageActions[0]!.run(context);
    const second = app.messageActions[0]!.run(context);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveRpc();
    await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(experimental_panel.openTab).toHaveBeenCalledTimes(1);

    await app.messageActions[0]!.run(context);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("anchors on the selection when invoked from the selection menu", async () => {
    stubRpcFetch(() => ({ threadId: "thr_fork" }));
    const experimental_panel = panelStub();

    await app.messageActions[0]!.run({
      threadId: "thr_src",
      message,
      selectedText: "just this part",
      experimental_panel,
      composer: null,
    });

    expect(experimental_panel.openTab).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Side chat",
        params: expect.objectContaining({
          sourceMessageText: "just this part",
        }),
      }),
    );
  });
});
