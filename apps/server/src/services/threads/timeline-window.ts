import { getAppSettings, getLatestThreadSequence } from "@bb/db";
import {
  DEFAULT_COMPLETED_TURN_DISPLAY,
  type AppSettings,
  type CompletedTurnDisplay,
  type Thread,
} from "@bb/domain";
import type { ThreadTimelineResponse } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { resolveProviderPlanCommand } from "../providers/provider-plan-command.js";
import { buildThreadTimelineWithProfile } from "./timeline.js";
import type { createSlowThreadTimelineBuildLogger } from "./timeline-build-log.js";
import {
  buildThreadTimelineCacheKey,
  buildThreadTimelineParamsKey,
  type createThreadTimelineCache,
} from "./timeline-cache.js";
import type { TimelineLatestRowsCache } from "./timeline-latest-rows-cache.js";
import {
  DEFAULT_MAX_INLINE_OUTPUT_CHARS,
  truncateTimelineResponseOutputs,
} from "./timeline-output-truncation.js";
import { previewTimelineResponseOutputs } from "./timeline-output-preview.js";
import type { ThreadTimelinePageRequest } from "./timeline-pagination.js";

interface CreateThreadTimelineWindowsArgs {
  deps: Pick<AppDeps, "config" | "db" | "providerRegistry">;
  slowTimelineBuildLogger: ReturnType<
    typeof createSlowThreadTimelineBuildLogger
  >;
  timelineCache: ReturnType<typeof createThreadTimelineCache>;
  timelineLatestRowsCache: TimelineLatestRowsCache;
}

export interface ThreadTimelineWindowRequest {
  includeNestedRows: boolean;
  page: ThreadTimelinePageRequest;
  summaryOnly: boolean;
}

interface ThreadTimelineWindow {
  full: ThreadTimelineResponse;
  maxSeq: number;
  paramsKey: string;
}

export interface ThreadTimelineWindows {
  build(
    thread: Thread,
    request: ThreadTimelineWindowRequest,
  ): ThreadTimelineWindow;
  timelineLatestRowsCache: TimelineLatestRowsCache;
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

export function createThreadTimelineWindows({
  deps,
  slowTimelineBuildLogger,
  timelineCache,
  timelineLatestRowsCache,
}: CreateThreadTimelineWindowsArgs): ThreadTimelineWindows {
  return {
    build(thread, { includeNestedRows, page, summaryOnly }) {
      const providerDisplayName = resolveThreadProviderDisplayName(
        deps,
        thread.providerId,
      );
      const settings = getAppSettings(deps.db);
      const includeDiagnosticOperations = settings.showDiagnosticEvents;
      const completedTurnDisplay = resolveThreadCompletedTurnDisplay(
        deps,
        settings,
        thread.providerId,
      );
      const maxSeq = getLatestThreadSequence(deps.db, {
        threadId: thread.id,
      });
      const eventBudget = deps.config.featureFlags.timelineWindowEventBudget;
      const keyArgs = {
        threadId: thread.id,
        status: thread.status,
        environmentId: thread.environmentId,
        providerDisplayName,
        page,
        includeNestedRows,
        summaryOnly,
        includeDiagnosticOperations,
        completedTurnDisplay,
      };
      const full = timelineCache.getOrBuild(
        thread.id,
        buildThreadTimelineCacheKey({ ...keyArgs, maxSeq }),
        () => {
          const { profile, response } = buildThreadTimelineWithProfile(
            deps.db,
            thread,
            {
              completedTurnDisplay,
              eventBudget,
              includeDiagnosticOperations,
              includeNestedRows,
              maxInlineOutputChars: DEFAULT_MAX_INLINE_OUTPUT_CHARS,
              maxSeq,
              page,
              providerDisplayName,
              planCommand: resolveProviderPlanCommand(
                deps.providerRegistry,
                thread.providerId,
              ),
              summaryOnly,
            },
          );
          slowTimelineBuildLogger.log({ profile, threadId: thread.id });
          const truncated = truncateTimelineResponseOutputs(
            response,
            DEFAULT_MAX_INLINE_OUTPUT_CHARS,
          );
          return includeNestedRows
            ? truncated
            : previewTimelineResponseOutputs(truncated);
        },
      );
      return {
        full,
        maxSeq,
        paramsKey: buildThreadTimelineParamsKey(keyArgs),
      };
    },
    timelineLatestRowsCache,
  };
}
