import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import mimeTypes from "mime-types";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { HostDaemonRpcCommand } from "@bb/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { browserRequestProblem } from "../browser-request-guard.js";
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
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../services/hosts/primary-host.js";
import { requirePublicThreadEnvironment } from "../services/lib/entity-lookup.js";

const HOST_FILE_LIST_LIMIT_DEFAULT = 1000;

const HTML_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const HTML_PREVIEW_CONTENT_TYPE = "text/html; charset=utf-8";
const HTML_PREVIEW_CSP = "sandbox allow-scripts";
const NO_STORE_CACHE_CONTROL = "no-store";
const NOSNIFF_CONTENT_TYPE_OPTIONS = "nosniff";
const HTML_MIME_TYPE = "text/html";
const FILE_PREVIEW_TTL_MS = 10 * 60 * 1000;

interface FilePreviewLease {
  hostId: string;
  rootPath: string;
  expiresAtMs: number;
}

type ReadFileCommand = Extract<
  HostDaemonRpcCommand,
  { type: "host.read_file" }
>;
type WriteFileCommand = Extract<
  HostDaemonRpcCommand,
  { type: "host.write_file" }
>;
type ListFilesCommand = Extract<
  HostDaemonRpcCommand,
  { type: "host.list_files" }
>;
type ListPathsCommand = Extract<
  HostDaemonRpcCommand,
  { type: "host.list_paths" }
>;
type MakeDirectoryCommand = Extract<
  HostDaemonRpcCommand,
  { type: "host.mkdir" }
>;
type MovePathCommand = Extract<
  HostDaemonRpcCommand,
  { type: "host.move_path" }
>;
type RemovePathCommand = Extract<
  HostDaemonRpcCommand,
  { type: "host.remove_path" }
>;

function normalizeMimeType(value: string | null | undefined): string | null {
  const normalizedValue = value?.split(";")[0]?.trim().toLowerCase();
  return normalizedValue && normalizedValue.length > 0 ? normalizedValue : null;
}

function isAbsoluteHostPath(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function normalizeHostPath(value: string): string {
  return path.win32.isAbsolute(value) && !path.posix.isAbsolute(value)
    ? path.win32.normalize(value)
    : path.posix.normalize(value);
}

function joinHostPath(rootPath: string, segments: string[]): string {
  return path.win32.isAbsolute(rootPath) && !path.posix.isAbsolute(rootPath)
    ? path.win32.join(rootPath, ...segments)
    : path.posix.join(rootPath, ...segments);
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

  const fileRoutes = publicApiRoutes.files;
  const previewRoutes = publicApiRoutes.filePreviews;
  const previewLeases = new Map<string, FilePreviewLease>();

  const resolveHostId = (hostId: string | undefined): string => {
    const resolved = hostId ?? requirePrimaryHostId(deps);
    assertUsableHostId(deps, { hostId: resolved });
    return resolved;
  };

  const requirePrivilegedJsonMutation = (
    context: Parameters<typeof browserRequestProblem>[0],
  ): void => {
    const problem = browserRequestProblem(context, deps, {
      requireJsonForMutation: true,
    });
    if (problem === null) {
      return;
    }
    throw new ApiError(
      problem.status,
      problem.status === 403 ? "forbidden_origin" : "unsupported_media_type",
      problem.error,
      false,
    );
  };

  for (const route of [
    fileRoutes.write,
    fileRoutes.mkdir,
    fileRoutes.move,
    fileRoutes.remove,
  ]) {
    app.use(route.path, async (context, next) => {
      requirePrivilegedJsonMutation(context);
      await next();
    });
  }

  const runHostFileMutation = async <T>(
    hostId: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await run();
    } finally {
      deps.workspaceReadCaches.invalidateHost(hostId);
    }
  };

  post(fileRoutes.read, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const command: ReadFileCommand = {
        type: "host.read_file",
        path: payload.path,
      };
      if (payload.rootPath !== undefined) command.rootPath = payload.rootPath;
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command,
      });
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  post(fileRoutes.write, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const command: WriteFileCommand = {
        type: "host.write_file",
        path: payload.path,
        content: payload.content,
        contentEncoding: payload.contentEncoding ?? "utf8",
        createParents: payload.createParents ?? false,
      };
      if (payload.rootPath !== undefined) command.rootPath = payload.rootPath;
      if (payload.expectedSha256 !== undefined) {
        command.expectedSha256 = payload.expectedSha256;
      }
      if (payload.mode !== undefined) command.mode = payload.mode;
      const result = await runHostFileMutation(hostId, () =>
        callHostOnlineRpc(deps, {
          hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command,
        }),
      );
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  post(fileRoutes.list, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const command: ListFilesCommand = {
        type: "host.list_files",
        path: payload.path,
        limit: payload.limit ?? HOST_FILE_LIST_LIMIT_DEFAULT,
      };
      if (payload.query !== undefined) command.query = payload.query;
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command,
      });
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  post(fileRoutes.listPaths, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const command: ListPathsCommand = {
        type: "host.list_paths",
        path: payload.path,
        limit: payload.limit ?? HOST_FILE_LIST_LIMIT_DEFAULT,
        includeFiles: payload.includeFiles,
        includeDirectories: payload.includeDirectories,
      };
      if (payload.query !== undefined) command.query = payload.query;
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command,
      });
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  post(fileRoutes.mkdir, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const command: MakeDirectoryCommand = {
        type: "host.mkdir",
        path: payload.path,
        recursive: payload.recursive ?? false,
      };
      if (payload.rootPath !== undefined) command.rootPath = payload.rootPath;
      const result = await runHostFileMutation(hostId, () =>
        callHostOnlineRpc(deps, {
          hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command,
        }),
      );
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  post(fileRoutes.move, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const command: MovePathCommand = {
        type: "host.move_path",
        sourcePath: payload.sourcePath,
        destinationPath: payload.destinationPath,
      };
      if (payload.rootPath !== undefined) command.rootPath = payload.rootPath;
      const result = await runHostFileMutation(hostId, () =>
        callHostOnlineRpc(deps, {
          hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command,
        }),
      );
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  post(fileRoutes.remove, async (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    try {
      const command: RemovePathCommand = {
        type: "host.remove_path",
        path: payload.path,
        recursive: payload.recursive ?? false,
      };
      if (payload.rootPath !== undefined) command.rootPath = payload.rootPath;
      const result = await runHostFileMutation(hostId, () =>
        callHostOnlineRpc(deps, {
          hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command,
        }),
      );
      return context.json(result);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });

  post(fileRoutes.createPreview, (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    if (!isAbsoluteHostPath(payload.rootPath)) {
      throw new ApiError(
        400,
        "invalid_path",
        "rootPath must be absolute",
        false,
      );
    }
    const now = Date.now();
    for (const [id, lease] of previewLeases) {
      if (lease.expiresAtMs <= now) previewLeases.delete(id);
    }
    const id = randomUUID();
    const expiresAtMs = now + (payload.ttlMs ?? FILE_PREVIEW_TTL_MS);
    previewLeases.set(id, {
      hostId,
      rootPath: normalizeHostPath(payload.rootPath),
      expiresAtMs,
    });
    return context.json({
      baseUrl: `/api/v1/file-previews/${encodeURIComponent(id)}`,
      expiresAtMs,
    });
  });

  get(previewRoutes.content, async (context) => {
    const id = context.req.param("id");
    const lease = previewLeases.get(id);
    if (!lease || lease.expiresAtMs <= Date.now()) {
      previewLeases.delete(id);
      throw new ApiError(404, "not_found", "File preview expired", false);
    }
    const rawPath = context.req.param("filePath").replace(/\\/g, "/");
    const segments = rawPath.split("/");
    if (
      rawPath.startsWith("/") ||
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    ) {
      throw new ApiError(400, "invalid_path", "Invalid preview path", false);
    }
    try {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId: lease.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.read_file",
          path: joinHostPath(lease.rootPath, segments),
          rootPath: lease.rootPath,
        },
      });
      const headers = new Headers({
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      if (isHtmlMimeType(result.mimeType)) {
        assertRawFilesystemHtmlPreviewResult(result);
        headers.set("content-security-policy", HTML_PREVIEW_CSP);
        headers.set("content-type", HTML_PREVIEW_CONTENT_TYPE);
      }
      return createDaemonFileContentResponse(result, { headers });
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  });
}
