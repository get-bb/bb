import {
  THREAD_SEARCH_LIMIT_PER_GROUP_DEFAULT,
  THREAD_SEARCH_LIMIT_PER_GROUP_MAX,
  countNonDeletedAssignedChildThreads,
  disableAutomationsForDeletedThread,
  getEnvironment,
  getThreadFolderById,
  listThreadsWithPendingInteractionState,
  markThreadDeleted,
  searchThreadsWithPendingInteractionState,
  updateThread,
  type ThreadSearchResultGroup as DbThreadSearchResultGroup,
  type UpdateThreadInput,
} from "@bb/db";
import type { Environment, Thread, ThreadListEntry } from "@bb/domain";
import {
  threadIncludeOptionSchema,
  publicApiRoutes,
  typedRoutes,
  type ThreadGetQuery,
  type ThreadIncludeOption,
  type ThreadChildSummaryResponse,
  type ThreadSearchResponse,
  type ThreadWithIncludesResponse,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { parseOptionalInteger } from "../../services/lib/validation.js";
import {
  requestEnvironmentCleanup,
  requestEnvironmentCleanupAdvance,
} from "../../services/environments/environment-cleanup-internal.js";
import {
  getNonDestroyedHostWithStatus,
  requireEnvironment,
  requirePublicProject,
  requirePublicThread,
} from "../../services/lib/entity-lookup.js";
import { dispatchThreadRenameCommand } from "../../services/threads/thread-commands.js";
import {
  finalizeStoppedThread,
  requestActiveRuntimeThreadStopIfNeeded,
} from "../../services/threads/thread-lifecycle.js";
import { createThreadFromRequest } from "../../services/threads/thread-create.js";
import { requireChildThreadsConfirmation } from "../../services/threads/child-thread-confirmation.js";
import {
  toThreadListEntryResponses,
  toThreadResponseFromThread,
} from "../../services/threads/thread-runtime-display.js";
import { assertValidParentThread } from "../../services/threads/thread-parent.js";
import { handleThreadOwnershipChange } from "../../services/threads/thread-ownership.js";
import { applyThreadExecutionOverride } from "../../services/threads/thread-execution-override.js";

function parseThreadIncludes(query: ThreadGetQuery): Set<ThreadIncludeOption> {
  const includes = new Set<ThreadIncludeOption>();
  if (!query.include) {
    return includes;
  }
  for (const value of query.include.split(",")) {
    includes.add(threadIncludeOptionSchema.parse(value));
  }
  return includes;
}

interface BuildThreadResponseArgs {
  includes: Set<ThreadIncludeOption>;
  thread: Thread;
}

type ThreadSearchResultGroupResponse = ThreadSearchResponse["active"];

interface BuildThreadSearchGroupResponseArgs {
  group: DbThreadSearchResultGroup;
}

interface BuildThreadSearchResponseArgs {
  active: DbThreadSearchResultGroup;
  archived: DbThreadSearchResultGroup;
}

function resolveIncludedThreadEnvironment(
  deps: Pick<AppDeps, "db">,
  thread: Thread,
): Environment | null {
  if (thread.environmentId === null) {
    return null;
  }
  return getEnvironment(deps.db, thread.environmentId);
}

function buildThreadResponse(
  deps: AppDeps,
  args: BuildThreadResponseArgs,
): ThreadWithIncludesResponse {
  const response: ThreadWithIncludesResponse = toThreadResponseFromThread(
    deps,
    {
      thread: args.thread,
    },
  );
  const shouldResolveEnvironment =
    args.includes.has("environment") || args.includes.has("host");
  const environment = shouldResolveEnvironment
    ? resolveIncludedThreadEnvironment(deps, args.thread)
    : null;

  if (args.includes.has("environment")) {
    response.environment = environment;
  }
  if (args.includes.has("host")) {
    response.host = environment
      ? getNonDestroyedHostWithStatus(deps.db, environment.hostId)
      : null;
  }
  return response;
}

function countNonWhitespaceChars(value: string): number {
  return value.replaceAll(/\s/gu, "").length;
}

function parseSearchLimitPerGroup(value: string | undefined): number {
  const limit =
    value === undefined
      ? THREAD_SEARCH_LIMIT_PER_GROUP_DEFAULT
      : parseOptionalInteger(value, "limitPerGroup");
  if (limit === undefined) {
    return THREAD_SEARCH_LIMIT_PER_GROUP_DEFAULT;
  }
  if (limit <= 0) {
    throw new ApiError(
      400,
      "invalid_request",
      "limitPerGroup must be positive",
    );
  }
  if (limit > THREAD_SEARCH_LIMIT_PER_GROUP_MAX) {
    throw new ApiError(
      400,
      "invalid_request",
      `limitPerGroup must be at most ${THREAD_SEARCH_LIMIT_PER_GROUP_MAX}`,
    );
  }
  return limit;
}

function requireThreadFolder(
  deps: Pick<AppDeps, "db">,
  folderId: string,
): void {
  if (!getThreadFolderById(deps.db, folderId)) {
    throw new ApiError(404, "folder_not_found", "Folder not found");
  }
}

function buildThreadSearchGroupResponse(
  deps: AppDeps,
  args: BuildThreadSearchGroupResponseArgs,
): ThreadSearchResultGroupResponse {
  const threadEntries = toThreadListEntryResponses(deps, {
    threads: args.group.results.map((result) => result.thread),
  });
  const threadEntriesById = new Map(
    threadEntries.map((thread) => [thread.id, thread]),
  );

  return {
    total: args.group.total,
    results: args.group.results.flatMap((result) => {
      const thread = threadEntriesById.get(result.thread.id);
      if (thread === undefined) {
        return [];
      }
      return [{ thread, matches: result.matches }];
    }),
  };
}

function buildThreadSearchResponse(
  deps: AppDeps,
  args: BuildThreadSearchResponseArgs,
): ThreadSearchResponse {
  return {
    active: buildThreadSearchGroupResponse(deps, { group: args.active }),
    archived: buildThreadSearchGroupResponse(deps, { group: args.archived }),
  };
}

export function registerThreadBaseRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.list, (context, query) => {
    const limit = parseOptionalInteger(query.limit, "limit");
    if (limit !== undefined && limit <= 0) {
      throw new ApiError(400, "invalid_request", "limit must be positive");
    }
    const offset = parseOptionalInteger(query.offset, "offset");
    if (offset !== undefined && offset < 0) {
      throw new ApiError(400, "invalid_request", "offset must be non-negative");
    }
    if (query.projectId) {
      requirePublicProject(deps.db, query.projectId);
    }
    if (query.folderId && query.unfiled === "true") {
      throw new ApiError(
        400,
        "invalid_request",
        "folderId and unfiled cannot be used together",
      );
    }
    if (query.folderId) {
      requireThreadFolder(deps, query.folderId);
    }
    const threads = listThreadsWithPendingInteractionState(deps.db, {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.parentThreadId ? { parentThreadId: query.parentThreadId } : {}),
      ...(query.sourceThreadId ? { sourceThreadId: query.sourceThreadId } : {}),
      ...(query.folderId ? { folderId: query.folderId } : {}),
      ...(query.unfiled === "true" ? { unfiled: true } : {}),
      ...(query.originKind ? { originKind: query.originKind } : {}),
      ...(query.excludeSideChats === "true" ? { excludeSideChats: true } : {}),
      ...(query.childOrigin ? { childOrigin: query.childOrigin } : {}),
      archived:
        query.archived === undefined ? undefined : query.archived === "true",
      hasParent:
        query.hasParent === undefined ? undefined : query.hasParent === "true",
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
    });
    return context.json(
      toThreadListEntryResponses(deps, { threads }) satisfies ThreadListEntry[],
    );
  });

  get(routes.search, (context, query) => {
    const searchQuery = query.query.trim();
    if (countNonWhitespaceChars(searchQuery) < 2) {
      throw new ApiError(
        400,
        "invalid_request",
        "query must contain at least two non-whitespace characters",
      );
    }
    const limitPerGroup = parseSearchLimitPerGroup(query.limitPerGroup);
    return context.json(
      buildThreadSearchResponse(deps, {
        ...searchThreadsWithPendingInteractionState(deps.db, {
          query: searchQuery,
          limitPerGroup,
        }),
      }) satisfies ThreadSearchResponse,
    );
  });

  post(routes.create, async (context, payload) => {
    if (payload.folderId) {
      requireThreadFolder(deps, payload.folderId);
    }
    const thread = await createThreadFromRequest(deps, {
      ...payload,
      origin: payload.origin,
    });
    return context.json(toThreadResponseFromThread(deps, { thread }), 201);
  });

  get(routes.get, (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      buildThreadResponse(deps, {
        includes: parseThreadIncludes(query),
        thread,
      }),
    );
  });

  function getThreadChildSummary(threadId: string): ThreadChildSummaryResponse {
    const nonDeletedChildCount = countNonDeletedAssignedChildThreads(deps.db, {
      parentThreadId: threadId,
    });
    return {
      nonDeletedChildCount,
    };
  }

  get(routes.childSummary, (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(getThreadChildSummary(thread.id));
  });

  patch(routes.update, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    if (payload.parentThreadId) {
      assertValidParentThread(deps, {
        childThreadId: thread.id,
        parentThreadId: payload.parentThreadId,
        projectId: thread.projectId,
      });
    }

    // Sticky execution override (model / reasoning level). Validated and
    // persisted by a dedicated service — kept off the generic metadata update
    // because execution config must not flow through `updateThread`.
    if ("model" in payload || "reasoningLevel" in payload) {
      await applyThreadExecutionOverride(deps, {
        thread,
        patch: {
          ...("model" in payload ? { model: payload.model } : {}),
          ...("reasoningLevel" in payload
            ? { reasoningLevel: payload.reasoningLevel }
            : {}),
        },
      });
    }

    const metadataUpdate: UpdateThreadInput = {};
    if ("title" in payload) {
      metadataUpdate.title = payload.title;
    }
    const folderId = payload.folderId;
    if (folderId !== undefined) {
      if (folderId !== null) {
        requireThreadFolder(deps, folderId);
      }
      metadataUpdate.folderId = folderId;
    }
    if ("parentThreadId" in payload) {
      metadataUpdate.parentThreadId = payload.parentThreadId;
    }
    const updated =
      Object.keys(metadataUpdate).length > 0
        ? updateThread(deps.db, deps.hub, thread.id, metadataUpdate)
        : requirePublicThread(deps.db, thread.id);
    if (!updated) {
      throw new ApiError(404, "thread_not_found", "Thread not found");
    }

    if (
      payload.title &&
      payload.title !== thread.title &&
      updated.environmentId
    ) {
      const environment = requireEnvironment(deps.db, updated.environmentId);
      if (environment.status === "ready" && environment.path) {
        dispatchThreadRenameCommand(deps, {
          environment: {
            id: environment.id,
            hostId: environment.hostId,
          },
          providerId: updated.providerId,
          threadId: updated.id,
          title: payload.title,
        });
      }
    }

    if (
      "parentThreadId" in payload &&
      payload.parentThreadId !== thread.parentThreadId
    ) {
      await handleThreadOwnershipChange(deps, {
        previousThread: thread,
        queueParentMessages: true,
        updatedThread: updated,
      });
    }

    return context.json(toThreadResponseFromThread(deps, { thread: updated }));
  });

  del(routes.delete, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    requireChildThreadsConfirmation({
      action: "delete",
      confirmed: payload.childThreadsConfirmed,
      deps,
      thread,
    });
    markThreadDeleted(deps.db, deps.hub, { threadId: thread.id });
    // Automations that re-prompt this thread are disabled (never deleted) so the
    // schedule stays visible; notify each affected project so live views update.
    const disabledAutomations = disableAutomationsForDeletedThread(deps.db, {
      threadId: thread.id,
      now: Date.now(),
    });
    for (const projectId of new Set(
      disabledAutomations.map((automation) => automation.projectId),
    )) {
      deps.hub.notifyProject(projectId, ["automations-changed"]);
    }
    deps.terminalSessions.closeDeletedThreadTerminals({ threadId: thread.id });
    if (thread.environmentId === null) {
      finalizeStoppedThread(deps, {
        threadId: thread.id,
      });
      return context.json({ ok: true });
    }

    const environment = requireEnvironment(deps.db, thread.environmentId);
    // Deletion finalization owns non-runtime cleanup; only active runtime work
    // needs a daemon stop request here.
    requestActiveRuntimeThreadStopIfNeeded(deps, thread, environment);
    finalizeStoppedThread(deps, {
      threadId: thread.id,
    });
    requestEnvironmentCleanup(deps, {
      environmentId: environment.id,
    });
    requestEnvironmentCleanupAdvance(deps, {
      environmentId: environment.id,
    });
    return context.json({ ok: true });
  });
}
