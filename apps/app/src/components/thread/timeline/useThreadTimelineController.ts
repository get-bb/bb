import { useCallback, useState } from "react";
import {
  useQueryClient,
  type QueryObserverResult,
} from "@tanstack/react-query";
import type { ThreadTimelineResponse, TimelineRow } from "@bb/server-contract";
import {
  areTimelinePaginationCursorsEqual,
  buildLoadedTimelineState,
  mergeLoadedTimelineWithLatest,
  prependOlderTimelineRows,
  recoverLoadedTimelineAfterStaleCursor,
  type LoadedTimelineState,
} from "@bb/client-core";
import { useConnectionAwareQueryState } from "@/hooks/queries/connection-aware-query-state";
import { threadTimelineQueryKey } from "@/hooks/queries/query-keys";
import { isTransientReadError } from "@/hooks/queries/query-helpers";
import { useThreadTimeline } from "@/hooks/queries/thread-queries";
import { BbHttpError, sdk } from "@/lib/sdk";

type TimelineQueryResultProp =
  keyof QueryObserverResult<ThreadTimelineResponse>;

export const TIMELINE_CONTROLLER_PROPS_WITH_ROWS: TimelineQueryResultProp[] = [
  "data",
  "error",
  "isLoading",
  "isLoadingError",
];

export const TIMELINE_CONTROLLER_PROPS_WITHOUT_ROWS: TimelineQueryResultProp[] =
  [...TIMELINE_CONTROLLER_PROPS_WITH_ROWS, "isFetching"];

interface UseThreadTimelineControllerArgs {
  enabled?: boolean;
  surfaceKey?: string;
  threadId: string;
}

export interface UseThreadTimelineControllerResult {
  activePromptMode: ThreadTimelineResponse["activePromptMode"];
  activeThinking: ThreadTimelineResponse["activeThinking"];
  activeWorkflows: ThreadTimelineResponse["activeWorkflows"];
  activeBackgroundCommands: ThreadTimelineResponse["activeBackgroundCommands"];
  contextBoundarySeq: ThreadTimelineResponse["contextBoundarySeq"];
  contextWindowUsage: ThreadTimelineResponse["contextWindowUsage"];
  goal: ThreadTimelineResponse["goal"];
  modelFallback: ThreadTimelineResponse["modelFallback"];
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  loadOlderTimelineRows: () => Promise<void>;
  pendingTodos: ThreadTimelineResponse["pendingTodos"];
  timelineError: Error | null;
  timelineLoading: boolean;
  timelineRows: TimelineRow[];
}

interface LoadedTimelineTracker {
  latestTimeline: ThreadTimelineResponse | undefined;
  loaded: LoadedTimelineState;
  surfaceKey: string;
}

interface ReconcileLoadedTimelineArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineResponse | undefined;
  surfaceKey: string;
}

type LoadedTimelineUpdate = (
  current: LoadedTimelineState,
) => LoadedTimelineState;

function isStaleTimelinePaginationCursorError(error: Error): boolean {
  return (
    error instanceof BbHttpError &&
    error.status === 400 &&
    error.code === "invalid_request"
  );
}

function buildEmptyLoadedTimelineState(
  surfaceKey: string,
): LoadedTimelineState {
  return buildLoadedTimelineState({
    latestWindowEndSequence: null,
    latestRows: [],
    olderCursor: null,
    surfaceKey,
  });
}

function reconcileLoadedTimeline({
  current,
  latestTimeline,
  surfaceKey,
}: ReconcileLoadedTimelineArgs): LoadedTimelineState {
  if (!latestTimeline) {
    return current.surfaceKey === surfaceKey
      ? current
      : buildEmptyLoadedTimelineState(surfaceKey);
  }

  return mergeLoadedTimelineWithLatest({
    current,
    latestTimeline,
    surfaceKey,
  });
}

export function useThreadTimelineController({
  enabled = true,
  surfaceKey: explicitSurfaceKey,
  threadId,
}: UseThreadTimelineControllerArgs): UseThreadTimelineControllerResult {
  const queryClient = useQueryClient();
  const notifyOnChangeProps = useCallback((): TimelineQueryResultProp[] => {
    const cachedTimeline = queryClient.getQueryData<ThreadTimelineResponse>(
      threadTimelineQueryKey(threadId),
    );
    return cachedTimeline !== undefined && cachedTimeline.rows.length > 0
      ? TIMELINE_CONTROLLER_PROPS_WITH_ROWS
      : TIMELINE_CONTROLLER_PROPS_WITHOUT_ROWS;
  }, [queryClient, threadId]);
  const latestTimelineQuery = useThreadTimeline(threadId, {
    enabled,
    notifyOnChangeProps,
    refetchOnMount: true,
  });
  const baseSurfaceKey = explicitSurfaceKey ?? threadId;
  const contextBoundarySeq =
    latestTimelineQuery.data?.contextBoundarySeq ?? null;
  const surfaceKey =
    contextBoundarySeq === null
      ? baseSurfaceKey
      : `${baseSurfaceKey}:context-boundary:${contextBoundarySeq}`;
  const latestTimeline = latestTimelineQuery.data;
  const [loadedTimelineTracker, setLoadedTimelineTracker] =
    useState<LoadedTimelineTracker>(() => ({
      latestTimeline,
      loaded: reconcileLoadedTimeline({
        current: buildEmptyLoadedTimelineState(surfaceKey),
        latestTimeline,
        surfaceKey,
      }),
      surfaceKey,
    }));
  let loadedTimeline = loadedTimelineTracker.loaded;
  if (
    loadedTimelineTracker.latestTimeline !== latestTimeline ||
    loadedTimelineTracker.surfaceKey !== surfaceKey
  ) {
    loadedTimeline = reconcileLoadedTimeline({
      current: loadedTimelineTracker.loaded,
      latestTimeline,
      surfaceKey,
    });
    setLoadedTimelineTracker({
      latestTimeline,
      loaded: loadedTimeline,
      surfaceKey,
    });
  }
  const updateLoadedTimeline = useCallback((update: LoadedTimelineUpdate) => {
    setLoadedTimelineTracker((current) => {
      const loaded = update(current.loaded);
      return loaded === current.loaded ? current : { ...current, loaded };
    });
  }, []);
  const [isLoadingOlderTimelineRows, setIsLoadingOlderTimelineRows] =
    useState(false);
  const refetchLatestTimeline = latestTimelineQuery.refetch;

  const nextOlderCursor =
    loadedTimeline.surfaceKey === surfaceKey
      ? loadedTimeline.olderCursor
      : null;
  const hasOlderTimelineRows = nextOlderCursor !== null;
  const loadOlderTimelineRows = useCallback(async (): Promise<void> => {
    if (
      !enabled ||
      !nextOlderCursor ||
      !threadId ||
      isLoadingOlderTimelineRows
    ) {
      return;
    }

    setIsLoadingOlderTimelineRows(true);
    try {
      const response = await sdk.threads.timeline({
        beforeAnchorId: nextOlderCursor.anchorId,
        beforeAnchorSeq: String(nextOlderCursor.anchorSeq),
        threadId,
      });
      const olderRows = [...response.rows];
      updateLoadedTimeline((current) => {
        if (
          current.surfaceKey !== surfaceKey ||
          current.historySnapshot !== response.timelinePage.historySnapshot
        ) {
          return current;
        }
        return {
          ...current,
          olderCursor: areTimelinePaginationCursorsEqual({
            left: current.olderCursor,
            right: nextOlderCursor,
          })
            ? response.timelinePage.olderCursor
            : current.olderCursor,
          rows: prependOlderTimelineRows({
            loadedRows: current.rows,
            olderRows,
          }),
        };
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !isStaleTimelinePaginationCursorError(error)
      ) {
        throw error;
      }

      const latestTimelineResult = await refetchLatestTimeline();
      const recoveredLatestTimeline =
        latestTimelineResult.data ?? latestTimeline;
      updateLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) {
          return current;
        }
        if (!recoveredLatestTimeline) {
          return {
            ...current,
            olderCursor: null,
          };
        }
        return recoverLoadedTimelineAfterStaleCursor({
          current,
          latestTimeline: recoveredLatestTimeline,
          surfaceKey,
        });
      });
    } finally {
      setIsLoadingOlderTimelineRows(false);
    }
  }, [
    enabled,
    isLoadingOlderTimelineRows,
    latestTimeline,
    nextOlderCursor,
    refetchLatestTimeline,
    surfaceKey,
    threadId,
    updateLoadedTimeline,
  ]);
  const timelineRows =
    loadedTimeline.surfaceKey === surfaceKey && loadedTimeline.rows.length > 0
      ? loadedTimeline.rows
      : (latestTimeline?.rows ?? []);
  const timelineQueryState = useConnectionAwareQueryState({
    hasResolvedData:
      latestTimelineQuery.data !== undefined || timelineRows.length > 0,
    isFetching: latestTimelineQuery.isFetching,
    isLoadingError: latestTimelineQuery.isLoadingError,
    isRecoverableLoadingError: isTransientReadError(latestTimelineQuery.error),
  });
  const timelineLoading =
    latestTimelineQuery.isLoading ||
    (timelineQueryState.status === "loading" && timelineRows.length === 0) ||
    (latestTimelineQuery.isFetching && timelineRows.length === 0);
  const timelineError =
    timelineLoading || timelineQueryState.status !== "unavailable"
      ? null
      : latestTimelineQuery.error;

  return {
    activePromptMode: latestTimeline?.activePromptMode ?? null,
    activeThinking: latestTimeline?.activeThinking ?? null,
    activeWorkflows: latestTimeline?.activeWorkflows ?? [],
    activeBackgroundCommands: latestTimeline?.activeBackgroundCommands ?? [],
    contextBoundarySeq,
    contextWindowUsage: latestTimeline?.contextWindowUsage,
    goal: latestTimeline?.goal ?? null,
    modelFallback: latestTimeline?.modelFallback ?? null,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    pendingTodos: latestTimeline?.pendingTodos ?? null,
    timelineError,
    timelineLoading,
    timelineRows,
  };
}
