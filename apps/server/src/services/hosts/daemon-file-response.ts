import { Buffer } from "node:buffer";
import type {
  HostDaemonOnlineRpcResultByType,
  HostReadFileIfNoneMatch,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "./online-rpc.js";

const OCTET_STREAM_MIME_TYPE = "application/octet-stream";
const REVALIDATE_CACHE_CONTROL = "private, no-cache";

type HostReadFileResult = HostDaemonOnlineRpcResultByType["host.read_file"];
export type DaemonFileReadResult =
  | HostReadFileResult
  | HostDaemonOnlineRpcResultByType["host.read_file_relative"];

interface CreateDaemonFileContentResponseOptions {
  headers?: HeadersInit;
  ifNoneMatch?: string | undefined;
}

export async function serveDaemonFileContent(
  deps: LoggedWorkSessionDeps,
  target: {
    hostId: string;
    ifNoneMatch?: string | undefined;
    path: string;
    rootPath?: string;
  },
  createResponse: (result: DaemonFileReadResult) => Response,
): Promise<Response> {
  const { hostId, ifNoneMatch, ...file } = target;
  const daemonIfNoneMatch = parseDaemonIfNoneMatch(ifNoneMatch);
  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file",
        ...file,
        ...(daemonIfNoneMatch !== undefined
          ? { ifNoneMatch: daemonIfNoneMatch }
          : {}),
      },
    });
    return createResponse(result);
  } catch (error) {
    return remapDaemonFileRouteError(error);
  }
}

function parseDaemonIfNoneMatch(
  ifNoneMatch: string | undefined,
): HostReadFileIfNoneMatch | undefined {
  if (ifNoneMatch === undefined) {
    return undefined;
  }
  if (ifNoneMatch.trim() === "*") {
    return { kind: "any" };
  }
  const values = ifNoneMatch
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//u, ""))
    .map((tag) => /^"([a-f0-9]{64})"$/u.exec(tag)?.[1])
    .filter((value): value is string => value !== undefined);
  return values.length > 0 ? { kind: "sha256", values } : undefined;
}

function daemonFileEntityTag(result: DaemonFileReadResult): string {
  return `"${result.sha256}"`;
}

export function buildAttachmentContentDisposition(path: string): string {
  const filename = path.split(/[\\/]/u).at(-1) ?? "download";
  const fallback = filename
    .replace(/[^\x20-\x7E]/gu, "_")
    .replace(/["\\]/gu, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

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
  const opaque = (tag: string): string => tag.trim().replace(/^W\//u, "");
  return trimmed.split(",").map(opaque).includes(opaque(entityTag));
}

export function requireDaemonFileContentResult(
  result: HostReadFileResult,
): Exclude<HostReadFileResult, { notModified: true }> {
  if ("notModified" in result) {
    throw new Error("Unconditional daemon file read returned not modified");
  }
  return result;
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

function decodeDaemonFileContent(result: DaemonFileReadResult): ArrayBuffer {
  if ("notModified" in result) {
    throw new Error("Cannot decode a not-modified daemon file result");
  }
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
    "notModified" in result ||
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
