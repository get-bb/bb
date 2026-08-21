import {
  buildFilePreview,
  normalizeFilePreviewMimeType,
  type EnvironmentFilePreviewSource,
  type FilePreview,
  type FilePreviewTarget,
} from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import type {
  EnvironmentDiffFileQuery,
  EnvironmentDiffFileResponse,
} from "@bb/server-contract";

/**
 * File content readers behind the preview queries (mirrors the web's
 * `loadFilePreview` in apps/app/src/lib/api.ts and
 * `buildEnvironmentFilePreview` in hooks/queries/environment-queries.ts).
 * Pure apart from the injected fetch so the decode / error paths are
 * vitest-tested.
 */

/** The server's 413 code when the daemon refuses a read (MIME-based limits). */
export const FILE_TOO_LARGE_ERROR_CODE = "file_too_large";

/** A classified preview plus the byte size the header shows. */
export type LoadedFilePreview = FilePreview & { sizeBytes: number };

interface ApiErrorBodyShape {
  code?: unknown;
  message?: unknown;
}

function parseErrorBody(text: string): ApiErrorBodyShape | null {
  if (text.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as ApiErrorBodyShape)
      : null;
  } catch {
    return null;
  }
}

/** Non-2xx → `BbHttpError` with the server's `code` when the body carries one. */
async function throwFileRouteError(response: Response): Promise<never> {
  const text = await response.text().catch(() => "");
  const body = parseErrorBody(text);
  const code = typeof body?.code === "string" ? body.code : null;
  const message =
    typeof body?.message === "string" && body.message.length > 0
      ? body.message
      : response.statusText || `Request failed (${response.status})`;
  throw new BbHttpError({ body, code, message, status: response.status });
}

export interface LoadFilePreviewArgs extends FilePreviewTarget {
  fetch: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Read one binary content route (`/thread-storage/content`,
 * `/host-files/content`, `/projects/:id/files/content`) and classify the
 * bytes (`buildFilePreview`: image / text / video / unsupported).
 */
export async function loadFilePreview({
  fetch: fetchImpl,
  name,
  path,
  signal,
  url,
}: LoadFilePreviewArgs): Promise<LoadedFilePreview> {
  const response = await fetchImpl(url, { method: "GET", signal });
  if (!response.ok) {
    await throwFileRouteError(response);
  }
  const contentBytes = new Uint8Array(await response.arrayBuffer());
  const preview = buildFilePreview({
    contentBytes,
    mimeType: normalizeFilePreviewMimeType(
      response.headers.get("content-type"),
    ),
    name,
    path,
    url,
  });
  return { ...preview, sizeBytes: contentBytes.byteLength };
}

function decodeBase64Bytes(content: string): Uint8Array {
  const binaryContent = atob(content);
  const bytes = new Uint8Array(binaryContent.length);
  for (let index = 0; index < binaryContent.length; index += 1) {
    bytes[index] = binaryContent.charCodeAt(index);
  }
  return bytes;
}

function encodeBase64Bytes(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  const binaryChunks: string[] = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binaryChunks.push(
      String.fromCharCode(...bytes.subarray(index, index + chunkSize)),
    );
  }
  return btoa(binaryChunks.join(""));
}

/** `/diff/file` query for a workspace file at one of the three sources. */
export function buildEnvironmentFilePreviewQuery(
  path: string,
  source: EnvironmentFilePreviewSource,
): EnvironmentDiffFileQuery {
  const side = source.kind === "working-tree" ? "new" : "old";
  return source.kind === "merge-base"
    ? { target: "branch_committed", mergeBaseRef: source.ref, path, side }
    : { target: "uncommitted", path, side };
}

/** Stable cache-key fragment for a preview source. */
export function environmentFilePreviewSourceKey(
  source: EnvironmentFilePreviewSource,
): string {
  return source.kind === "merge-base"
    ? `merge-base:${source.ref}`
    : source.kind;
}

export interface BuildEnvironmentFilePreviewArgs {
  contentUrl: string;
  path: string;
  response: EnvironmentDiffFileResponse;
}

/**
 * Build the preview for a `/diff/file` read. Only image and video previews
 * need a loadable `url` (expo-image / the video card), so only those pay for
 * a base64 `data:` URL; text previews carry their content inline and keep
 * the JSON route as their identity.
 */
export function buildEnvironmentFilePreview({
  contentUrl,
  path,
  response,
}: BuildEnvironmentFilePreviewArgs): LoadedFilePreview {
  const contentBytes =
    response.contentEncoding === "base64"
      ? decodeBase64Bytes(response.content)
      : new TextEncoder().encode(response.content);
  const mimeType = normalizeFilePreviewMimeType(response.mimeType ?? null);
  const preview = buildFilePreview({
    contentBytes,
    mimeType,
    name: path.split("/").at(-1),
    path,
    url: contentUrl,
  });
  const sizeBytes = response.sizeBytes;
  if (preview.kind !== "image" && preview.kind !== "video") {
    return { ...preview, sizeBytes };
  }
  const base64Content =
    response.contentEncoding === "base64"
      ? response.content
      : encodeBase64Bytes(contentBytes);
  return {
    ...preview,
    sizeBytes,
    url: `data:${mimeType};base64,${base64Content}`,
  };
}
