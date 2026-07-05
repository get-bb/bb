// bb connect tunnel wire protocol (spike v0 — see plans/bb-connect-v1.md M0/M2).
//
// Every binary WebSocket message on a tunnel connection is exactly one frame:
//
//   byte 0        frame type
//   bytes 1..4    stream id (u32 big-endian)
//   bytes 5..     payload (JSON metadata, raw bytes, or empty — per type)
//
// Text messages are reserved for heartbeats (HEARTBEAT_* constants) so the
// relay can answer them with Durable Object auto-response without waking.
//
// Streams are opened only by the relay side (visitor-originated); the tunnel
// client never allocates stream ids. M2 hardening (backpressure credits,
// account tags, reconnect-resume) extends this format — new frame types get
// new type bytes, existing layouts stay stable.

export const PROTOCOL_VERSION = 0;

/** Heartbeat text messages (eligible for DO auto-response). */
export const HEARTBEAT_REQUEST = "bbt:hb";
export const HEARTBEAT_RESPONSE = "bbt:hb-ack";

/** Body chunks larger than this must be split by the sender. */
export const MAX_CHUNK_BYTES = 1024 * 1024;

const FRAME_TYPE = {
  openHttp: 1,
  bodyChunk: 2,
  bodyEnd: 3,
  respHead: 4,
  openWs: 5,
  wsOpenAck: 6,
  wsData: 7,
  closeStream: 8,
} as const;

export type HeaderPair = [name: string, value: string];

/** Relay → client: a visitor HTTP request opened on `streamId`. */
export interface OpenHttpFrame {
  type: "open-http";
  streamId: number;
  method: string;
  /** Path + query, e.g. "/api/v1/threads?limit=5". */
  path: string;
  headers: HeaderPair[];
  /** When true, body-chunk/body-end frames for this stream follow. */
  hasBody: boolean;
}

/** Either direction: a piece of an HTTP request or response body. */
export interface BodyChunkFrame {
  type: "body-chunk";
  streamId: number;
  data: Uint8Array;
}

/** Either direction: the body for `streamId` is complete. */
export interface BodyEndFrame {
  type: "body-end";
  streamId: number;
}

/** Client → relay: response status + headers for an open-http stream. */
export interface RespHeadFrame {
  type: "resp-head";
  streamId: number;
  status: number;
  headers: HeaderPair[];
}

/** Relay → client: a visitor WebSocket upgrade opened on `streamId`. */
export interface OpenWsFrame {
  type: "open-ws";
  streamId: number;
  path: string;
  headers: HeaderPair[];
  protocols: string[];
}

/** Client → relay: the origin accepted the WebSocket. */
export interface WsOpenAckFrame {
  type: "ws-open-ack";
  streamId: number;
  /** Negotiated subprotocol; null when none was negotiated. */
  protocol: string | null;
}

/** Either direction: one WebSocket message on an open-ws stream. */
export interface WsDataFrame {
  type: "ws-data";
  streamId: number;
  isBinary: boolean;
  data: Uint8Array;
}

/**
 * Either direction: terminate a stream. For open-ws streams `code`/`reason`
 * mirror the WebSocket close; for open-http streams they are advisory and a
 * receiver should abort the request/response.
 */
export interface CloseStreamFrame {
  type: "close-stream";
  streamId: number;
  code: number;
  reason: string;
}

export type Frame =
  | OpenHttpFrame
  | BodyChunkFrame
  | BodyEndFrame
  | RespHeadFrame
  | OpenWsFrame
  | WsOpenAckFrame
  | WsDataFrame
  | CloseStreamFrame;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function withHeader(type: number, streamId: number, payload: Uint8Array): Uint8Array {
  if (!Number.isInteger(streamId) || streamId < 0 || streamId > 0xffffffff) {
    throw new Error(`tunnel-contract: stream id out of range: ${streamId}`);
  }
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, streamId);
  out.set(payload, 5);
  return out;
}

function jsonPayload(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

export function encodeFrame(frame: Frame): Uint8Array {
  switch (frame.type) {
    case "open-http":
      return withHeader(
        FRAME_TYPE.openHttp,
        frame.streamId,
        jsonPayload({
          method: frame.method,
          path: frame.path,
          headers: frame.headers,
          hasBody: frame.hasBody,
        }),
      );
    case "body-chunk": {
      if (frame.data.length > MAX_CHUNK_BYTES) {
        throw new Error(
          `tunnel-contract: body chunk of ${frame.data.length} bytes exceeds MAX_CHUNK_BYTES`,
        );
      }
      return withHeader(FRAME_TYPE.bodyChunk, frame.streamId, frame.data);
    }
    case "body-end":
      return withHeader(FRAME_TYPE.bodyEnd, frame.streamId, new Uint8Array(0));
    case "resp-head":
      return withHeader(
        FRAME_TYPE.respHead,
        frame.streamId,
        jsonPayload({ status: frame.status, headers: frame.headers }),
      );
    case "open-ws":
      return withHeader(
        FRAME_TYPE.openWs,
        frame.streamId,
        jsonPayload({ path: frame.path, headers: frame.headers, protocols: frame.protocols }),
      );
    case "ws-open-ack":
      return withHeader(
        FRAME_TYPE.wsOpenAck,
        frame.streamId,
        jsonPayload({ protocol: frame.protocol }),
      );
    case "ws-data": {
      const payload = new Uint8Array(1 + frame.data.length);
      payload[0] = frame.isBinary ? 1 : 0;
      payload.set(frame.data, 1);
      return withHeader(FRAME_TYPE.wsData, frame.streamId, payload);
    }
    case "close-stream":
      return withHeader(
        FRAME_TYPE.closeStream,
        frame.streamId,
        jsonPayload({ code: frame.code, reason: frame.reason }),
      );
  }
}

function parseJson<T>(payload: Uint8Array, what: string): T {
  try {
    return JSON.parse(decoder.decode(payload)) as T;
  } catch {
    throw new Error(`tunnel-contract: malformed ${what} frame payload`);
  }
}

export function decodeFrame(message: ArrayBuffer | Uint8Array): Frame {
  const buf = message instanceof Uint8Array ? message : new Uint8Array(message);
  if (buf.length < 5) {
    throw new Error(`tunnel-contract: frame too short (${buf.length} bytes)`);
  }
  const type = buf[0];
  const streamId = new DataView(buf.buffer, buf.byteOffset).getUint32(1);
  const payload = buf.subarray(5);
  switch (type) {
    case FRAME_TYPE.openHttp: {
      const meta = parseJson<{
        method: string;
        path: string;
        headers: HeaderPair[];
        hasBody: boolean;
      }>(payload, "open-http");
      return { type: "open-http", streamId, ...meta };
    }
    case FRAME_TYPE.bodyChunk:
      return { type: "body-chunk", streamId, data: payload };
    case FRAME_TYPE.bodyEnd:
      return { type: "body-end", streamId };
    case FRAME_TYPE.respHead: {
      const meta = parseJson<{ status: number; headers: HeaderPair[] }>(payload, "resp-head");
      return { type: "resp-head", streamId, ...meta };
    }
    case FRAME_TYPE.openWs: {
      const meta = parseJson<{ path: string; headers: HeaderPair[]; protocols: string[] }>(
        payload,
        "open-ws",
      );
      return { type: "open-ws", streamId, ...meta };
    }
    case FRAME_TYPE.wsOpenAck: {
      const meta = parseJson<{ protocol: string | null }>(payload, "ws-open-ack");
      return { type: "ws-open-ack", streamId, protocol: meta.protocol };
    }
    case FRAME_TYPE.wsData: {
      if (payload.length < 1) {
        throw new Error("tunnel-contract: ws-data frame missing binary flag");
      }
      return { type: "ws-data", streamId, isBinary: payload[0] === 1, data: payload.subarray(1) };
    }
    case FRAME_TYPE.closeStream: {
      const meta = parseJson<{ code: number; reason: string }>(payload, "close-stream");
      return { type: "close-stream", streamId, ...meta };
    }
    default:
      throw new Error(`tunnel-contract: unknown frame type ${type}`);
  }
}

/** Split an arbitrarily large buffer into MAX_CHUNK_BYTES-sized body chunks. */
export function* chunkBody(streamId: number, data: Uint8Array): Generator<BodyChunkFrame> {
  for (let offset = 0; offset < data.length; offset += MAX_CHUNK_BYTES) {
    yield {
      type: "body-chunk",
      streamId,
      data: data.subarray(offset, Math.min(offset + MAX_CHUNK_BYTES, data.length)),
    };
  }
}
