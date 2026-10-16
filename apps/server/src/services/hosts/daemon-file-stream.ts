import { Buffer } from "node:buffer";
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

type FileChunk = HostDaemonOnlineRpcResultByType["host.read_file_chunk"];
type ReadChunk = (
  offset: number,
  length: number,
  revision: string | null,
  signal: AbortSignal,
) => Promise<FileChunk>;

export async function serveDaemonFileStream(
  deps: LoggedWorkSessionDeps,
  target: { hostId: string; path: string; rootPath: string },
  request: Request,
  prepareHeaders: (metadata: FileChunk) => Headers,
): Promise<Response> {
  const read: ReadChunk = (offset, length, revision, signal) =>
    callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      signal,
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
    const metadata = await read(0, 0, null, request.signal);
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
      return {
        maxChunkBytes: HOST_FILE_CHUNK_MAX_BYTES,
        async read(offset, length) {
          const chunk = await read(offset, length, metadata.revision, signal);
          const bytes = Buffer.from(chunk.content, "base64");
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
          return bytes;
        },
        async close() {},
      };
    },
  };
}
