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
  computeThreadTimelineDelta,
  isThreadTimelineDelta,
  type ThreadTimelineReadResponse,
  type ThreadTimelineResponse,
  type ThreadTimelineSignal,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import type { ThreadTimelineSubscriber } from "../../ws/hub.js";
import { resolveProviderPlanCommand } from "../providers/provider-plan-command.js";
import { observeTimelinePushTrace } from "../system/turn-trace.js";
import {
  buildThreadTimelineWithProfile,
  resolveThreadTimelineSurface,
  THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT,
  THREAD_TIMELINE_SEGMENT_LIMIT_MAX,
} from "./timeline.js";
import { createSlowThreadTimelineBuildLogger } from "./timeline-build-log.js";
import {
  buildThreadTimelineCacheKey,
  createThreadTimelineCache,
} from "./timeline-cache.js";
import { clearTimelineOrderingContextCache } from "./timeline-context-order.js";
import { createTimelineServedWindowsCache } from "./timeline-served-windows-cache.js";
import { timelineRowHash, timelineWindowTag } from "./timeline-window-tag.js";
import { isCompactionOfferEnabled } from "./compaction-offer.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  shortenTimelineResponseOutputs,
} from "./timeline-output-shortening.js";
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

const MAX_PUSH_PAUSE_MS = 1_000;

interface TimelinePush {
  signal: ThreadTimelineSignal;
  subscribers: ThreadTimelineSubscriber[];
}

interface TargetPushes {
  pushes: TimelinePush[];
  response: ThreadTimelineResponse;
  windowKey: string;
}

interface ThreadPushSchedule {
  nextAllowedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface ThreadTimelineWindows {
  read(
    thread: Thread,
    request: ThreadTimelineWindowRequest,
    afterTag: string | undefined,
  ): ThreadTimelineReadResponse;
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

function latestWindowKey(
  request: ThreadTimelineWindowRequest,
  segmentLimit: number,
): string {
  return [
    segmentLimit,
    request.deferContent,
    request.includeNestedRows,
    request.summaryOnly,
  ].join("|");
}

export function createThreadTimelineWindows(
  deps: ThreadTimelineWindowDeps,
): ThreadTimelineWindows {
  const timelineCache = createThreadTimelineCache();
  const servedWindows = createTimelineServedWindowsCache({
    subscriberTags: (threadId) => deps.hub.listThreadTimelineTags(threadId),
  });
  const lastPushedByTarget = new WeakMap<
    ThreadTimelineSubscriptionTarget,
    ThreadTimelineResponse
  >();
  const pushSchedulesByThreadId = new Map<string, ThreadPushSchedule>();
  const slowTimelineBuildLogger = createSlowThreadTimelineBuildLogger({
    logger: deps.logger,
  });

  function buildWindow(
    thread: Thread,
    request: ThreadTimelineWindowRequest,
  ): ThreadTimelineResponse {
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
    const surfaceOptions = {
      compactionOfferEnabled: isCompactionOfferEnabled(deps, thread.providerId),
      completedTurnDisplay,
      deferContent: request.deferContent,
      includeClearedContextHistory,
      includeDiagnosticOperations,
      includeNestedRows: request.includeNestedRows,
      maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
      planCommand: resolveProviderPlanCommand(
        deps.providerRegistry,
        thread.providerId,
      ),
      providerDisplayName,
      summarizeShellCommands: settings.summarizeShellCommands,
    };
    return timelineCache.getOrBuild(
      thread.id,
      buildThreadTimelineCacheKey({
        threadId: thread.id,
        maxSeq,
        status: thread.status,
        surface: resolveThreadTimelineSurface(deps.db, thread, surfaceOptions)
          .cacheKey,
        page: request.page,
        summaryOnly: request.summaryOnly,
      }),
      () => {
        const { profile, response: built } = buildThreadTimelineWithProfile(
          deps.db,
          thread,
          {
            ...surfaceOptions,
            eventBudget: deps.config.featureFlags.timelineWindowEventBudget,
            maxSeq,
            page: request.page,
            summaryOnly: request.summaryOnly,
          },
        );
        slowTimelineBuildLogger.log({ profile, threadId: thread.id });
        const window = shortenTimelineResponseOutputs(built, {
          maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
          preview: !request.includeNestedRows,
        });
        return { ...window, tag: timelineWindowTag(window) };
      },
    );
  }

  function pushTarget(
    thread: Thread,
    target: ThreadTimelineSubscriptionTarget,
  ): TargetPushes | null {
    const segmentLimit =
      target.segmentLimit ?? THREAD_TIMELINE_DEFAULT_SEGMENT_LIMIT;
    if (segmentLimit > THREAD_TIMELINE_SEGMENT_LIMIT_MAX) {
      return null;
    }
    const subscribers = deps.hub
      .listThreadTimelineSubscribers(target)
      .filter(({ baseline }) => baseline.kind !== "pending");
    if (subscribers.length === 0) {
      return null;
    }
    const request: ThreadTimelineWindowRequest = {
      deferContent: target.deferContent,
      includeNestedRows: false,
      page: { kind: "latest", segmentLimit },
      summaryOnly: false,
    };
    const windowKey = latestWindowKey(request, segmentLimit);
    const response = buildWindow(thread, request);
    const hasLegacySubscribers = subscribers.some(
      ({ baseline }) => baseline.kind === "legacy",
    );
    const legacyBaseline = hasLegacySubscribers
      ? (lastPushedByTarget.get(target) ??
        servedWindows.latest(thread.id, windowKey))
      : undefined;
    if (hasLegacySubscribers) {
      lastPushedByTarget.set(target, response);
    }
    const groups = new Map<
      string | null,
      {
        baseline: ThreadTimelineResponse | undefined;
        subscribers: ThreadTimelineSubscriber[];
      }
    >();
    for (const subscriber of subscribers) {
      const baseline =
        subscriber.baseline.kind === "tag"
          ? servedWindows.get(thread.id, subscriber.baseline.tag)
          : legacyBaseline;
      if (baseline?.tag === response.tag) {
        continue;
      }
      const groupKey = baseline?.tag ?? null;
      const group = groups.get(groupKey) ?? { baseline, subscribers: [] };
      group.subscribers.push(subscriber);
      groups.set(groupKey, group);
    }
    if (groups.size === 0) {
      return null;
    }
    const pushes = [...groups.values()].map(({ baseline, subscribers }) => ({
      subscribers,
      signal: {
        type: "thread-timeline" as const,
        target,
        afterSequence: null,
        timeline:
          baseline === undefined
            ? response
            : computeThreadTimelineDelta(baseline, response, timelineRowHash),
      },
    }));
    return { pushes, response, windowKey };
  }

  function pushThread(threadId: string): void {
    const targets = deps.hub
      .listWatchedTargets("thread-timeline")
      .filter((target) => target.threadId === threadId);
    if (targets.length === 0) {
      return;
    }
    const thread = getThread(deps.db, threadId);
    if (thread === null || thread.deletedAt !== null) {
      return;
    }
    for (const target of targets) {
      const startedAt = performance.now();
      const targetPushes = pushTarget(thread, target);
      if (targetPushes === null) {
        continue;
      }
      const builtAt = performance.now();
      for (const { signal, subscribers } of targetPushes.pushes) {
        const bytes = deps.hub.sendThreadTimelineSignal(subscribers, signal);
        observeTimelinePushTrace(deps, {
          builtAt,
          bytes,
          maxSeq: signal.timeline.maxSeq,
          sentAt: performance.now(),
          startedAt,
          threadId,
          withDelta: isThreadTimelineDelta(signal.timeline),
        });
      }
      servedWindows.recordPushed(
        thread.id,
        targetPushes.windowKey,
        targetPushes.response,
      );
    }
  }

  function runScheduledPush(threadId: string): void {
    const schedule = pushSchedulesByThreadId.get(threadId);
    if (schedule === undefined) {
      return;
    }
    schedule.timer = null;
    const startedAt = performance.now();
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
    const finishedAt = performance.now();
    schedule.nextAllowedAt =
      finishedAt + Math.min(MAX_PUSH_PAUSE_MS, finishedAt - startedAt);
  }

  function schedulePush(threadId: string): void {
    const schedule = pushSchedulesByThreadId.get(threadId) ?? {
      nextAllowedAt: 0,
      timer: null,
    };
    pushSchedulesByThreadId.set(threadId, schedule);
    if (schedule.timer !== null) {
      return;
    }
    schedule.timer = setTimeout(
      () => runScheduledPush(threadId),
      Math.max(0, schedule.nextAllowedAt - performance.now()),
    );
  }

  deps.hub.onThreadTimelineTag((target, tag) => {
    servedWindows.release(target.threadId, tag);
    schedulePush(target.threadId);
  });

  deps.hub.onChangedMessage((message) => {
    if (message.entity !== "thread") {
      return;
    }
    if (message.changes.includes("thread-deleted")) {
      servedWindows.invalidateThread(message.id);
      const schedule = pushSchedulesByThreadId.get(message.id);
      if (schedule?.timer) {
        clearTimeout(schedule.timer);
      }
      pushSchedulesByThreadId.delete(message.id);
      return;
    }
    if (
      message.changes.includes("events-appended") &&
      deps.hub
        .listWatchedTargets("thread-timeline")
        .some((target) => target.threadId === message.id)
    ) {
      schedulePush(message.id);
    }
    const rewritten = message.changes.includes("history-rewritten");
    if (!rewritten && !message.changes.includes("history-compacted")) {
      return;
    }
    if (rewritten) {
      clearTimelineOrderingContextCache(deps.db);
    }
    timelineCache.invalidateThread(message.id);
  });

  return {
    read(thread, request, afterTag) {
      const response = buildWindow(thread, request);
      const previous =
        afterTag === undefined
          ? undefined
          : servedWindows.get(thread.id, afterTag);
      if (request.page.kind === "latest") {
        servedWindows.recordRead(
          thread.id,
          latestWindowKey(request, request.page.segmentLimit),
          response,
          afterTag,
        );
      }
      return previous === undefined
        ? response
        : computeThreadTimelineDelta(previous, response, timelineRowHash);
    },
  };
}
