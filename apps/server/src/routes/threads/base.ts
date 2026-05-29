import {
  countNonDeletedAssignedChildThreads,
  getEnvironment,
  listThreadsWithPendingInteractionState,
  markThreadDeleted,
  updateThread,
  type UpdateThreadInput,
} from "@bb/db";
import type { Environment, Thread, ThreadListEntry } from "@bb/domain";
import {
  createThreadRequestSchema,
  deleteThreadRequestSchema,
  threadGetQuerySchema,
  threadIncludeOptionSchema,
  threadListQuerySchema,
  updateThreadRequestSchema,
  typedRoutes,
  type ThreadGetQuery,
  type ThreadIncludeOption,
  type ThreadAssignedChildSummaryResponse,
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
} from "../../services/environments/environment-cleanup.js";
import {
  getNonDestroyedHostWithStatus,
  requireEnvironment,
  requirePublicProject,
  requirePublicThread,
} from "../../services/lib/entity-lookup.js";
import { queueThreadRenameCommand } from "../../services/threads/thread-commands.js";
import {
  finalizeStoppedThread,
  requestThreadStopIfNeeded,
} from "../../services/threads/thread-lifecycle.js";
import { createThreadFromRequest } from "../../services/threads/thread-create.js";
import { requireManagerChildThreadsConfirmation } from "../../services/threads/manager-child-confirmation.js";
import {
  toThreadListEntryResponses,
  toThreadResponseFromThread,
} from "../../services/threads/thread-runtime-display.js";
import { assertValidManagerParentThread } from "../../services/threads/thread-parent.js";
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

export function registerThreadBaseRoutes(app: Hono, deps: AppDeps): void {
  const { get, post, patch, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get("/threads", threadListQuerySchema, (context, query) => {
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
    const threads = listThreadsWithPendingInteractionState(deps.db, {
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.parentThreadId ? { parentThreadId: query.parentThreadId } : {}),
      archived:
        query.archived === undefined ? undefined : query.archived === "true",
      managed:
        query.managed === undefined ? undefined : query.managed === "true",
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {}),
    });
    return context.json(
      toThreadListEntryResponses(deps, { threads }) satisfies ThreadListEntry[],
    );
  });

  post("/threads", createThreadRequestSchema, async (context, payload) => {
    const thread = await createThreadFromRequest(deps, {
      ...payload,
      automationId: null,
      managerTemplateName: null,
      origin: payload.origin,
      type: "standard",
    });
    return context.json(toThreadResponseFromThread(deps, { thread }), 201);
  });

  get("/threads/:id", threadGetQuerySchema, (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    return context.json(
      buildThreadResponse(deps, {
        includes: parseThreadIncludes(query),
        thread,
      }),
    );
  });

  get("/threads/:id/assigned-child-summary", (context) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    if (thread.type !== "manager") {
      throw new ApiError(
        400,
        "invalid_request",
        "Assigned child summary is only available for manager threads",
      );
    }
    const nonDeletedAssignedChildCount = countNonDeletedAssignedChildThreads(
      deps.db,
      {
        parentThreadId: thread.id,
      },
    );
    return context.json({
      nonDeletedAssignedChildCount,
    } satisfies ThreadAssignedChildSummaryResponse);
  });

  patch("/threads/:id", updateThreadRequestSchema, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    if (payload.parentThreadId) {
      assertValidManagerParentThread(deps, {
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
        queueThreadRenameCommand(deps, {
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
        queueManagerMessages: true,
        updatedThread: updated,
      });
    }

    return context.json(toThreadResponseFromThread(deps, { thread: updated }));
  });

  del("/threads/:id", deleteThreadRequestSchema, async (context, payload) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    requireManagerChildThreadsConfirmation({
      action: "delete",
      confirmed: payload.managerChildThreadsConfirmed,
      deps,
      thread,
    });
    markThreadDeleted(deps.db, deps.hub, { threadId: thread.id });
    deps.terminalSessions.closeDeletedThreadTerminals({ threadId: thread.id });
    if (thread.environmentId === null) {
      await finalizeStoppedThread(deps, {
        threadId: thread.id,
        cancelPendingCommand: false,
      });
      return context.json({ ok: true });
    }

    const environment = requireEnvironment(deps.db, thread.environmentId);
    requestThreadStopIfNeeded(deps, thread, environment);
    await finalizeStoppedThread(deps, {
      threadId: thread.id,
      cancelPendingCommand: false,
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
