export interface OperationBodyHead {
  status: number;
  contentType: string | null;
  headers: Readonly<Record<string, string>>;
}

export interface OperationBytesBody extends OperationBodyHead {
  body: "bytes";
  bytes: Uint8Array;
}

export interface OperationStreamBody extends OperationBodyHead {
  body: "stream";
  stream: ReadableStream<Uint8Array>;
}

export type OperationBody = OperationBytesBody | OperationStreamBody;

export interface OperationBodyOptions {
  status?: number;
  contentType?: string | null;
  headers?: Readonly<Record<string, string>> | Headers;
}

function isHeaders(value: unknown): value is Headers {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "get") === "function" &&
    typeof Reflect.get(value, "entries") === "function"
  );
}

const NULL_BODY_STATUSES: ReadonlySet<number> = new Set([101, 204, 205, 304]);

function headerRecord(
  headers: Readonly<Record<string, string>> | Headers | undefined,
): Record<string, string> {
  const record: Record<string, string> = {};
  if (headers === undefined) return record;
  const entries = isHeaders(headers)
    ? headers.entries()
    : Object.entries(headers);
  for (const [name, value] of entries) {
    const key = name.toLowerCase();
    if (key !== "content-type") record[key] = value;
  }
  return record;
}

function contentTypeOf(options: OperationBodyOptions): string | null {
  if (options.contentType !== undefined) return options.contentType;
  if (isHeaders(options.headers)) {
    return options.headers.get("content-type");
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (name.toLowerCase() === "content-type") return value;
  }
  return null;
}

export function bytesBody(
  bytes: Uint8Array,
  options: OperationBodyOptions = {},
): OperationBytesBody {
  return {
    body: "bytes",
    status: options.status ?? 200,
    contentType: contentTypeOf(options),
    headers: headerRecord(options.headers),
    bytes,
  };
}

export function streamBody(
  stream: ReadableStream<Uint8Array>,
  options: OperationBodyOptions = {},
): OperationStreamBody {
  return {
    body: "stream",
    status: options.status ?? 200,
    contentType: contentTypeOf(options),
    headers: headerRecord(options.headers),
    stream,
  };
}

export function emptyBody(
  status: number,
  options: Omit<OperationBodyOptions, "status"> = {},
): OperationBytesBody {
  return bytesBody(new Uint8Array(0), { ...options, status });
}

export function jsonBody(
  value: unknown,
  options: Omit<OperationBodyOptions, "contentType"> = {},
): OperationBytesBody {
  return bytesBody(new TextEncoder().encode(JSON.stringify(value)), {
    ...options,
    contentType: "application/json",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "getReader") === "function"
  );
}

export function isOperationBody(value: unknown): value is OperationBody {
  if (!isRecord(value)) return false;
  if (typeof value.status !== "number") return false;
  if (value.contentType !== null && typeof value.contentType !== "string") {
    return false;
  }
  if (!isStringRecord(value.headers)) return false;
  if (value.body === "bytes") return ArrayBuffer.isView(value.bytes);
  if (value.body === "stream") return isReadableStream(value.stream);
  return false;
}

export function operationBodyResponse(body: OperationBody): Response {
  const headers = new Headers(body.headers);
  if (body.contentType !== null) headers.set("content-type", body.contentType);
  if (NULL_BODY_STATUSES.has(body.status)) {
    if (body.body === "stream") void body.stream.cancel().catch(() => {});
    return new Response(null, { status: body.status, headers });
  }
  if (body.body === "bytes") {
    if (body.bytes.byteLength > 0 || !headers.has("content-length")) {
      headers.set("content-length", String(body.bytes.byteLength));
    }
    return new Response(new Uint8Array(body.bytes), {
      status: body.status,
      headers,
    });
  }
  return new Response(body.stream, { status: body.status, headers });
}

export function operationBodyFromResponse(response: {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}): OperationBody {
  const headers = headerRecord(response.headers);
  const contentType = response.headers.get("content-type");
  if (response.body === null) {
    return bytesBody(new Uint8Array(0), {
      status: response.status,
      contentType,
      headers,
    });
  }
  return streamBody(response.body, {
    status: response.status,
    contentType,
    headers,
  });
}

export async function readOperationBody(body: OperationBody): Promise<Uint8Array> {
  if (body.body === "bytes") return body.bytes;
  return new Uint8Array(await new Response(body.stream).arrayBuffer());
}
