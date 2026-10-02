import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import { COMMAND_TIMEOUT_MS } from "../constants.js";
import { ApiError } from "../errors.js";
import { browserRequestProblem } from "../browser-request-guard.js";
import type { AppDeps } from "../types.js";
import type { HostDaemonRpcCommand } from "@bb/host-daemon-contract";
import {
  callHostOnlineRpcForWork,
  callHostRetryableOnlineRpc,
} from "../services/hosts/online-rpc.js";
import {
  createDaemonFileContentResponse,
  requireDaemonFileContentResult,
  remapDaemonFileRouteError,
} from "../services/hosts/daemon-file-response.js";
import { serveDaemonFileStream } from "../services/hosts/daemon-file-stream.js";
import { createRawFileHeaders } from "../services/hosts/raw-file-headers.js";
import {
  assertUsableHostId,
  requirePrimaryHostId,
} from "../services/hosts/primary-host.js";
import {
  requirePublicProject,
  requireReadyEnvironment,
} from "../services/lib/entity-lookup.js";
import { resolveProjectWorkspaceTarget } from "../services/projects/project-workspace.js";
import {
  requireThreadEnvironmentHostId,
  requireThreadStorageTarget,
} from "../services/threads/thread-storage.js";
import {
  DEFAULT_PATH_LIST_EXCLUDE_NAMES,
  WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
} from "./path-list-policy.js";

const HOST_FILE_LIST_LIMIT_DEFAULT = 1000;

const FILE_PREVIEW_TTL_MS = 10 * 60 * 1000;
const REVISION_REF_PATTERN = /^(?:HEAD|[0-9a-f]{4,40})$/iu;
const WINDOWS_DRIVE_SEGMENT_PATTERN = /^[A-Za-z]:$/u;

interface FilePreviewLease {
  hostId: string;
  rootPath: string;
  expiresAtMs: number;
}

interface FileRoot {
  hostId: string;
  rootPath: string;
  ref: string | null;
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

function requireAbsoluteHostRoot(rootPath: string): string {
  if (!isAbsoluteHostPath(rootPath)) {
    throw new ApiError(400, "invalid_path", "rootPath must be absolute", false);
  }
  return normalizeHostPath(rootPath);
}

function createInvalidFilePathError(): ApiError {
  return new ApiError(400, "invalid_path", "Invalid file path", false);
}

function parseRelativeFileSegments(rawPath: string): string[] {
  const normalizedPath = rawPath.replace(/\\/g, "/");
  const segments = normalizedPath.split("/");
  if (
    normalizedPath.startsWith("/") ||
    normalizedPath.includes("\0") ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw createInvalidFilePathError();
  }
  return segments;
}

function parseAbsoluteHostFile(rawPath: string): {
  rootPath: string;
  segments: string[];
} {
  const segments = parseRelativeFileSegments(rawPath);
  const [firstSegment, ...rest] = segments;
  if (
    firstSegment === undefined ||
    !WINDOWS_DRIVE_SEGMENT_PATTERN.test(firstSegment)
  ) {
    return { rootPath: "/", segments };
  }
  if (rest.length === 0) {
    throw createInvalidFilePathError();
  }
  return { rootPath: `${firstSegment}\\`, segments: rest };
}

function parseRevisionRef(ref: string): string {
  if (!REVISION_REF_PATTERN.test(ref)) {
    throw new ApiError(400, "invalid_ref", "Invalid revision", false);
  }
  return ref;
}

async function serveRootedFile(
  deps: AppDeps,
  request: Request,
  root: FileRoot,
  segments: string[],
): Promise<Response> {
  const filePath = joinHostPath(root.rootPath, segments);
  if (root.ref === null) {
    return serveDaemonFileStream(
      deps,
      { hostId: root.hostId, path: filePath, rootPath: root.rootPath },
      request,
      createRawFileHeaders,
    );
  }
  const result = await callHostRetryableOnlineRpc(deps, {
    hostId: root.hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "host.read_file",
      path: filePath,
      rootPath: root.rootPath,
      ref: root.ref,
    },
  }).catch(remapDaemonFileRouteError);
  const content = requireDaemonFileContentResult(result);
  return createDaemonFileContentResponse(content, {
    headers: createRawFileHeaders(content),
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
  });
}

export function registerFileRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const fileRoutes = publicApiRoutes.files;
  const previewRoutes = publicApiRoutes.filePreviews;
  const threadRoutes = publicApiRoutes.threads;
  const environmentRoutes = publicApiRoutes.environments;
  const projectRoutes = publicApiRoutes.projects;
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

  const runHostFileMutationCommand = <TCommand extends HostDaemonRpcCommand>(
    hostId: string,
    command: TCommand,
  ) =>
    runHostFileMutation(hostId, () =>
      callHostOnlineRpcForWork(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command,
      }),
    );

  const withHostFileRoute = async <T>(
    hostIdInput: string | undefined,
    run: (hostId: string) => Promise<T>,
  ): Promise<T> => {
    const hostId = resolveHostId(hostIdInput);
    try {
      return await run(hostId);
    } catch (error) {
      return remapDaemonFileRouteError(error);
    }
  };

  post(fileRoutes.read, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
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
      return context.json(requireDaemonFileContentResult(result));
    }),
  );

  post(fileRoutes.write, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
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
        ...(payload.mode !== undefined ? { mode: payload.mode } : {}),
      });
      return context.json(result);
    }),
  );

  post(fileRoutes.list, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_files",
          path: payload.path,
          limit: payload.limit ?? HOST_FILE_LIST_LIMIT_DEFAULT,
          includeHidden:
            payload.includeHidden ?? WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
          respectGitIgnore: false,
          excludeNames: [
            ...(payload.excludeNames ?? DEFAULT_PATH_LIST_EXCLUDE_NAMES),
          ],
          ...(payload.query !== undefined ? { query: payload.query } : {}),
        },
      });
      return context.json(result);
    }),
  );

  post(fileRoutes.listPaths, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_paths",
          path: payload.path,
          limit: payload.limit ?? HOST_FILE_LIST_LIMIT_DEFAULT,
          includeFiles: payload.includeFiles,
          includeDirectories: payload.includeDirectories,
          includeHidden:
            payload.includeHidden ?? WORKSPACE_PATH_LIST_INCLUDE_HIDDEN,
          respectGitIgnore: false,
          excludeNames: [
            ...(payload.excludeNames ?? DEFAULT_PATH_LIST_EXCLUDE_NAMES),
          ],
          ...(payload.query !== undefined ? { query: payload.query } : {}),
        },
      });
      return context.json(result);
    }),
  );

  post(fileRoutes.mkdir, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.mkdir",
        path: payload.path,
        recursive: payload.recursive ?? false,
        ...(payload.rootPath !== undefined
          ? { rootPath: payload.rootPath }
          : {}),
      });
      return context.json(result);
    }),
  );

  post(fileRoutes.move, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.move_path",
        sourcePath: payload.sourcePath,
        destinationPath: payload.destinationPath,
        ...(payload.rootPath !== undefined
          ? { rootPath: payload.rootPath }
          : {}),
      });
      return context.json(result);
    }),
  );

  post(fileRoutes.remove, (context, payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.remove_path",
        path: payload.path,
        recursive: payload.recursive ?? false,
        ...(payload.rootPath !== undefined
          ? { rootPath: payload.rootPath }
          : {}),
      });
      return context.json(result);
    }),
  );

  post(fileRoutes.createPreview, (context, payload) => {
    const hostId = resolveHostId(payload.hostId);
    const rootPath = requireAbsoluteHostRoot(payload.rootPath);
    const now = Date.now();
    for (const [id, lease] of previewLeases) {
      if (lease.expiresAtMs <= now) previewLeases.delete(id);
    }
    const requestedExpiry = now + (payload.ttlMs ?? FILE_PREVIEW_TTL_MS);
    for (const [id, lease] of previewLeases) {
      if (lease.hostId === hostId && lease.rootPath === rootPath) {
        lease.expiresAtMs = Math.max(lease.expiresAtMs, requestedExpiry);
        return context.json({
          baseUrl: `/api/v1/file-previews/${encodeURIComponent(id)}`,
          expiresAtMs: lease.expiresAtMs,
        });
      }
    }
    const id = randomUUID();
    const expiresAtMs = requestedExpiry;
    previewLeases.set(id, { hostId, rootPath, expiresAtMs });
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
    return serveRootedFile(
      deps,
      context.req.raw,
      { hostId: lease.hostId, rootPath: lease.rootPath, ref: null },
      parseRelativeFileSegments(context.req.param("filePath")),
    );
  });

  get(threadRoutes.storageFile, async (context) => {
    const target = await requireThreadStorageTarget(
      deps,
      context.req.param("id"),
    );
    return serveRootedFile(
      deps,
      context.req.raw,
      { hostId: target.hostId, rootPath: target.storagePath, ref: null },
      parseRelativeFileSegments(context.req.param("filePath")),
    );
  });

  get(threadRoutes.hostFile, async (context) => {
    const hostId = requireThreadEnvironmentHostId(
      deps,
      context.req.param("id"),
    );
    const file = parseAbsoluteHostFile(context.req.param("filePath"));
    return serveRootedFile(
      deps,
      context.req.raw,
      { hostId, rootPath: file.rootPath, ref: null },
      file.segments,
    );
  });

  get(publicApiRoutes.hosts.file, async (context) => {
    const hostId = context.req.param("id");
    assertUsableHostId(deps, { hostId });
    const file = parseAbsoluteHostFile(context.req.param("filePath"));
    return serveRootedFile(
      deps,
      context.req.raw,
      { hostId, rootPath: file.rootPath, ref: null },
      file.segments,
    );
  });

  get(environmentRoutes.file, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    return serveRootedFile(
      deps,
      context.req.raw,
      { hostId: environment.hostId, rootPath: environment.path, ref: null },
      parseRelativeFileSegments(context.req.param("filePath")),
    );
  });

  get(environmentRoutes.revisionFile, async (context) => {
    const environment = requireReadyEnvironment(
      deps.db,
      context.req.param("id"),
    );
    return serveRootedFile(
      deps,
      context.req.raw,
      {
        hostId: environment.hostId,
        rootPath: environment.path,
        ref: parseRevisionRef(context.req.param("ref")),
      },
      parseRelativeFileSegments(context.req.param("filePath")),
    );
  });

  const serveProjectFile = (
    request: Request,
    projectId: string,
    hostId: string | undefined,
    filePath: string,
  ): Promise<Response> => {
    requirePublicProject(deps.db, projectId);
    const target = resolveProjectWorkspaceTarget(deps, {
      projectId,
      ...(hostId !== undefined ? { hostId } : {}),
    });
    return serveRootedFile(
      deps,
      request,
      { hostId: target.hostId, rootPath: target.path, ref: null },
      parseRelativeFileSegments(filePath),
    );
  };

  get(projectRoutes.file, async (context) =>
    serveProjectFile(
      context.req.raw,
      context.req.param("id"),
      undefined,
      context.req.param("filePath"),
    ),
  );

  get(projectRoutes.hostFile, async (context) =>
    serveProjectFile(
      context.req.raw,
      context.req.param("id"),
      context.req.param("hostId"),
      context.req.param("filePath"),
    ),
  );
}
