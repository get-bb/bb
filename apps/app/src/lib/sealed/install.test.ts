// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SealedWebSocketStream } from "@bb/sealed-channel";
import { installSealedTransport, type SealedTransportSource } from "./install";

class FakeStream implements SealedWebSocketStream {
  readyState = 0;
  protocol = "";
  onOpen: (() => void) | null = null;
  onMessage: ((data: string | Uint8Array) => void) | null = null;
  onClose: ((code: number, reason: string) => void) | null = null;
  onError: ((error: Error) => void) | null = null;
  readonly sent: Array<string | Uint8Array> = [];
  readonly closes: Array<[number, string]> = [];
  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }
  close(code = 1000, reason = ""): void {
    this.closes.push([code, reason]);
    this.readyState = 3;
    this.onClose?.(code, reason);
  }
  open(protocol = "bb"): void {
    this.readyState = 1;
    this.protocol = protocol;
    this.onOpen?.();
  }
}

function createSource(origin: string) {
  const streams: Array<{
    path: string;
    protocols: string[];
    stream: FakeStream;
  }> = [];
  const fetches: Array<{
    input: RequestInfo | URL;
    init: RequestInit | undefined;
  }> = [];
  const source: SealedTransportSource = {
    origin,
    async fetch(input, init) {
      fetches.push({ input, init });
      return new Response("sealed", { status: 200 });
    },
    async openWebSocket(path, protocols) {
      const stream = new FakeStream();
      streams.push({ path, protocols, stream });
      return stream;
    },
  };
  return { source, streams, fetches };
}

describe("installSealedTransport", () => {
  const origin = window.location.origin;
  const originalFetch = globalThis.fetch;
  const OriginalWebSocket = globalThis.WebSocket;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = OriginalWebSocket;
  });

  it("routes same-origin fetches through the sealed connection and leaves other origins alone", async () => {
    const original = vi.fn(async () => new Response("clear"));
    globalThis.fetch = original as unknown as typeof fetch;
    const { source, fetches } = createSource(origin);
    installSealedTransport(source);

    const sealed = await fetch("/api/v1/threads", { method: "POST" });
    expect(await sealed.text()).toBe("sealed");
    expect(fetches).toHaveLength(1);
    expect(fetches[0]?.init).toEqual({ method: "POST" });

    const other = await fetch("https://example.com/x");
    expect(await other.text()).toBe("clear");
    expect(original).toHaveBeenCalledTimes(1);

    const viaRequest = await fetch(
      new Request(`${origin}/api/v1/system/config`),
    );
    expect(await viaRequest.text()).toBe("sealed");
  });

  it("replaces same-origin WebSockets with sealed streams that behave like WebSocket", async () => {
    const OriginalWebSocket = globalThis.WebSocket;
    const { source, streams } = createSource(origin);
    installSealedTransport(source);
    expect(globalThis.WebSocket).not.toBe(OriginalWebSocket);

    const socket = new WebSocket(`${origin.replace(/^http/u, "ws")}/ws?x=1`, [
      "bb",
    ]);
    expect(socket.readyState).toBe(WebSocket.CONNECTING);
    const events: string[] = [];
    socket.addEventListener("open", () => events.push("open"));
    socket.onmessage = (event) => events.push(`message:${String(event.data)}`);
    socket.addEventListener("close", (event) =>
      events.push(`close:${(event as CloseEvent).code}`),
    );
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    expect(streams[0]).toMatchObject({ path: "/ws?x=1", protocols: ["bb"] });
    const stream = streams[0]!.stream;
    stream.open("bb");
    expect(socket.readyState).toBe(WebSocket.OPEN);
    expect(socket.protocol).toBe("bb");
    socket.send(JSON.stringify({ type: "ping" }));
    socket.send(new Uint8Array([1, 2]));
    expect(stream.sent).toEqual([
      JSON.stringify({ type: "ping" }),
      new Uint8Array([1, 2]),
    ]);
    stream.onMessage?.("hello");
    socket.binaryType = "arraybuffer";
    stream.onMessage?.(new Uint8Array([9]));
    socket.close(4000, "done");
    expect(stream.closes).toEqual([[4000, "done"]]);
    expect(socket.readyState).toBe(WebSocket.CLOSED);
    expect(events).toEqual([
      "open",
      "message:hello",
      "message:[object ArrayBuffer]",
      "close:4000",
    ]);
  });

  it("closes a stream that finishes connecting after the page already closed the socket", async () => {
    const { source, streams } = createSource(origin);
    installSealedTransport(source);
    const socket = new WebSocket(`${origin.replace(/^http/u, "ws")}/ws`);
    socket.close();
    await vi.waitFor(() => expect(streams).toHaveLength(1));
    await vi.waitFor(() => expect(streams[0]!.stream.closes).toHaveLength(1));
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  });
});
