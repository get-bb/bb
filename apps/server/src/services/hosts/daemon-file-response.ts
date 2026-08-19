import { Buffer } from "node:buffer";
import type { HostDaemonOnlineRpcResultByType } from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";

const OCTET_STREAM_MIME_TYPE = "application/octet-stream";
/**
 * Host files change under the agent, so the browser must revalidate on every
 * use — but it may keep the bytes and send `If-None-Match`, which turns an
 * unchanged multi-megabyte image into a 304 instead of a re-download.
 */
const REVALIDATE_CACHE_CONTROL = "private, no-cache";

export type DaemonFileReadResult =
  | HostDaemonOnlineRpcResultByType["host.read_file"]
  | HostDaemonOnlineRpcResultByType["host.read_file_relative"];

interface CreateDaemonFileContentResponseOptions {
  headers?: HeadersInit;
  /** `If-None-Match` from the request; a match answers 304 without a body. */
  ifNoneMatch?: string | undefined;
}

/** Strong validator: the daemon hashes exactly the bytes it returned. */
export function daemonFileEntityTag(result: DaemonFileReadResult): string {
  return `"${result.sha256}"`;
}

/**
 * RFC 9110 `If-None-Match`: a `*` or any listed tag (weak prefix ignored)
 * that equals the current one means the client already holds these bytes.
 */
export function requestMatchesEntityTag(
  ifNoneMatch: string | undefined,
  entityTag: string,
): boolean {
  if (ifNoneMatch === undefined) {
    return false;
  }
  const trimmed = ifNoneMatch.trim();
  if (trimmed === "*") {
    return true;
  }
  return trimmed
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//u, ""))
    .includes(entityTag);
}

function buildFileContentHeaders(
  result: DaemonFileReadResult,
  options: CreateDaemonFileContentResponseOptions,
): Headers {
  const headers = new Headers(options.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", result.mimeType ?? OCTET_STREAM_MIME_TYPE);
  }
  if (!headers.has("cache-control")) {
    headers.set("cache-control", REVALIDATE_CACHE_CONTROL);
  }
  headers.set("etag", daemonFileEntityTag(result));
  if (result.modifiedAtMs !== undefined) {
    headers.set("last-modified", new Date(result.modifiedAtMs).toUTCString());
  }
  return headers;
}

export function decodeDaemonFileContent(
  result: DaemonFileReadResult,
): ArrayBuffer {
  const bytes =
    result.contentEncoding === "utf8"
      ? Buffer.from(result.content, "utf8")
      : Buffer.from(result.content, "base64");
  const view = Uint8Array.from(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export function createDaemonFileContentResponse(
  result: DaemonFileReadResult,
  options: CreateDaemonFileContentResponseOptions = {},
): Response {
  const headers = buildFileContentHeaders(result, options);
  if (
    requestMatchesEntityTag(options.ifNoneMatch, daemonFileEntityTag(result))
  ) {
    return new Response(null, { status: 304, headers });
  }
  const content = decodeDaemonFileContent(result);
  headers.set("content-length", String(content.byteLength));
  return new Response(content, {
    status: 200,
    headers,
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
