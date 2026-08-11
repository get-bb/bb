import { Buffer } from "node:buffer";
import type { HostDaemonOnlineRpcResultByType } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";

const OCTET_STREAM_MIME_TYPE = "application/octet-stream";
const GENERATED_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

export type DaemonFileReadResult =
  | HostDaemonOnlineRpcResultByType["host.read_file"]
  | HostDaemonOnlineRpcResultByType["host.read_file_relative"];

interface CreateDaemonFileContentResponseOptions {
  headers?: HeadersInit;
}

function buildFileContentHeaders(
  result: DaemonFileReadResult,
  options: CreateDaemonFileContentResponseOptions,
): Headers {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", result.mimeType ?? OCTET_STREAM_MIME_TYPE);
  }
  return headers;
}

function decodeDaemonFileContentBytes(
  result: DaemonFileReadResult,
): Uint8Array<ArrayBuffer> {
  const decoded =
    result.contentEncoding === "utf8"
      ? Buffer.from(result.content, "utf8")
      : Buffer.from(result.content, "base64");
  return Uint8Array.from(decoded);
}

export function decodeDaemonFileContent(
  result: DaemonFileReadResult,
): ArrayBuffer {
  return decodeDaemonFileContentBytes(result).buffer;
}

export function createDaemonFileContentResponse(
  result: DaemonFileReadResult,
  options: CreateDaemonFileContentResponseOptions = {},
): Response {
  return new Response(decodeDaemonFileContent(result), {
    status: 200,
    headers: buildFileContentHeaders(result, options),
  });
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function matchesGeneratedImageMime(
  bytes: Uint8Array,
  mimeType: string,
): boolean {
  switch (mimeType) {
    case "image/png":
      return hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/jpeg":
      return hasPrefix(bytes, [0xff, 0xd8, 0xff]);
    case "image/gif":
      return (
        hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        hasPrefix(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
      );
    case "image/webp":
      return (
        hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      );
    default:
      return false;
  }
}

export function createGeneratedImageContentResponse(
  result: DaemonFileReadResult,
): Response {
  if (result.sizeBytes > GENERATED_IMAGE_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "Generated image exceeds the 10 MiB limit",
    );
  }
  const bytes = decodeDaemonFileContentBytes(result);
  if (bytes.byteLength > GENERATED_IMAGE_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "Generated image exceeds the 10 MiB limit",
    );
  }
  if (bytes.byteLength !== result.sizeBytes) {
    throw new ApiError(
      422,
      "invalid_image",
      "Generated image size does not match its declared size",
    );
  }
  const mimeType = result.mimeType ?? OCTET_STREAM_MIME_TYPE;
  if (!matchesGeneratedImageMime(bytes, mimeType)) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Generated image content is not a supported raster image",
    );
  }
  return new Response(bytes.buffer, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function remapDaemonFileRouteError(error: unknown): never {
  if (!(error instanceof ApiError)) {
    throw error;
  }

  if (error.body.code === "ENOENT") {
    throw new ApiError(
      404,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  if (error.body.code === "invalid_path") {
    throw new ApiError(
      400,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  if (error.body.code === "file_too_large") {
    throw new ApiError(
      413,
      error.body.code,
      error.body.message,
      error.body.retryable,
    );
  }
  throw error;
}
