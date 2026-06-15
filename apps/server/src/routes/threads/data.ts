import path from "node:path";
import { listQueuedThreadMessages } from "@bb/db";
import type { Hono } from "hono";
import { PROMPT_HISTORY_ENTRY_LIMIT, threadEventTypeSchema } from "@bb/domain";
import {
  promptHistoryQuerySchema,
  threadHostFileContentQuerySchema,
  threadStorageContentQuerySchema,
  threadStorageFilesQuerySchema,
  threadStoragePathsQuerySchema,
  threadEventWaitQuerySchema,
  threadEventsQuerySchema,
  threadTimelineQuerySchema,
  timelineTurnSummaryDetailsQuerySchema,
  typedRoutes,
  type PublicApiSchema,
  type ThreadComposerBootstrapResponse,
  type ThreadTimelineQuery,
} from "@bb/server-contract";
import type {
  AppDeps,
  LoggedWorkSessionDeps,
  WorkSessionDeps,
} from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import {
  requireEnvironment,
  requirePublicThread,
  requireReadyEnvironment,
} from "../../services/lib/entity-lookup.js";
import {
  threadEnvironmentUnavailableDetails,
  throwThreadEnvironmentUnavailable,
} from "../../services/lib/lifecycle-api-errors.js";
import { callHostRetryableOnlineRpc } from "../../services/hosts/online-rpc.js";
import {
  createDaemonFileContentResponse,
  type DaemonFileReadResult,
  remapDaemonFileRouteError,
} from "../../services/hosts/daemon-file-response.js";
import { requireThreadStoragePath } from "../../services/threads/thread-storage.js";
import { toThreadQueuedMessage } from "../../services/threads/thread-queued-messages.js";
import {
  buildThreadTimeline,
  buildTimelineTurnSummaryDetails,
  THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
  THREAD_TIMELINE_SEGMENT_LIMIT_MAX,
  type ThreadTimelinePageKind,
  type ThreadTimelinePageRequest,
} from "../../services/threads/timeline.js";
import {
  findThreadEvent,
  getLastThreadOutput,
  listThreadEventRows,
} from "../../services/threads/thread-data.js";
import { resolveSystemExecutionOptions } from "../../services/system/execution-options.js";
import { listThreadPromptHistory } from "../../services/prompt-history.js";
import { tryResolveExistingThreadExecutionPlan } from "../../services/threads/thread-execution-plan.js";
import {
  parseBoundedPositiveOptionalInteger,
  parseInteger,
  parseOptionalInteger,
} from "../../services/lib/validation.js";
import { parsePathKindInclusion } from "../path-list-inclusion.js";
import { parseFileListLimit } from "../file-list-query.js";
import { parseSafeRelativeRoutePath } from "../relative-route-path.js";

interface ThreadComposerExecutionOptionsSource {
  archivedAt: number | null;
  environmentId: string | null;
}

interface ShouldResolveThreadComposerExecutionOptionsArgs {
  thread: ThreadComposerExecutionOptionsSource;
}

function shouldResolveThreadComposerExecutionOptions({
  thread,
}: ShouldResolveThreadComposerExecutionOptionsArgs): boolean {
  return thread.archivedAt === null && thread.environmentId !== null;
}

async function buildThreadComposerBootstrapResponse(
  deps: AppDeps,
  threadId: string,
): Promise<ThreadComposerBootstrapResponse> {
  const thread = requirePublicThread(deps.db, threadId);
  const defaultExecutionOptions =
    (
      await tryResolveExistingThreadExecutionPlan(deps, {
        executionSource: "client/turn/requested",
        input: {},
        threadId,
      })
    )?.defaultView ?? null;
  const composerEnvironmentId = shouldResolveThreadComposerExecutionOptions({
    thread,
  })
    ? thread.environmentId
    : null;
  // Null when we deliberately skip resolution (archived / environment-less
  // threads). Resolving hits the host via live provider.list + list_models
  // RPCs, so we only pay that cost when the thread has a live environment whose
  // composer can actually use the list. Null (not an empty object) keeps
  // "not resolved" distinct from "resolved to nothing".
  const executionOptions = composerEnvironmentId
    ? await resolveSystemExecutionOptions(deps, {
        environmentId: composerEnvironmentId,
        providerId: thread.providerId,
      })
    : null;
  return {
    defaultExecutionOptions,
    queuedMessages: listQueuedThreadMessages(deps.db, threadId).map(
      toThreadQueuedMessage,
    ),
    executionOptions,
    pendingInteractions:
      deps.pendingInteractions.listPendingThreadInteractions(threadId),
    promptHistory: listThreadPromptHistory(deps, {
      threadId,
      limit: PROMPT_HISTORY_ENTRY_LIMIT,
    }),
  };
}

function validateFilePath(filePath: string): void {
  if (
    filePath.startsWith("/") ||
    filePath.split("/").includes("..") ||
    filePath.split("\\").includes("..")
  ) {
    throw new ApiError(400, "invalid_request", "Invalid file path");
  }
}

export interface ThreadStorageTarget {
  hostId: string;
  storagePath: string;
}

interface RequireThreadStorageTargetArgs {
  threadId: string;
}

const RAW_FILE_NO_STORE_CACHE_CONTROL = "no-store";
const RAW_FILE_HTML_CONTENT_TYPE = "text/html; charset=utf-8";
const RAW_FILE_CONTENT_TYPE_OPTIONS = "nosniff";
const HTML_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const GENERIC_HTML_PREVIEW_CSP = "sandbox allow-scripts";

function parseThreadTimelineSegmentLimit(
  defaultLimit: number,
  rawLimit: string | undefined,
): number {
  const limit = parseOptionalInteger(rawLimit, "segmentLimit") ?? defaultLimit;
  if (limit <= 0) {
    throw new ApiError(
      400,
      "invalid_request",
      "segmentLimit must be a positive integer",
    );
  }
  if (limit > THREAD_TIMELINE_SEGMENT_LIMIT_MAX) {
    throw new ApiError(
      400,
      "invalid_request",
      `segmentLimit must be less than or equal to ${THREAD_TIMELINE_SEGMENT_LIMIT_MAX}`,
    );
  }
  return limit;
}

function parseThreadTimelinePage(
  query: ThreadTimelineQuery,
): ThreadTimelinePageRequest {
  const hasBeforeAnchorSeq = query.beforeAnchorSeq !== undefined;
  const kind: ThreadTimelinePageKind = hasBeforeAnchorSeq ? "older" : "latest";
  const segmentLimit = parseThreadTimelineSegmentLimit(
    THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
    query.segmentLimit,
  );

  if (kind === "latest") {
    return {
      kind,
      segmentLimit,
    };
  }

  if (
    query.beforeAnchorSeq === undefined ||
    query.beforeAnchorId === undefined
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "beforeAnchorSeq and beforeAnchorId must be provided together",
    );
  }

  return {
    beforeCursor: {
      anchorSeq: parseInteger(query.beforeAnchorSeq, "beforeAnchorSeq"),
      anchorId: query.beforeAnchorId,
    },
    kind,
    segmentLimit,
  };
}

export async function requireThreadStorageTarget(
  deps: WorkSessionDeps,
  args: RequireThreadStorageTargetArgs,
): Promise<ThreadStorageTarget> {
  const thread = requirePublicThread(deps.db, args.threadId);
  if (!thread.environmentId) {
    throwThreadEnvironmentUnavailable(
      threadEnvironmentUnavailableDetails("never_attached", null),
    );
  }
  const environment = requireEnvironment(deps.db, thread.environmentId);
  return {
    hostId: environment.hostId,
    storagePath: await requireThreadStoragePath(deps, {
      hostId: environment.hostId,
      threadId: thread.id,
    }),
  };
}

function isHtmlPreviewPath(relativePath: string): boolean {
  return relativePath.toLowerCase().endsWith(".html");
}

function assertHtmlPreviewSize(relativePath: string, sizeBytes: number): void {
  if (isHtmlPreviewPath(relativePath) && sizeBytes > HTML_PREVIEW_MAX_BYTES) {
    throw new ApiError(
      413,
      "file_too_large",
      "HTML preview exceeds the 5 MB limit",
      false,
    );
  }
}

function createRawFilePreviewResponse(
  result: DaemonFileReadResult,
  relativePath: string,
): Response {
  assertHtmlPreviewSize(relativePath, result.sizeBytes);
  const headers = new Headers({
    "cache-control": RAW_FILE_NO_STORE_CACHE_CONTROL,
    "x-content-type-options": RAW_FILE_CONTENT_TYPE_OPTIONS,
  });
  if (isHtmlPreviewPath(relativePath)) {
    headers.set("content-security-policy", GENERIC_HTML_PREVIEW_CSP);
    headers.set("content-type", RAW_FILE_HTML_CONTENT_TYPE);
  }
  return createDaemonFileContentResponse(result, { headers });
}

async function serveThreadStorageRawFile(
  deps: LoggedWorkSessionDeps,
  threadId: string,
  rawPath: string,
): Promise<Response> {
  const filePath = parseSafeRelativeRoutePath(rawPath);
  const target = await requireThreadStorageTarget(deps, { threadId });

  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: target.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file",
        path: path.join(target.storagePath, filePath.relativePath),
        rootPath: target.storagePath,
      },
    });
    return createRawFilePreviewResponse(result, filePath.relativePath);
  } catch (error) {
    return remapDaemonFileRouteError(error);
  }
}

async function serveThreadWorktreeRawFile(
  deps: LoggedWorkSessionDeps,
  threadId: string,
  rawPath: string,
): Promise<Response> {
  const filePath = parseSafeRelativeRoutePath(rawPath);
  const thread = requirePublicThread(deps.db, threadId);
  if (!thread.environmentId) {
    throw new ApiError(409, "invalid_request", "Thread has no environment");
  }
  const environment = requireReadyEnvironment(deps.db, thread.environmentId);

  try {
    const result = await callHostRetryableOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.read_file",
        path: path.join(environment.path, filePath.relativePath),
        rootPath: environment.path,
      },
    });
    return createRawFilePreviewResponse(result, filePath.relativePath);
  } catch (error) {
    return remapDaemonFileRouteError(error);
  }
}

export function registerThreadDataRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/threads/:id/timeline", threadTimelineQuerySchema, (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      buildThreadTimeline(deps.db, thread, {
        isDevelopment: deps.config.isDevelopment,
        includeNestedRows: query.includeNestedRows === "true",
        page: parseThreadTimelinePage(query),
        summaryOnly: query.summaryOnly === "true",
      }),
    );
  });

  get(
    "/threads/:id/timeline/turn-summary-details",
    timelineTurnSummaryDetailsQuerySchema,
    (context, query) => {
      const thread = requirePublicThread(deps.db, context.req.param("id"));
      return context.json(
        buildTimelineTurnSummaryDetails(deps.db, thread, {
          isDevelopment: deps.config.isDevelopment,
          turnId: query.turnId,
          sourceSeqStart: parseInteger(query.sourceSeqStart, "sourceSeqStart"),
          sourceSeqEnd: parseInteger(query.sourceSeqEnd, "sourceSeqEnd"),
        }),
      );
    },
  );

  get("/threads/:id/output", (context) => {
    requirePublicThread(deps.db, context.req.param("id"));
    return context.json({
      output: getLastThreadOutput(deps.db, context.req.param("id")),
    });
  });

  get("/threads/:id/composer-bootstrap", async (context) =>
    context.json(
      await buildThreadComposerBootstrapResponse(deps, context.req.param("id")),
    ),
  );

  get("/threads/:id/queued-messages", (context) => {
    const threadId = context.req.param("id");
    requirePublicThread(deps.db, threadId);
    return context.json(
      listQueuedThreadMessages(deps.db, threadId).map(toThreadQueuedMessage),
    );
  });

  get(
    "/threads/:id/prompt-history",
    promptHistoryQuerySchema,
    (context, query) => {
      const threadId = context.req.param("id");
      requirePublicThread(deps.db, threadId);
      const limit = parseBoundedPositiveOptionalInteger({
        defaultValue: PROMPT_HISTORY_ENTRY_LIMIT,
        max: PROMPT_HISTORY_ENTRY_LIMIT,
        name: "limit",
        value: query.limit,
      });

      return context.json(
        listThreadPromptHistory(deps, {
          threadId,
          limit,
        }),
      );
    },
  );

  get("/threads/:id/events", threadEventsQuerySchema, (context, query) => {
    requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      listThreadEventRows(deps.db, {
        threadId: context.req.param("id"),
        afterSeq: parseOptionalInteger(query.afterSeq, "afterSeq"),
        limit: parseOptionalInteger(query.limit, "limit") ?? 100,
      }),
    );
  });

  get(
    "/threads/:id/events/wait",
    threadEventWaitQuerySchema,
    async (context, query) => {
      const threadId = context.req.param("id");
      requirePublicThread(deps.db, threadId);

      const afterSeq = parseOptionalInteger(query.afterSeq, "afterSeq");
      const waitMs = Math.min(
        parseOptionalInteger(query.waitMs, "waitMs") ?? 30_000,
        60_000,
      );
      const parsedEventType = threadEventTypeSchema.safeParse(query.type);
      if (!parsedEventType.success) {
        throw new ApiError(400, "invalid_request", "Invalid event type");
      }
      const eventType = parsedEventType.data;

      const findMatch = () =>
        findThreadEvent(deps.db, { threadId, type: eventType, afterSeq });

      const deadline = Date.now() + waitMs;
      let match = findMatch();
      while (!match) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        const waiter = deps.hub.registerThreadEventWaiter(threadId, remaining);
        match = findMatch();
        if (match) {
          waiter.cancel();
          break;
        }
        await waiter.promise;
        match = findMatch();
      }

      if (!match) {
        return new Response(null, { status: 204 });
      }

      return context.json(match);
    },
  );

  get("/threads/:id/default-execution-options", async (context) => {
    const threadId = context.req.param("id");
    requirePublicThread(deps.db, threadId);
    return context.json(
      (
        await tryResolveExistingThreadExecutionPlan(deps, {
          executionSource: "client/turn/requested",
          input: {},
          threadId,
        })
      )?.defaultView ?? null,
    );
  });

  // Generic iframe previews use path-shaped raw URLs so relative links resolve
  // beside the HTML file. These routes never inject app bridge globals.
  // `:filePath{.+}` matches across slashes; hono percent-decodes it once.
  get("/threads/:id/worktree/files/:filePath{.+}", async (context) =>
    serveThreadWorktreeRawFile(
      deps,
      context.req.param("id"),
      context.req.param("filePath"),
    ),
  );

  get(
    "/threads/:id/thread-storage/files",
    threadStorageFilesQuerySchema,
    async (context, query) => {
      const target = await requireThreadStorageTarget(deps, {
        threadId: context.req.param("id"),
      });
      const limit = parseFileListLimit(query.limit);

      try {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId: target.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "host.list_files",
            path: target.storagePath,
            ...(query.query ? { query: query.query } : {}),
            limit,
          },
        });
        return context.json({
          files: result.files,
          truncated: result.truncated,
          storageRootPath: target.storagePath,
        });
      } catch (error) {
        if (error instanceof ApiError && error.body.code === "ENOENT") {
          return context.json({
            files: [],
            truncated: false,
            storageRootPath: target.storagePath,
          });
        }
        throw error;
      }
    },
  );

  get("/threads/:id/thread-storage/files/:filePath{.+}", async (context) =>
    serveThreadStorageRawFile(
      deps,
      context.req.param("id"),
      context.req.param("filePath"),
    ),
  );

  get(
    "/threads/:id/thread-storage/paths",
    threadStoragePathsQuerySchema,
    async (context, query) => {
      const target = await requireThreadStorageTarget(deps, {
        threadId: context.req.param("id"),
      });
      const limit = parseFileListLimit(query.limit);
      const inclusion = parsePathKindInclusion({
        includeFiles: query.includeFiles,
        includeDirectories: query.includeDirectories,
      });

      try {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId: target.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "host.list_paths",
            path: target.storagePath,
            ...(query.query ? { query: query.query } : {}),
            limit,
            includeFiles: inclusion.includeFiles,
            includeDirectories: inclusion.includeDirectories,
          },
        });
        return context.json({
          paths: result.paths,
          truncated: result.truncated,
          storageRootPath: target.storagePath,
        });
      } catch (error) {
        if (error instanceof ApiError && error.body.code === "ENOENT") {
          return context.json({
            paths: [],
            truncated: false,
            storageRootPath: target.storagePath,
          });
        }
        throw error;
      }
    },
  );

  get(
    "/threads/:id/thread-storage/content",
    threadStorageContentQuerySchema,
    async (context, query) => {
      validateFilePath(query.path);
      const target = await requireThreadStorageTarget(deps, {
        threadId: context.req.param("id"),
      });

      try {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId: target.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "host.read_file",
            path: path.join(target.storagePath, query.path),
            rootPath: target.storagePath,
          },
        });
        return createDaemonFileContentResponse(result);
      } catch (error) {
        return remapDaemonFileRouteError(error);
      }
    },
  );

  get(
    "/threads/:id/host-files/content",
    threadHostFileContentQuerySchema,
    async (context, query) => {
      const thread = requirePublicThread(deps.db, context.req.param("id"));
      if (!thread.environmentId) {
        throwThreadEnvironmentUnavailable(
          threadEnvironmentUnavailableDetails("never_attached", null),
        );
      }
      const environment = requireEnvironment(deps.db, thread.environmentId);

      try {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId: environment.hostId,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "host.read_file",
            path: query.path,
          },
        });
        return createDaemonFileContentResponse(result);
      } catch (error) {
        return remapDaemonFileRouteError(error);
      }
    },
  );
}
