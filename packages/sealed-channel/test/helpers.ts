import type { SealedServerSocket } from "../src/server.js";
import type { SealedSocket } from "../src/transport.js";

export interface WireCapture {
  clientToServer: Uint8Array[];
  serverToClient: Uint8Array[];
}

export interface SocketPair {
  client: SealedSocket;
  server: SealedServerSocket & {
    onMessage: ((data: Uint8Array) => void) | null;
    onClose: ((code: number, reason: string) => void) | null;
    open(): void;
  };
  wire: WireCapture;
}

export function createSocketPair(): SocketPair {
  const wire: WireCapture = { clientToServer: [], serverToClient: [] };
  let serverReady = 1;
  let closed = false;
  const client: SealedSocket = {
    send(data) {
      if (closed) throw new Error("socket closed");
      const copy = data.slice();
      wire.clientToServer.push(copy);
      queueMicrotask(() => server.onMessage?.(copy));
    },
    close(code = 1000, reason = "") {
      if (closed) return;
      closed = true;
      serverReady = 3;
      queueMicrotask(() => {
        server.onClose?.(code, reason);
        client.onClose?.(code, reason);
      });
    },
    onOpen: null,
    onMessage: null,
    onClose: null,
    onError: null,
  };
  const server = {
    send(data: Uint8Array) {
      if (closed) throw new Error("socket closed");
      const copy = data.slice();
      wire.serverToClient.push(copy);
      queueMicrotask(() => client.onMessage?.(copy));
    },
    close(code = 1000, reason = "") {
      if (closed) return;
      closed = true;
      serverReady = 3;
      queueMicrotask(() => {
        client.onClose?.(code, reason);
        server.onClose?.(code, reason);
      });
    },
    get readyState() {
      return serverReady;
    },
    onMessage: null as ((data: Uint8Array) => void) | null,
    onClose: null as ((code: number, reason: string) => void) | null,
    open() {
      queueMicrotask(() => client.onOpen?.());
    },
  };
  return { client, server, wire };
}

export function containsBytes(
  haystack: Uint8Array,
  needle: Uint8Array,
): boolean {
  outer: for (
    let index = 0;
    index + needle.length <= haystack.length;
    index += 1
  ) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

export function wireContains(wire: WireCapture, text: string): boolean {
  const needle = new TextEncoder().encode(text);
  return [...wire.clientToServer, ...wire.serverToClient].some((message) =>
    containsBytes(message, needle),
  );
}

export async function readAll(
  body: ReadableStream<Uint8Array> | Uint8Array | null,
): Promise<string> {
  if (body === null) return "";
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(out);
}
