import { randomUUID } from "node:crypto";
import {
  getRelativeHostPathSegments,
  normalizeHostPath,
  splitHostPathRoot,
} from "@bb/domain";
import type { OperationBody } from "@bb/operations";
import { publicApiRoutes } from "@bb/server-contract";
import type { OperationRoutes } from "../kernel/http-door.js";
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
  createDaemonFileContentBody,
  requireDaemonFileContentResult,
  remapDaemonFileRouteError,
} from "../services/hosts/daemon-file-response.js";
import { serveDaemonFileStream } from "../services/hosts/daemon-file-stream.js";
import { joinHostPathSegments } from "../services/lib/host-path.js";
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

function requireAbsoluteHostRoot(rootPath: string): string {
  const normalizedRootPath = normalizeHostPath(rootPath);
  if (normalizedRootPath === null) {
    throw new ApiError(400, "invalid_path", "rootPath must be absolute", false);
  }
  return normalizedRootPath;
}

function parseRelativeFileSegments(rawPath: string): string[] {
  const segments = getRelativeHostPathSegments(rawPath.replace(/\\/g, "/"));
  if (segments === null) {
    throw new ApiError(400, "invalid_path", "Invalid file path", false);
  }
  return segments;
}

function parseAbsoluteHostFile(rawPath: string): {
  rootPath: string;
  segments: string[];
} {
  const filePath = rawPath.replace(/\\/g, "/");
  const { root, relativePath } = splitHostPathRoot(filePath) ?? {
    root: "/",
    relativePath: filePath,
  };
  return { rootPath: root, segments: parseRelativeFileSegments(relativePath) };
}

function parseRevisionRef(ref: string): string {
  if (!REVISION_REF_PATTERN.test(ref)) {
    throw new ApiError(400, "invalid_ref", "Invalid revision", false);
  }
  return ref;
}

const LOCAL_REQUEST_URL = "http://localhost/";

function requestOrLocal(request: Request | null, signal: AbortSignal): Request {
  return request ?? new Request(LOCAL_REQUEST_URL, { signal });
}

async function serveRootedFile(
  deps: AppDeps,
  request: Request,
  root: FileRoot,
  segments: string[],
): Promise<OperationBody> {
  const filePath = joinHostPathSegments(root.rootPath, ...segments);
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
      followRootSymlink: false,
      path: filePath,
      rootPath: root.rootPath,
      ref: root.ref,
    },
  }).catch(remapDaemonFileRouteError);
  const content = requireDaemonFileContentResult(result);
  return createDaemonFileContentBody(content, {
    headers: createRawFileHeaders(content),
    ifNoneMatch: request.headers.get("if-none-match") ?? undefined,
  });
}

export function registerFileRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
): void {
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
    operations.app.use(route.path, async (context, next) => {
      requirePrivilegedJsonMutation(context);
      await next();
    });
  }

  const runHostFileMutationCommand = <TCommand extends HostDaemonRpcCommand>(
    hostId: string,
    command: TCommand,
  ) =>
    callHostOnlineRpcForWork(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command,
    });

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

  operations.implement(fileRoutes.read, (payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.read_file",
          followRootSymlink: false,
          path: payload.path,
          ...(payload.rootPath !== undefined
            ? { rootPath: payload.rootPath }
            : {}),
          ...(payload.ref !== undefined ? { ref: payload.ref } : {}),
        },
      });
      return requireDaemonFileContentResult(result);
    }),
  );

  operations.implement(fileRoutes.write, (payload) =>
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
      return result;
    }),
  );

  operations.implement(fileRoutes.list, (payload, { signal }) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        signal,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "host.list_files",
          followRootSymlink: false,
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
      return result;
    }),
  );

  operations.implement(fileRoutes.listPaths, (payload, { signal }) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await callHostRetryableOnlineRpc(deps, {
        hostId,
        signal,
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
      return result;
    }),
  );

  operations.implement(fileRoutes.mkdir, (payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.mkdir",
        path: payload.path,
        recursive: payload.recursive ?? false,
        ...(payload.rootPath !== undefined
          ? { rootPath: payload.rootPath }
          : {}),
      });
      return result;
    }),
  );

  operations.implement(fileRoutes.move, (payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.move_path",
        sourcePath: payload.sourcePath,
        destinationPath: payload.destinationPath,
        ...(payload.rootPath !== undefined
          ? { rootPath: payload.rootPath }
          : {}),
      });
      return result;
    }),
  );

  operations.implement(fileRoutes.remove, (payload) =>
    withHostFileRoute(payload.hostId, async (hostId) => {
      const result = await runHostFileMutationCommand(hostId, {
        type: "host.remove_path",
        path: payload.path,
        recursive: payload.recursive ?? false,
        ...(payload.rootPath !== undefined
          ? { rootPath: payload.rootPath }
          : {}),
      });
      return result;
    }),
  );

  operations.implement(fileRoutes.createPreview, (payload) => {
    const hostId = resolveHostId(payload.hostId);
    const rootPath = requireAbsoluteHostRoot(payload.rootPath);
    const now = Date.now();
    for (const [id, lease] of previewLeases) {
      if (lease.expiresAtMs <= now) previewLeases.delete(id);
    }
    const id = randomUUID();
    const expiresAtMs = now + (payload.ttlMs ?? FILE_PREVIEW_TTL_MS);
    previewLeases.set(id, { hostId, rootPath, expiresAtMs });
    return {
      baseUrl: `/api/v1/file-previews/${encodeURIComponent(id)}`,
      expiresAtMs,
    };
  });

  operations.implement(
    previewRoutes.content,
    async ({ id, filePath }, { request, signal }) => {
      const lease = previewLeases.get(id);
      if (!lease || lease.expiresAtMs <= Date.now()) {
        previewLeases.delete(id);
        throw new ApiError(404, "not_found", "File preview expired", false);
      }
      return serveRootedFile(
        deps,
        requestOrLocal(request, signal),
        { hostId: lease.hostId, rootPath: lease.rootPath, ref: null },
        parseRelativeFileSegments(filePath),
      );
    },
  );

  operations.implement(
    threadRoutes.storageFile,
    async ({ id, filePath }, { request, signal }) => {
      const target = await requireThreadStorageTarget(deps, id);
      return serveRootedFile(
        deps,
        requestOrLocal(request, signal),
        { hostId: target.hostId, rootPath: target.storagePath, ref: null },
        parseRelativeFileSegments(filePath),
      );
    },
  );

  operations.implement(
    threadRoutes.hostFile,
    async ({ id, filePath }, { request, signal }) => {
      const hostId = requireThreadEnvironmentHostId(deps, id);
      const file = parseAbsoluteHostFile(filePath);
      return serveRootedFile(
        deps,
        requestOrLocal(request, signal),
        { hostId, rootPath: file.rootPath, ref: null },
        file.segments,
      );
    },
  );

  operations.implement(
    publicApiRoutes.hosts.file,
    async ({ id: hostId, filePath }, { request, signal }) => {
      assertUsableHostId(deps, { hostId });
      const file = parseAbsoluteHostFile(filePath);
      return serveRootedFile(
        deps,
        requestOrLocal(request, signal),
        { hostId, rootPath: file.rootPath, ref: null },
        file.segments,
      );
    },
  );

  operations.implement(
    environmentRoutes.file,
    async ({ id, filePath }, { request, signal }) => {
      const environment = requireReadyEnvironment(deps.db, id);
      return serveRootedFile(
        deps,
        requestOrLocal(request, signal),
        { hostId: environment.hostId, rootPath: environment.path, ref: null },
        parseRelativeFileSegments(filePath),
      );
    },
  );

  operations.implement(
    environmentRoutes.revisionFile,
    async ({ id, ref, filePath }, { request, signal }) => {
      const environment = requireReadyEnvironment(deps.db, id);
      return serveRootedFile(
        deps,
        requestOrLocal(request, signal),
        {
          hostId: environment.hostId,
          rootPath: environment.path,
          ref: parseRevisionRef(ref),
        },
        parseRelativeFileSegments(filePath),
      );
    },
  );

  const serveProjectFile = (
    request: Request,
    projectId: string,
    hostId: string | undefined,
    filePath: string,
  ): Promise<OperationBody> => {
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

  operations.implement(
    projectRoutes.file,
    async ({ id, filePath }, { request, signal }) =>
      serveProjectFile(
        requestOrLocal(request, signal),
        id,
        undefined,
        filePath,
      ),
  );

  operations.implement(
    projectRoutes.hostFile,
    async ({ id, hostId, filePath }, { request, signal }) =>
      serveProjectFile(requestOrLocal(request, signal), id, hostId, filePath),
  );
}
