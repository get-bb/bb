import path from "node:path";
import type { Hono } from "hono";
import mimeTypes from "mime-types";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../types.js";
import {
  callHostOnlineRpc,
  callHostRetryableOnlineRpc,
} from "../services/hosts/online-rpc.js";
import {
  createDaemonFileContentResponse,
  type DaemonFileReadResult,
  remapDaemonFileRouteError,
} from "../services/hosts/daemon-file-response.js";
import { requirePrimaryHostId } from "../services/hosts/primary-host.js";
import {
  requireNonDestroyedHostWithStatus,
  requirePublicThreadEnvironment,
} from "../services/lib/entity-lookup.js";

const HOST_FILE_LIST_LIMIT_DEFAULT = 1000;

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

function parseRawFilesystemPath(rawPath: string): string {
  if (rawPath.includes("\0") || !path.isAbsolute(rawPath)) {
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
  rawPath: string,
): Promise<Response> {
  const filePath = parseRawFilesystemPath(rawPath);
  assertHtmlPreviewPath(filePath);
  const { environment } = requirePublicThreadEnvironment(deps.db, threadId);
  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file",
        path: filePath,
      },
    });
    return createRawFilesystemHtmlPreviewResponse(result);
  } catch (error) {
    return remapDaemonFileRouteError(error);
  }
}

export function registerFileRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.rawFile, async (context, query) =>
    serveRawFilesystemHtmlFile(deps, context.req.param("id"), query.path),
  );

  // Host file primitives (plugin design §4.1): read/write/list against a
  // connected host. Omitted hostId resolves to the primary (local) host here,
  // once, at the product boundary — daemon commands always get explicit values.
  const fileRoutes = publicApiRoutes.files;

  const resolveHostId = (hostId: string | undefined): string => {
    const resolved = hostId ?? requirePrimaryHostId(deps);
    requireNonDestroyedHostWithStatus(deps, resolved);
    return resolved;
  };

  post(fileRoutes.read, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.read_file",
          path: payload.path,
          ...(payload.rootPath !== undefined
            ? { rootPath: payload.rootPath }
            : {}),
        },
      });
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  post(fileRoutes.write, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const result = await callHostOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.write_file",
          path: payload.path,
          content: payload.content,
          contentEncoding: payload.contentEncoding ?? "utf8",
          createParents: payload.createParents ?? false,
          ...(payload.rootPath !== undefined
            ? { rootPath: payload.rootPath }
            : {}),
          ...(payload.expectedSha256 !== undefined
            ? { expectedSha256: payload.expectedSha256 }
            : {}),
        },
      });
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  post(fileRoutes.list, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_files",
          path: payload.path,
          limit: payload.limit ?? HOST_FILE_LIST_LIMIT_DEFAULT,
          ...(payload.query !== undefined ? { query: payload.query } : {}),
        },
      });
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });
}
