import {
  HOST_FILE_CHUNK_MAX_BYTES,
  type HostDaemonOnlineRpcResultByType,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "./online-rpc.js";
import { remapDaemonFileRouteError } from "./daemon-file-response.js";
import {
  createFileStreamResponse,
  type FileResponseSource,
} from "../files/file-stream-response.js";
import { parseSingleByteRange } from "../files/file-byte-range.js";

type FileChunk = HostDaemonOnlineRpcResultByType["host.read_file_chunk"];

const DAEMON_FILE_CHUNKS_IN_FLIGHT = 16;
const DAEMON_FILE_ENTITY_TAG_PATTERN = /^(?:W\/)?"file-([a-f0-9]{64})"$/u;
const KNOWN_REVISIONS_MAX = 16;

type ReadChunk = (
  offset: number,
  length: number,
  revision: string | null,
  signal: AbortSignal,
) => Promise<FileChunk>;

function knownRevisions(request: Request): string[] {
  const revisions = (request.headers.get("if-none-match") ?? "")
    .split(",")
    .map((tag) => DAEMON_FILE_ENTITY_TAG_PATTERN.exec(tag.trim())?.[1])
    .filter((revision) => revision !== undefined);
  return [...new Set(revisions)].slice(0, KNOWN_REVISIONS_MAX);
}

function firstReadLength(request: Request): number {
  if (
    request.method === "HEAD" ||
    request.headers.get("if-none-match")?.trim() === "*"
  ) {
    return 0;
  }
  const range = request.headers.get("range");
  if (range === null || request.headers.has("if-range")) {
    return HOST_FILE_CHUNK_MAX_BYTES;
  }
  const parsed = parseSingleByteRange(range, Number.MAX_SAFE_INTEGER);
  return parsed === undefined ||
    (parsed !== "unsatisfiable" && parsed.start === 0)
    ? HOST_FILE_CHUNK_MAX_BYTES
    : 0;
}

export async function serveDaemonFileStream(
  deps: LoggedWorkSessionDeps,
  target: { hostId: string; path: string; rootPath: string },
  request: Request,
  prepareHeaders: (metadata: FileChunk) => Headers,
): Promise<Response> {
  const readChunk = (
    chunk: {
      offset: number;
      length: number;
      revision: string | null;
      knownRevisions: string[];
    },
    signal: AbortSignal,
  ) =>
    callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      signal,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file_chunk",
        path: target.path,
        rootPath: target.rootPath,
        ...chunk,
      },
    });
  const read: ReadChunk = (offset, length, revision, signal) =>
    readChunk({ offset, length, revision, knownRevisions: [] }, signal);
  try {
    const first = await readChunk(
      {
        offset: 0,
        length: firstReadLength(request),
        revision: null,
        knownRevisions: knownRevisions(request),
      },
      request.signal,
    );
    return await createDaemonFileStreamResponse(
      first,
      read,
      request,
      prepareHeaders(first),
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
  if (!headers.has("content-type"))
    headers.set(
      "content-type",
      metadata.mimeType ?? "application/octet-stream",
    );
  if (!headers.has("cache-control"))
    headers.set("cache-control", "private, no-cache");
  return createFileStreamResponse({
    request,
    headers,
    source: createDaemonFileSource(metadata, read),
  });
}

export function createDaemonFileSource(
  metadata: FileChunk,
  read: ReadChunk,
): FileResponseSource {
  return {
    sizeBytes: metadata.sizeBytes,
    entityTag: `W/"file-${metadata.revision}"`,
    lastModified: new Date(metadata.modifiedAtMs).toUTCString(),
    async open(signal) {
      let firstChunk: Uint8Array | null = metadata.content;
      return {
        maxChunkBytes: HOST_FILE_CHUNK_MAX_BYTES,
        maxChunksInFlight: DAEMON_FILE_CHUNKS_IN_FLIGHT,
        async read(offset, length) {
          const prefetched = firstChunk;
          firstChunk = null;
          if (
            prefetched !== null &&
            metadata.offset === offset &&
            length <= prefetched.byteLength
          ) {
            return prefetched.subarray(0, length);
          }
          const chunk = await read(offset, length, metadata.revision, signal);
          if (
            chunk.revision !== metadata.revision ||
            chunk.sizeBytes !== metadata.sizeBytes ||
            chunk.offset !== offset
          ) {
            throw new ApiError(
              409,
              "file_changed",
              "File changed or returned an incomplete chunk",
              true,
            );
          }
          return chunk.content;
        },
        async close() {},
      };
    },
  };
}
