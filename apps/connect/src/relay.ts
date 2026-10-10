import {
  MAX_CHUNK_BYTES,
  decodeFrame,
  encodeFrame,
  type Frame,
} from "@bb/tunnel-contract";
import {
  HOP_HEADERS,
  RELAY_CONTENT_LENGTH_HEADER,
  RELAY_HAS_BODY_HEADER,
  RELAY_HEADER,
  RELAY_METHOD_HEADER,
} from "./protocol-headers.js";
import type { GateProgress } from "./gate-deadline.js";
import { relayedResponse } from "./response-encoding.js";
import { responseHeadTimeoutMs } from "./response-head-timeout.js";

const RELAY_DONE_CLOSE_CODE = 1000;
const RELAY_PLACEHOLDER_STREAM_ID = 0;
const NULL_BODY_STATUSES = new Set([204, 205, 304]);
const MAX_CLOSE_REASON_BYTES = 123;
const VISITOR_CANCELED_REASON = "visitor canceled response body";

export interface RelayStub {
  fetch(request: Request): Promise<Response>;
}

const workerHeldResponses = new WeakSet<Response>();

export function isWorkerHeldResponse(response: Response): boolean {
  return workerHeldResponses.has(response);
}

export function workerHeldResponsesEnabled(env: {
  WORKER_HELD_RESPONSES?: string;
}): boolean {
  return env.WORKER_HELD_RESPONSES?.trim() === "on";
}

function gateText(message: string, status: number): Response {
  return new Response(`bb connect: ${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function closeReason(reason: string): string {
  const encoder = new TextEncoder();
  let end = Math.min(reason.length, MAX_CLOSE_REASON_BYTES);
  while (
    end > 0 &&
    encoder.encode(reason.slice(0, end)).length > MAX_CLOSE_REASON_BYTES
  ) {
    end -= 1;
  }
  return reason.slice(0, end);
}

export function relayUpgradeRequest(request: Request): Request {
  const headers = new Headers(request.headers);
  const contentLength = headers.get("content-length");
  headers.delete("content-length");
  headers.delete(RELAY_CONTENT_LENGTH_HEADER);
  if (contentLength !== null) {
    headers.set(RELAY_CONTENT_LENGTH_HEADER, contentLength);
  }
  headers.set("upgrade", "websocket");
  headers.set(RELAY_HEADER, "1");
  headers.set(RELAY_METHOD_HEADER, request.method);
  headers.set(RELAY_HAS_BODY_HEADER, request.body === null ? "0" : "1");
  return new Request(request.url, { method: "GET", headers });
}

function sendFrame(socket: WebSocket, frame: Frame): boolean {
  try {
    socket.send(encodeFrame(frame));
    return true;
  } catch {
    return false;
  }
}

async function pumpRequestBody(
  body: ReadableStream<Uint8Array>,
  socket: WebSocket,
  progress: GateProgress,
): Promise<void> {
  const streamId = RELAY_PLACEHOLDER_STREAM_ID;
  try {
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (let offset = 0; offset < value.length; offset += MAX_CHUNK_BYTES) {
        const sent = sendFrame(socket, {
          type: "body-chunk",
          streamId,
          data: value.subarray(offset, offset + MAX_CHUNK_BYTES),
        });
        if (!sent) return;
      }
    }
    sendFrame(socket, { type: "body-end", streamId });
    progress.stage = "response-head";
  } catch {
    sendFrame(socket, {
      type: "close-stream",
      streamId,
      code: 1011,
      reason: "request body error",
    });
  }
}

function relayResponse(
  socket: WebSocket,
  request: Request,
  progress: GateProgress,
): Promise<Response> {
  return new Promise<Response>((resolve) => {
    let headSettled = false;
    let finished = false;
    let body: ReadableStreamDefaultController<Uint8Array> | null = null;

    const finish = (reason: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(headTimeout);
      try {
        socket.close(RELAY_DONE_CLOSE_CODE, closeReason(reason));
      } catch {}
    };
    const settleHead = (response: Response) => {
      headSettled = true;
      clearTimeout(headTimeout);
      resolve(response);
    };
    const fail = (status: number, message: string) => {
      if (finished) return;
      if (!headSettled) {
        settleHead(gateText(message, status));
      } else {
        try {
          body?.error(new Error(message));
        } catch {}
      }
      finish(message);
    };
    const headTimeoutMs = responseHeadTimeoutMs(
      request.method,
      new URL(request.url),
      request.headers,
    );
    const headTimeout = setTimeout(() => {
      fail(504, "timed out waiting for the tunnel client");
    }, headTimeoutMs);

    const onHead = (frame: Extract<Frame, { type: "resp-head" }>) => {
      if (headSettled) return;
      const headers = frame.headers.filter(
        ([name]) => !HOP_HEADERS.has(name.toLowerCase()),
      );
      if (NULL_BODY_STATUSES.has(frame.status)) {
        settleHead(new Response(null, { status: frame.status, headers }));
        finish("done");
        return;
      }
      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller;
        },
        cancel() {
          finish(VISITOR_CANCELED_REASON);
        },
      });
      try {
        const response = relayedResponse(readable, frame.status, headers);
        workerHeldResponses.add(response);
        settleHead(response);
      } catch {
        body = null;
        fail(502, `unrelayable origin response (status ${frame.status})`);
      }
    };

    socket.addEventListener("message", (event) => {
      if (finished || typeof event.data === "string") return;
      let frame: Frame;
      try {
        frame = decodeFrame(event.data);
      } catch {
        fail(502, "malformed tunnel frame");
        return;
      }
      switch (frame.type) {
        case "resp-head":
          onHead(frame);
          return;
        case "body-chunk":
          try {
            body?.enqueue(frame.data);
          } catch {}
          return;
        case "body-end":
          if (!headSettled) {
            fail(502, "tunnel client ended the response before its head");
            return;
          }
          try {
            body?.close();
          } catch {}
          finish("done");
          return;
        case "close-stream":
          fail(502, `tunnel client aborted: ${frame.reason}`);
          return;
        default:
          return;
      }
    });
    socket.addEventListener("close", (event) => {
      fail(502, event.reason || "tunnel disconnected mid-request");
    });
    socket.addEventListener("error", () => {
      fail(502, "tunnel disconnected mid-request");
    });

    if (request.body === null) {
      progress.stage = "response-head";
    } else {
      progress.stage = "request-body";
      void pumpRequestBody(request.body, socket, progress);
    }
  });
}

export async function fetchThroughRelay(
  stub: RelayStub,
  request: Request,
  progress: GateProgress,
): Promise<Response | null> {
  const upgraded = await stub.fetch(relayUpgradeRequest(request));
  const socket = upgraded.webSocket;
  if (socket == null) return upgraded;
  socket.binaryType = "arraybuffer";
  socket.accept();
  if (upgraded.headers.get(RELAY_HEADER) !== "1") {
    try {
      socket.close(RELAY_DONE_CLOSE_CODE, "relay unsupported");
    } catch {}
    return null;
  }
  return relayResponse(socket, request, progress);
}
