import { performance } from "node:perf_hooks";
import { getAppSettings, getLatestThreadSequence, getThread } from "@bb/db";
import {
  DEFAULT_COMPLETED_TURN_DISPLAY,
  type AppSettings,
  type CompletedTurnDisplay,
  type Thread,
  type ThreadTimelineSubscriptionTarget,
} from "@bb/domain";
import {
  computeTimelineRowDelta,
  type ThreadTimelineResponse,
  type ThreadTimelineSignal,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { resolveProviderPlanCommand } from "../providers/provider-plan-command.js";
import { observeTimelinePushTrace } from "../system/turn-trace.js";
import {
  buildThreadTimelineWithProfile,
  THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
  THREAD_TIMELINE_SEGMENT_LIMIT_MAX,
} from "./timeline.js";
import { createSlowThreadTimelineBuildLogger } from "./timeline-build-log.js";
import {
  buildThreadTimelineCacheKey,
  buildThreadTimelineParamsKey,
  createThreadTimelineCache,
} from "./timeline-cache.js";
import { clearTimelineOrderingContextCache } from "./timeline-context-order.js";
import { createTimelineLatestRowsCache } from "./timeline-latest-rows-cache.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  truncateTimelineResponseOutputs,
} from "./timeline-output-truncation.js";
import { previewTimelineResponseOutputs } from "./timeline-output-preview.js";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

type ThreadTimelineWindowDeps = Pick<
  AppDeps,
  "config" | "db" | "hub" | "logger" | "providerRegistry"
>;

export interface ThreadTimelineWindowRequest {
  deferContent: boolean;
  includeNestedRows: boolean;
  page: ThreadTimelinePageRequest;
  summaryOnly: boolean;
}

export interface ThreadTimelineWindows {
  read(
    thread: Thread,
    request: ThreadTimelineWindowRequest,
    afterSequence: number | undefined,
  ): ThreadTimelineResponse;
}

export function resolveThreadProviderDisplayName(
  deps: Pick<AppDeps, "providerRegistry">,
  providerId: string,
): string | undefined {
  return deps.providerRegistry.get(providerId)?.info.displayName;
}

export function resolveThreadCompletedTurnDisplay(
  deps: Pick<AppDeps, "providerRegistry">,
  settings: AppSettings,
  providerId: string,
): CompletedTurnDisplay {
  return (
    settings.providerCompletedTurnDisplay[providerId] ??
    deps.providerRegistry.get(providerId)?.info.completedTurnDisplay ??
    DEFAULT_COMPLETED_TURN_DISPLAY
  );
}

export function createThreadTimelineWindows(
  deps: ThreadTimelineWindowDeps,
): ThreadTimelineWindows {
  const timelineCache = createThreadTimelineCache();
  const latestRowsCache = createTimelineLatestRowsCache();
  const deltaFloorByThreadId = new Map<string, number>();
  let lastPushedByTarget = new WeakMap<
    ThreadTimelineSubscriptionTarget,
    ThreadTimelineResponse
  >();
  const pendingPushThreadIds = new Set<string>();
  const slowTimelineBuildLogger = createSlowThreadTimelineBuildLogger({
    logger: deps.logger,
  });

  function buildWindow(
    thread: Thread,
    request: ThreadTimelineWindowRequest,
  ): { paramsKey: string; response: ThreadTimelineResponse } {
    const providerDisplayName = resolveThreadProviderDisplayName(
      deps,
      thread.providerId,
    );
    const settings = getAppSettings(deps.db);
    const includeDiagnosticOperations = settings.showDiagnosticEvents;
    const includeClearedContextHistory = settings.keepHistoryAfterContextClear;
    const completedTurnDisplay = resolveThreadCompletedTurnDisplay(
      deps,
      settings,
      thread.providerId,
    );
    const maxSeq = getLatestThreadSequence(deps.db, { threadId: thread.id });
    const keyArgs = {
      threadId: thread.id,
      status: thread.status,
      environmentId: thread.environmentId,
      providerDisplayName,
      page: request.page,
      includeNestedRows: request.includeNestedRows,
      deferContent: request.deferContent,
      summaryOnly: request.summaryOnly,
      includeClearedContextHistory,
      includeDiagnosticOperations,
      completedTurnDisplay,
    };
    const response = timelineCache.getOrBuild(
      thread.id,
      buildThreadTimelineCacheKey({ ...keyArgs, maxSeq }),
      () => {
        const { profile, response: built } = buildThreadTimelineWithProfile(
          deps.db,
          thread,
          {
            completedTurnDisplay,
            deferContent: request.deferContent,
            eventBudget: deps.config.featureFlags.timelineWindowEventBudget,
            includeClearedContextHistory,
            includeDiagnosticOperations,
            includeNestedRows: request.includeNestedRows,
            maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
            maxSeq,
            page: request.page,
            providerDisplayName,
            planCommand: resolveProviderPlanCommand(
              deps.providerRegistry,
              thread.providerId,
            ),
            summaryOnly: request.summaryOnly,
          },
        );
        slowTimelineBuildLogger.log({ profile, threadId: thread.id });
        const truncated = truncateTimelineResponseOutputs(
          built,
          DEFAULT_MAX_INLINE_OUTPUT_CHARS,
        );
        return request.includeNestedRows
          ? truncated
          : previewTimelineResponseOutputs(truncated);
      },
    );
    return { paramsKey: buildThreadTimelineParamsKey(keyArgs), response };
  }

  function deltaSince(
    threadId: string,
    paramsKey: string,
    afterSequence: number | undefined,
    full: ThreadTimelineResponse,
  ): ThreadTimelineResponse | undefined {
    const deltaFloor = deltaFloorByThreadId.get(threadId);
    const previous =
      afterSequence === undefined ||
      (deltaFloor !== undefined && afterSequence <= deltaFloor)
        ? undefined
        : latestRowsCache.get(threadId, paramsKey, afterSequence);
    latestRowsCache.set(threadId, paramsKey, {
      maxSeq: full.maxSeq,
      rows: full.rows,
    });
    return previous === undefined
      ? undefined
      : {
          ...full,
          rows: [],
          delta: computeTimelineRowDelta(previous.rows, full.rows),
        };
  }

  function pushTarget(
    thread: Thread,
    target: ThreadTimelineSubscriptionTarget,
  ): ThreadTimelineSignal | null {
    const segmentLimit =
      target.segmentLimit ?? THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT;
    if (segmentLimit > THREAD_TIMELINE_SEGMENT_LIMIT_MAX) {
      return null;
    }
    const { response } = buildWindow(thread, {
      deferContent: target.deferContent,
      includeNestedRows: false,
      page: { kind: "latest", segmentLimit },
      summaryOnly: false,
    });
    const previous = lastPushedByTarget.get(target);
    if (previous?.maxSeq === response.maxSeq) {
      return null;
    }
    lastPushedByTarget.set(target, response);
    return previous === undefined
      ? {
          type: "thread-timeline",
          target,
          afterSequence: null,
          timeline: response,
        }
      : {
          type: "thread-timeline",
          target,
          afterSequence: previous.maxSeq,
          timeline: {
            ...response,
            rows: [],
            delta: computeTimelineRowDelta(previous.rows, response.rows),
          },
        };
  }

  function pushThread(threadId: string): void {
    const targets = deps.hub.listThreadTimelineTargets(threadId);
    if (targets.length === 0) {
      return;
    }
    const thread = getThread(deps.db, threadId);
    if (thread === null || thread.deletedAt !== null) {
      return;
    }
    for (const target of targets) {
      const startedAt = performance.now();
      const signal = pushTarget(thread, target);
      if (signal === null) {
        continue;
      }
      const builtAt = performance.now();
      const bytes = deps.hub.sendThreadTimelineSignal(signal);
      observeTimelinePushTrace(deps, {
        builtAt,
        bytes,
        maxSeq: signal.timeline.maxSeq,
        sentAt: performance.now(),
        startedAt,
        threadId,
        withDelta: signal.afterSequence !== null,
      });
    }
  }

  function flushPendingPushes(): void {
    const threadIds = [...pendingPushThreadIds];
    pendingPushThreadIds.clear();
    for (const threadId of threadIds) {
      try {
        pushThread(threadId);
      } catch (error) {
        deps.logger.warn(
          {
            threadId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to push thread timeline",
        );
      }
    }
  }

  deps.hub.onChangedMessage((message) => {
    if (message.entity !== "thread") {
      return;
    }
    if (message.changes.includes("thread-deleted")) {
      deltaFloorByThreadId.delete(message.id);
      return;
    }
    if (message.changes.includes("events-appended")) {
      if (pendingPushThreadIds.size === 0) {
        setImmediate(flushPendingPushes);
      }
      pendingPushThreadIds.add(message.id);
    }
    const rewritten = message.changes.includes("history-rewritten");
    if (!rewritten && !message.changes.includes("history-compacted")) {
      return;
    }
    if (rewritten) {
      clearTimelineOrderingContextCache(deps.db);
    }
    timelineCache.invalidateThread(message.id);
    latestRowsCache.invalidateThread(message.id);
    lastPushedByTarget = new WeakMap();
    deltaFloorByThreadId.set(
      message.id,
      getLatestThreadSequence(deps.db, { threadId: message.id }),
    );
  });

  return {
    read(thread, request, afterSequence) {
      const { paramsKey, response } = buildWindow(thread, request);
      return (
        deltaSince(thread.id, paramsKey, afterSequence, response) ?? response
      );
    },
  };
}
