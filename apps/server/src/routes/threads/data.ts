import { emptyBody } from "@bb/operations";
import { extractThreadContextWindowUsage } from "@bb/thread-view";
import {
  getAppSettings,
  getDatabaseDataVersion,
  getThreadPluginMetadata,
  patchThreadPluginMetadata,
  getLatestCompletedThreadContextClearSequence,
  listContextWindowUsageRows,
  getLatestThreadSequence,
  getLatestStoredConversationOutlineSequence,
  listQueuedThreadMessages,
} from "@bb/db";
import {
  PROMPT_HISTORY_ENTRY_LIMIT,
  threadEventTypeSchema,
  type Thread,
  type ThreadEventType,
} from "@bb/domain";
import {
  publicApiRoutes,
  THREAD_EVENT_LIST_PAGE_SIZE,
  type ThreadConversationOutlineResponse,
  type ThreadTimelineQuery,
} from "@bb/server-contract";
import type { OperationRoutes } from "../../kernel/http-door.js";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { callHostRetryableOnlineRpc } from "../../services/hosts/online-rpc.js";
import { requireThreadStorageTarget } from "../../services/threads/thread-storage.js";
import { toThreadQueuedMessage } from "../../services/threads/thread-queued-messages.js";
import {
  isCompactionOfferEnabled,
  withCompactionOffer,
} from "../../services/threads/compaction-offer.js";
import {
  toThreadEventWithMeta,
  buildThreadConversationOutlineProjectionKey,
  getThreadMessage,
  buildTimelineTurnSummaryDetails,
  loadThreadConversationOutline,
  THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
  THREAD_TIMELINE_SEGMENT_LIMIT_MAX,
} from "../../services/threads/timeline.js";
import type {
  ThreadTimelinePageKind,
  ThreadTimelinePageRequest,
} from "../../services/threads/timeline-pagination.js";
import {
  createThreadTimelineWindows,
  resolveThreadCompletedTurnDisplay,
  resolveThreadProviderDisplayName,
} from "../../services/threads/thread-timeline-windows.js";
import {
  findThreadEvent,
  getLatestTurnFinalOutput,
  listThreadEventRows,
} from "../../services/threads/thread-data.js";
import { listThreadPromptHistory } from "../../services/prompt-history.js";
import { tryResolveExistingThreadExecutionPlan } from "../../services/threads/thread-execution-plan.js";
import {
  parseBoundedPositiveOptionalInteger,
  parseInteger,
  parseOptionalInteger,
} from "../../services/lib/validation.js";
import { parsePathKindInclusion } from "../path-list-inclusion.js";
import {
  DEFAULT_PATH_LIST_EXCLUDE_NAMES,
  THREAD_STORAGE_PATH_LIST_INCLUDE_HIDDEN,
} from "../path-list-policy.js";
import { parseFileListLimit } from "../file-list-query.js";

function parseThreadEventTypes(
  value: string | undefined,
): ThreadEventType[] | undefined {
  if (value === undefined) return undefined;
  return value.split(",").map((type) => {
    const parsed = threadEventTypeSchema.safeParse(type);
    if (!parsed.success) {
      throw new ApiError(400, "invalid_request", "Invalid event type");
    }
    return parsed.data;
  });
}

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

export function registerThreadDataRoutes(
  operations: OperationRoutes,
  deps: AppDeps,
): void {
  const routes = publicApiRoutes.threads;
  const timelineWindows = createThreadTimelineWindows(deps);
  const conversationOutlineCache = new Map<
    string,
    { key: string; items: ThreadConversationOutlineResponse["items"] }
  >();
  const CONVERSATION_OUTLINE_CACHE_MAX_ENTRIES = 128;
  const resolveConversationRowsOptions = (thread: Thread) => {
    const providerDisplayName = resolveThreadProviderDisplayName(
      deps,
      thread.providerId,
    );
    const settings = getAppSettings(deps.db);
    return {
      completedTurnDisplay: resolveThreadCompletedTurnDisplay(
        deps,
        settings,
        thread.providerId,
      ),
      includeClearedContextHistory: settings.keepHistoryAfterContextClear,
      maxSeq: getLatestThreadSequence(deps.db, { threadId: thread.id }),
      ...(providerDisplayName === undefined ? {} : { providerDisplayName }),
    };
  };

  operations.implement(routes.pluginMetadata.get, ({ id, ...query }) => {
    const thread = requirePublicThread(deps.db, id);
    const { metadata, corrupt } = getThreadPluginMetadata(
      deps.db,
      thread.id,
      query.pluginId,
    );
    if (corrupt) {
      deps.logger.warn(
        `Ignoring corrupt plugin metadata for thread ${thread.id}, plugin ${query.pluginId}`,
      );
    }
    return metadata;
  });

  operations.implement(routes.pluginMetadata.update, ({ id, ...payload }) => {
    const thread = requirePublicThread(deps.db, id);
    const result = patchThreadPluginMetadata(deps.db, {
      threadId: thread.id,
      pluginId: payload.pluginId,
      set: payload.set ?? {},
      remove: payload.remove ?? [],
    });
    if (!result.ok) {
      throw new ApiError(
        413,
        "invalid_request",
        "pluginMetadata exceeds 256 KiB",
      );
    }
    if (result.replacedCorrupt) {
      deps.logger.warn(
        `Replaced corrupt plugin metadata for thread ${thread.id}, plugin ${payload.pluginId}`,
      );
    }
    return result.metadata;
  });

  operations.implement(routes.context, ({ id }) => {
    const thread = requirePublicThread(deps.db, id);
    const sequenceStart =
      getLatestCompletedThreadContextClearSequence(deps.db, {
        threadId: thread.id,
      }) ?? 0;
    const rows = listContextWindowUsageRows(deps.db, {
      threadId: thread.id,
      sequenceStart,
    });
    const usage = extractThreadContextWindowUsage(
      rows.map(toThreadEventWithMeta),
    );
    return {
      usage:
        usage === null
          ? null
          : withCompactionOffer(deps.db, {
              enabled: isCompactionOfferEnabled(deps, thread.providerId),
              sequenceStart,
              threadId: thread.id,
              usage,
            }),
    };
  });

  operations.implement(routes.timeline, ({ id, ...query }) => {
    const thread = requirePublicThread(deps.db, id);
    return timelineWindows.read(
      thread,
      {
        deferContent: query.deferContent === "true",
        includeNestedRows: query.includeNestedRows === "true",
        page: parseThreadTimelinePage(query),
        summaryOnly: query.summaryOnly === "true",
      },
      query.afterTag,
    );
  });

  operations.implement(routes.conversationOutline, ({ id, ...query }) => {
    const thread = requirePublicThread(deps.db, id);
    const selectItems = (items: ThreadConversationOutlineResponse["items"]) =>
      query.role === undefined
        ? items
        : items.filter((item) => item.role === query.role);

    const outlineSequence = getLatestStoredConversationOutlineSequence(
      deps.db,
      { threadId: thread.id },
    );
    const outlineOptions = resolveConversationRowsOptions(thread);
    const { maxSeq } = outlineOptions;
    const cacheKey = JSON.stringify([
      thread.id,
      getDatabaseDataVersion(deps.db),
      buildThreadConversationOutlineProjectionKey(
        thread,
        outlineSequence,
        outlineOptions,
      ),
    ]);
    const cached = conversationOutlineCache.get(thread.id);
    if (cached !== undefined && cached.key === cacheKey) {
      conversationOutlineCache.delete(thread.id);
      conversationOutlineCache.set(thread.id, cached);
      return { items: selectItems(cached.items), maxSeq };
    }
    const response = loadThreadConversationOutline(deps.db, thread, {
      ...outlineOptions,
      outlineSequence,
    });
    conversationOutlineCache.delete(thread.id);
    conversationOutlineCache.set(thread.id, {
      key: cacheKey,
      items: response.items,
    });
    while (
      conversationOutlineCache.size > CONVERSATION_OUTLINE_CACHE_MAX_ENTRIES
    ) {
      const oldest = conversationOutlineCache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      conversationOutlineCache.delete(oldest);
    }
    return { ...response, items: selectItems(response.items) };
  });

  operations.implement(routes.message, ({ id, seq, ...query }) => {
    const thread = requirePublicThread(deps.db, id);
    if (!/^\d+$/.test(seq)) {
      throw new ApiError(
        400,
        "invalid_request",
        "Message seq must be a non-negative integer",
      );
    }
    return getThreadMessage(deps.db, thread, {
      ...resolveConversationRowsOptions(thread),
      seq: parseInteger(seq, "seq"),
      before: parseOptionalInteger(query.before, "before") ?? 0,
      after: parseOptionalInteger(query.after, "after") ?? 0,
    });
  });

  operations.implement(
    routes.timelineTurnSummaryDetails,
    ({ id, ...query }) => {
      const thread = requirePublicThread(deps.db, id);
      const settings = getAppSettings(deps.db);
      return buildTimelineTurnSummaryDetails(deps.db, thread, {
        beforeCursor: query.beforeCursor,
        deferContent: query.deferContent === "true",
        itemId: query.itemId ?? null,
        completedTurnDisplay: resolveThreadCompletedTurnDisplay(
          deps,
          settings,
          thread.providerId,
        ),
        includeDiagnosticOperations: settings.showDiagnosticEvents,
        summarizeShellCommands: settings.summarizeShellCommands,
        providerDisplayName: resolveThreadProviderDisplayName(
          deps,
          thread.providerId,
        ),
        turnId: query.turnId,
        sourceSeqStart: parseInteger(query.sourceSeqStart, "sourceSeqStart"),
        sourceSeqEnd: parseInteger(query.sourceSeqEnd, "sourceSeqEnd"),
      });
    },
  );

  operations.implement(routes.output, ({ id }) => {
    requirePublicThread(deps.db, id);
    return {
      output: getLatestTurnFinalOutput(deps.db, id),
    };
  });

  operations.implement(routes.queuedMessages, ({ id }) => {
    const threadId = id;
    requirePublicThread(deps.db, threadId);
    return listQueuedThreadMessages(deps.db, threadId).map(
      toThreadQueuedMessage,
    );
  });

  operations.implement(routes.promptHistory, ({ id, ...query }) => {
    const threadId = id;
    requirePublicThread(deps.db, threadId);
    const limit = parseBoundedPositiveOptionalInteger({
      defaultValue: PROMPT_HISTORY_ENTRY_LIMIT,
      max: PROMPT_HISTORY_ENTRY_LIMIT,
      name: "limit",
      value: query.limit,
    });

    return listThreadPromptHistory(deps, {
      threadId,
      limit,
    });
  });

  operations.implement(routes.events, ({ id, ...query }) => {
    requirePublicThread(deps.db, id);
    return listThreadEventRows(deps.db, {
      threadId: id,
      afterSeq: parseOptionalInteger(query.afterSeq, "afterSeq"),
      beforeSeq: parseOptionalInteger(query.beforeSeq, "beforeSeq"),
      limit: parseBoundedPositiveOptionalInteger({
        defaultValue: THREAD_EVENT_LIST_PAGE_SIZE,
        max: THREAD_EVENT_LIST_PAGE_SIZE,
        name: "limit",
        value: query.limit,
      }),
      order: query.order,
      types: parseThreadEventTypes(query.types),
    });
  });

  operations.implement(routes.eventWait, async ({ id, ...query }) => {
    const threadId = id;
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
      return emptyBody(204);
    }

    return match;
  });

  operations.implement(routes.defaultExecutionOptions, async ({ id }) => {
    const threadId = id;
    requirePublicThread(deps.db, threadId);
    return (
      (
        await tryResolveExistingThreadExecutionPlan(deps, {
          executionSource: "client/turn/requested",
          input: {},
          threadId,
        })
      )?.resolvedExecution ?? null
    );
  });

  operations.implement(
    routes.storageFiles,
    async ({ id, ...query }, { signal }) => {
      const target = await requireThreadStorageTarget(deps, id);
      const limit = parseFileListLimit(query.limit);

      try {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId: target.hostId,
          signal,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "host.list_files",
            followRootSymlink: false,
            path: target.storagePath,
            ...(query.query ? { query: query.query } : {}),
            limit,
            includeHidden: THREAD_STORAGE_PATH_LIST_INCLUDE_HIDDEN,
            respectGitIgnore: false,
            excludeNames: [...DEFAULT_PATH_LIST_EXCLUDE_NAMES],
          },
        });
        return {
          files: result.files,
          truncated: result.truncated,
          storageRootPath: target.storagePath,
        };
      } catch (error) {
        if (error instanceof ApiError && error.body.code === "ENOENT") {
          return {
            files: [],
            truncated: false,
            storageRootPath: target.storagePath,
          };
        }
        throw error;
      }
    },
  );

  operations.implement(routes.storageLocation, async ({ id }) => {
    const target = await requireThreadStorageTarget(deps, id);
    return {
      hostId: target.hostId,
      storageRootPath: target.storagePath,
    };
  });

  operations.implement(
    routes.storagePaths,
    async ({ id, ...query }, { signal }) => {
      const target = await requireThreadStorageTarget(deps, id);
      const limit = parseFileListLimit(query.limit);
      const inclusion = parsePathKindInclusion({
        includeFiles: query.includeFiles,
        includeDirectories: query.includeDirectories,
      });

      try {
        const result = await callHostRetryableOnlineRpc(deps, {
          hostId: target.hostId,
          signal,
          timeoutMs: COMMAND_TIMEOUT_MS,
          command: {
            type: "host.list_paths",
            path: target.storagePath,
            ...(query.query ? { query: query.query } : {}),
            limit,
            includeFiles: inclusion.includeFiles,
            includeDirectories: inclusion.includeDirectories,
            includeHidden: THREAD_STORAGE_PATH_LIST_INCLUDE_HIDDEN,
            respectGitIgnore: false,
            excludeNames: [...DEFAULT_PATH_LIST_EXCLUDE_NAMES],
          },
        });
        return {
          paths: result.paths,
          truncated: result.truncated,
          storageRootPath: target.storagePath,
        };
      } catch (error) {
        if (error instanceof ApiError && error.body.code === "ENOENT") {
          return {
            paths: [],
            truncated: false,
            storageRootPath: target.storagePath,
          };
        }
        throw error;
      }
    },
  );
}
