import { Buffer } from "node:buffer";
import {
  HOST_FILE_CHUNK_MAX_BYTES,
  type HostDaemonOnlineRpcResultByType,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "./online-rpc.js";
import {
  remapDaemonFileRouteError,
  requestMatchesEntityTag,
} from "./daemon-file-response.js";
import { parseSingleByteRange } from "./file-byte-range.js";

type FileChunk = HostDaemonOnlineRpcResultByType["host.read_file_chunk"];
type ReadChunk = (
  offset: number,
  length: number,
  revision: string | null,
) => Promise<FileChunk>;

export async function serveDaemonFileStream(
  deps: LoggedWorkSessionDeps,
  target: { hostId: string; path: string; rootPath: string },
  request: Request,
  prepareHeaders: (metadata: FileChunk) => Headers,
): Promise<Response> {
  const read: ReadChunk = (offset, length, revision) =>
    callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file_chunk",
        path: target.path,
        rootPath: target.rootPath,
        offset,
        length,
        revision,
      },
    });
  try {
    const metadata = await read(0, 0, null);
    return await createDaemonFileStreamResponse(
      metadata,
      read,
      request,
      prepareHeaders(metadata),
    );
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "file_changed") {
      throw new ApiError(
        409,
        "file_changed",
        "File changed during read; retry the request",
        true,
      );
    }
    return remapDaemonFileRouteError(error);
  }
}

export async function createDaemonFileStreamResponse(
  metadata: FileChunk,
  read: ReadChunk,
  request: Request,
  headers = new Headers(),
): Promise<Response> {
  const entityTag = `W/"file-${metadata.revision}"`;
  headers.set("accept-ranges", "bytes");
  headers.set("etag", entityTag);
  headers.set("last-modified", new Date(metadata.modifiedAtMs).toUTCString());
  if (!headers.has("content-type"))
    headers.set(
      "content-type",
      metadata.mimeType ?? "application/octet-stream",
    );
  if (!headers.has("cache-control"))
    headers.set("cache-control", "private, no-cache");
  if (
    headers.get("cache-control") !== "no-store" &&
    requestMatchesEntityTag(
      request.headers.get("if-none-match") ?? undefined,
      entityTag,
    )
  ) {
    return new Response(null, { status: 304, headers });
  }
  let start = 0;
  let end = metadata.sizeBytes - 1;
  let status = 200;
  const rangeHeader = request.headers.get("range");
  if (
    request.method === "GET" &&
    rangeHeader &&
    !request.headers.has("if-range")
  ) {
    const range = parseSingleByteRange(rangeHeader, metadata.sizeBytes);
    if (range === "unsatisfiable") {
      headers.set("content-range", `bytes */${metadata.sizeBytes}`);
      headers.set("content-length", "0");
      return new Response(null, { status: 416, headers });
    }
    if (range) {
      ({ start, end } = range);
      status = 206;
      headers.set(
        "content-range",
        `bytes ${start}-${end}/${metadata.sizeBytes}`,
      );
    }
  }
  headers.set("content-length", String(end - start + 1));
  if (request.method === "HEAD" || metadata.sizeBytes === 0) {
    return new Response(null, { status, headers });
  }
  const readBytes = async (offset: number) => {
    request.signal.throwIfAborted();
    const length = Math.min(HOST_FILE_CHUNK_MAX_BYTES, end - offset + 1);
    const chunk = await read(offset, length, metadata.revision);
    request.signal.throwIfAborted();
    const bytes = Buffer.from(chunk.content, "base64");
    if (
      chunk.revision !== metadata.revision ||
      chunk.sizeBytes !== metadata.sizeBytes ||
      chunk.offset !== offset ||
      bytes.length !== length
    ) {
      throw new ApiError(
        409,
        "file_changed",
        "File changed or returned an incomplete chunk",
        true,
      );
    }
    return bytes;
  };
  let next = start;
  let first: Buffer | null = await readBytes(next);
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const bytes = first ?? (await readBytes(next));
          first = null;
          if (cancelled) return;
          next += bytes.length;
          controller.enqueue(bytes);
          if (next > end) controller.close();
        } catch (error) {
          if (!cancelled) controller.error(error);
        }
      },
      cancel() {
        cancelled = true;
        first = null;
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status, headers });
}
