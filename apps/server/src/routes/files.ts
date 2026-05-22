import path from "node:path";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import mimeTypes from "mime-types";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../types.js";
import { queueCommandAndWait } from "../services/hosts/command-wait.js";
import {
  createDaemonFileContentResponse,
  type DaemonFileReadResult,
  remapDaemonFileRouteError,
} from "../services/hosts/daemon-file-response.js";
import { requirePublicThreadEnvironment } from "../services/lib/entity-lookup.js";

type HostReadFileCommand = Extract<
  HostDaemonCommand,
  { type: "host.read_file" }
>;

const FILES_RAW_PATH_QUERY_KEY = "path";
const HTML_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const HTML_PREVIEW_CONTENT_TYPE = "text/html; charset=utf-8";
const HTML_PREVIEW_CSP = "sandbox allow-scripts";
const NO_STORE_CACHE_CONTROL = "no-store";
const NOSNIFF_CONTENT_TYPE_OPTIONS = "nosniff";
const HTML_MIME_TYPE = "text/html";

function normalizeMimeType(value: string | null | undefined): string | null {
  const normalizedValue = value?.split(";")[0]?.trim().toLowerCase();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

function isHtmlMimeType(value: string | null | undefined): boolean {
  return normalizeMimeType(value) === HTML_MIME_TYPE;
}

function createRawFilesystemPathInvalidError(): ApiError {
  return new ApiError(400, "invalid_path", "Invalid file path", false);
}

function createRawFilesystemPathUnsupportedError(): ApiError {
  return new ApiError(
    415,
    "unsupported_media_type",
    "HTML preview only supports text/html files",
    false,
  );
}

function parseRawFilesystemPath(rawPath: string | undefined): string {
  if (
    rawPath === undefined ||
    rawPath.length === 0 ||
    rawPath.includes("\0") ||
    !path.isAbsolute(rawPath)
  ) {
    throw createRawFilesystemPathInvalidError();
  }
  return path.resolve(rawPath);
}

function assertHtmlPreviewPath(filePath: string): void {
  if (!isHtmlMimeType(mimeTypes.lookup(filePath) || null)) {
    throw createRawFilesystemPathUnsupportedError();
  }
}

function assertRawFilesystemHtmlPreviewResult(
  result: DaemonFileReadResult,
): void {
  if (!isHtmlMimeType(result.mimeType) || result.contentEncoding !== "utf8") {
    throw createRawFilesystemPathUnsupportedError();
  }

  if (result.sizeBytes > HTML_PREVIEW_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "HTML preview exceeds the 5 MB limit",
      false,
    );
  }
}

function createRawFilesystemHtmlPreviewResponse(
  result: DaemonFileReadResult,
): Response {
  assertRawFilesystemHtmlPreviewResult(result);
  return createDaemonFileContentResponse(result, {
    headers: {
      "cache-control": NO_STORE_CACHE_CONTROL,
      "content-security-policy": HTML_PREVIEW_CSP,
      "content-type": HTML_PREVIEW_CONTENT_TYPE,
      "x-content-type-options": NOSNIFF_CONTENT_TYPE_OPTIONS,
    },
  });
}

async function serveRawFilesystemHtmlFile(
  deps: LoggedWorkSessionDeps,
  threadId: string,
  rawPath: string | undefined,
): Promise<Response> {
  const filePath = parseRawFilesystemPath(rawPath);
  assertHtmlPreviewPath(filePath);
  const { environment } = requirePublicThreadEnvironment(deps.db, threadId);
  const command: HostReadFileCommand = {
    type: "host.read_file",
    path: filePath,
  };

  try {
    const result = await queueCommandAndWait(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command,
    });
    return createRawFilesystemHtmlPreviewResponse(result);
  } catch (error) {
    return remapDaemonFileRouteError(error);
  }
}

export function registerFileRoutes(app: Hono, deps: AppDeps): void {
  // Contract-private, not network-private: this endpoint is intentionally
  // outside @bb/server-contract because it serves local user-authored HTML
  // bytes for the desktop/dev app shell, scoped to the clicked thread's host.
  // It must remain protected by bb's local-only deployment assumptions; do
  // not expose /api/v1 on public HTTP without adding an auth boundary.
  app.get("/threads/:id/files/raw", async (context) =>
    serveRawFilesystemHtmlFile(
      deps,
      context.req.param("id"),
      context.req.query(FILES_RAW_PATH_QUERY_KEY),
    ),
  );
}
