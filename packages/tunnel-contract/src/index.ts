export const PROTOCOL_VERSION = 1;

export const TUNNEL_PROTOCOL_QUERY_PARAM = "v";

export const HEARTBEAT_REQUEST = "bbt:hb";
export const HEARTBEAT_RESPONSE = "bbt:hb-ack";
export const TUNNEL_REPLACED_CLOSE_REASON =
  "replaced by a new tunnel connection";

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
  openReaderHttp: 9,
} as const;

export const READER_CONTEXT_CAPABILITY = "reader-context-v1";
export const READER_CONTEXT_CAPABILITY_QUERY_PARAM = "readerContext";
export const READER_REQUEST_INTENT_HEADER = "x-bb-reader-request";
export const READER_CONTEXT_HEADER = "x-bb-reader-context";
export const MAX_READER_BODY_BYTES = 8192;

export interface ReaderRequestContext {
  readonly schema: "bb-reader-context-v1";
  readonly issuer: string;
  readonly subject: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly serverId: string;
  readonly pluginId: string;
  readonly rpcMethod: string;
  readonly nonce: string;
  readonly checkedAt: number;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly method: "POST";
  readonly path: string;
  readonly bodySha256: string;
  readonly bodyBytes: number;
}

export interface OpenReaderHttpFrame {
  type: "open-reader-http";
  streamId: number;
  context: ReaderRequestContext;
}

export interface ReaderContextRequest {
  dispatch(body: Uint8Array): Promise<Response>;
}

export interface ReaderContextConnection {
  begin(
    context: ReaderRequestContext,
    signal: AbortSignal,
  ): ReaderContextRequest | null;
  close(): void;
}

export interface BuiltinConnectRequestContext {
  openConnection(serverId: string): ReaderContextConnection | null;
}

const READER_KEYS = [
  "schema",
  "issuer",
  "subject",
  "sessionId",
  "generation",
  "serverId",
  "pluginId",
  "rpcMethod",
  "nonce",
  "checkedAt",
  "issuedAt",
  "expiresAt",
  "method",
  "path",
  "bodySha256",
  "bodyBytes",
];
export function readerRpcTarget(
  path: string,
): { pluginId: string; rpcMethod: string } | null {
  if (path.length > 1024) return null;
  const match =
    /^\/api\/v1\/plugins\/([a-z0-9][a-z0-9-]*)\/rpc\/([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/u.exec(
      path,
    );
  return match === null ? null : { pluginId: match[1]!, rpcMethod: match[2]! };
}

function readerContextSnapshot(value: unknown): Record<string, unknown> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== READER_KEYS.length ||
      keys.some((key) => typeof key !== "string" || !READER_KEYS.includes(key))
    )
      return null;
    const record: Record<string, unknown> = Object.create(null);
    for (const key of READER_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) return null;
      record[key] = descriptor.value;
    }
    return record;
  } catch {
    return null;
  }
}

export function parseReaderRequestContext(
  value: unknown,
): ReaderRequestContext {
  const record = readerContextSnapshot(value);
  if (record === null) throw new Error("invalid reader context");
  for (const key of [
    "issuer",
    "subject",
    "sessionId",
    "serverId",
    "pluginId",
    "rpcMethod",
    "nonce",
    "path",
    "bodySha256",
  ]) {
    if (
      typeof record[key] !== "string" ||
      record[key].length === 0 ||
      record[key].length > 1024
    )
      throw new Error("invalid reader context");
  }
  for (const key of [
    "generation",
    "checkedAt",
    "issuedAt",
    "expiresAt",
    "bodyBytes",
  ]) {
    if (
      typeof record[key] !== "number" ||
      !Number.isSafeInteger(record[key]) ||
      record[key] < 0
    )
      throw new Error("invalid reader context");
  }
  const target = readerRpcTarget(record.path as string);
  if (
    record.schema !== "bb-reader-context-v1" ||
    record.method !== "POST" ||
    (record.bodyBytes as number) > MAX_READER_BODY_BYTES ||
    !/^[a-f0-9]{64}$/u.test(record.bodySha256 as string) ||
    target?.pluginId !== record.pluginId ||
    target?.rpcMethod !== record.rpcMethod
  )
    throw new Error("invalid reader context");
  return Object.freeze(record) as unknown as ReaderRequestContext;
}

export type HeaderPair = [name: string, value: string];

export interface OpenHttpFrame {
  type: "open-http";
  streamId: number;
  method: string;
  path: string;
  headers: HeaderPair[];
  hasBody: boolean;
  target?: string;
}

interface BodyChunkFrame {
  type: "body-chunk";
  streamId: number;
  data: Uint8Array;
}

interface BodyEndFrame {
  type: "body-end";
  streamId: number;
}

interface RespHeadFrame {
  type: "resp-head";
  streamId: number;
  status: number;
  headers: HeaderPair[];
}

export interface OpenWsFrame {
  type: "open-ws";
  streamId: number;
  path: string;
  headers: HeaderPair[];
  protocols: string[];
  target?: string;
}

interface WsOpenAckFrame {
  type: "ws-open-ack";
  streamId: number;
  protocol: string | null;
}

interface WsDataFrame {
  type: "ws-data";
  streamId: number;
  isBinary: boolean;
  data: Uint8Array;
}

interface CloseStreamFrame {
  type: "close-stream";
  streamId: number;
  code: number;
  reason: string;
}

export type Frame =
  | OpenReaderHttpFrame
  | OpenHttpFrame
  | BodyChunkFrame
  | BodyEndFrame
  | RespHeadFrame
  | OpenWsFrame
  | WsOpenAckFrame
  | WsDataFrame
  | CloseStreamFrame;

const FRAME_TYPE_NAMES = new Map<number, Frame["type"]>([
  [FRAME_TYPE.openHttp, "open-http"],
  [FRAME_TYPE.bodyChunk, "body-chunk"],
  [FRAME_TYPE.bodyEnd, "body-end"],
  [FRAME_TYPE.respHead, "resp-head"],
  [FRAME_TYPE.openWs, "open-ws"],
  [FRAME_TYPE.wsOpenAck, "ws-open-ack"],
  [FRAME_TYPE.wsData, "ws-data"],
  [FRAME_TYPE.closeStream, "close-stream"],
  [FRAME_TYPE.openReaderHttp, "open-reader-http"],
]);

const FRAME_HEADER_BYTES = 5;

function frameBytes(message: ArrayBuffer | Uint8Array): Uint8Array {
  const buf = message instanceof Uint8Array ? message : new Uint8Array(message);
  if (buf.length < FRAME_HEADER_BYTES) {
    throw new Error(`tunnel-contract: frame too short (${buf.length} bytes)`);
  }
  return buf;
}

export function peekFrame(message: ArrayBuffer | Uint8Array): {
  type: Frame["type"];
  streamId: number;
} {
  const buf = frameBytes(message);
  const type = FRAME_TYPE_NAMES.get(buf[0]);
  if (type === undefined) {
    throw new Error(`tunnel-contract: unknown frame type ${buf[0]}`);
  }
  return {
    type,
    streamId: new DataView(buf.buffer, buf.byteOffset).getUint32(1),
  };
}

export function setFrameStreamId(
  message: ArrayBuffer | Uint8Array,
  streamId: number,
): Uint8Array {
  if (!Number.isInteger(streamId) || streamId < 0 || streamId > 0xffffffff) {
    throw new Error(`tunnel-contract: stream id out of range: ${streamId}`);
  }
  const buf = frameBytes(message);
  new DataView(buf.buffer, buf.byteOffset).setUint32(1, streamId);
  return buf;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function withHeader(
  type: number,
  streamId: number,
  payload: Uint8Array,
): Uint8Array {
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
    case "open-reader-http":
      return withHeader(
        FRAME_TYPE.openReaderHttp,
        frame.streamId,
        jsonPayload({ context: parseReaderRequestContext(frame.context) }),
      );
    case "open-http":
      return withHeader(
        FRAME_TYPE.openHttp,
        frame.streamId,
        jsonPayload({
          method: frame.method,
          path: frame.path,
          headers: frame.headers,
          hasBody: frame.hasBody,
          ...(frame.target !== undefined ? { target: frame.target } : {}),
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
        jsonPayload({
          path: frame.path,
          headers: frame.headers,
          protocols: frame.protocols,
          ...(frame.target !== undefined ? { target: frame.target } : {}),
        }),
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
    case FRAME_TYPE.openReaderHttp: {
      if (payload.byteLength > 8192) throw new Error("invalid reader frame");
      const meta = parseJson<Record<string, unknown>>(
        payload,
        "open-reader-http",
      );
      if (
        typeof meta !== "object" ||
        meta === null ||
        Object.keys(meta).length !== 1 ||
        !Object.hasOwn(meta, "context")
      )
        throw new Error("invalid reader frame");
      return {
        type: "open-reader-http",
        streamId,
        context: parseReaderRequestContext(meta.context),
      };
    }
    case FRAME_TYPE.openHttp: {
      const meta = parseJson<{
        method: string;
        path: string;
        headers: HeaderPair[];
        hasBody: boolean;
        target?: unknown;
      }>(payload, "open-http");
      return {
        type: "open-http",
        streamId,
        method: meta.method,
        path: meta.path,
        headers: meta.headers,
        hasBody: meta.hasBody,
        ...(typeof meta.target === "string" ? { target: meta.target } : {}),
      };
    }
    case FRAME_TYPE.bodyChunk:
      return { type: "body-chunk", streamId, data: payload };
    case FRAME_TYPE.bodyEnd:
      return { type: "body-end", streamId };
    case FRAME_TYPE.respHead: {
      const meta = parseJson<{ status: number; headers: HeaderPair[] }>(
        payload,
        "resp-head",
      );
      return { type: "resp-head", streamId, ...meta };
    }
    case FRAME_TYPE.openWs: {
      const meta = parseJson<{
        path: string;
        headers: HeaderPair[];
        protocols: string[];
        target?: unknown;
      }>(payload, "open-ws");
      return {
        type: "open-ws",
        streamId,
        path: meta.path,
        headers: meta.headers,
        protocols: meta.protocols,
        ...(typeof meta.target === "string" ? { target: meta.target } : {}),
      };
    }
    case FRAME_TYPE.wsOpenAck: {
      const meta = parseJson<{ protocol: string | null }>(
        payload,
        "ws-open-ack",
      );
      return { type: "ws-open-ack", streamId, protocol: meta.protocol };
    }
    case FRAME_TYPE.wsData: {
      if (payload.length < 1) {
        throw new Error("tunnel-contract: ws-data frame missing binary flag");
      }
      return {
        type: "ws-data",
        streamId,
        isBinary: payload[0] === 1,
        data: payload.subarray(1),
      };
    }
    case FRAME_TYPE.closeStream: {
      const meta = parseJson<{ code: number; reason: string }>(
        payload,
        "close-stream",
      );
      return { type: "close-stream", streamId, ...meta };
    }
    default:
      throw new Error(`tunnel-contract: unknown frame type ${type}`);
  }
}

export function* chunkBody(
  streamId: number,
  data: Uint8Array,
): Generator<BodyChunkFrame> {
  for (let offset = 0; offset < data.length; offset += MAX_CHUNK_BYTES) {
    yield {
      type: "body-chunk",
      streamId,
      data: data.subarray(
        offset,
        Math.min(offset + MAX_CHUNK_BYTES, data.length),
      ),
    };
  }
}
