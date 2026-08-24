import {
  areTimelinePaginationCursorsEqual,
  buildLoadedTimelineState,
  mergeLoadedTimelineWithLatest,
  prependOlderTimelineRows,
  recoverLoadedTimelineAfterStaleCursor,
  type LoadedTimelineState,
} from "@bb/client-core";
import { BbHttpError } from "@bb/sdk/browser";
import type { ThreadTimelineResponse, TimelineRow } from "@bb/server-contract";
import { useCallback, useEffect, useState } from "react";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import { useThreadTimeline } from "./thread-detail-queries";

/**
 * The loaded timeline of one thread: the live latest window (from
 * `useThreadTimeline`, kept fresh by realtime + deltas) merged with the older
 * pages the user has scrolled into (port of
 * apps/app/src/components/thread/timeline/useThreadTimelineController.ts over
 * the @bb/client-core merge helpers). Row filtering is not needed on mobile
 * yet, so the surface key is the thread id.
 */

export interface UseThreadTimelineControllerArgs {
  enabled?: boolean;
  threadId: string;
}

export interface UseThreadTimelineControllerResult {
  activeBackgroundCommands: ThreadTimelineResponse["activeBackgroundCommands"];
  activePromptMode: ThreadTimelineResponse["activePromptMode"];
  activeThinking: ThreadTimelineResponse["activeThinking"];
  activeWorkflows: ThreadTimelineResponse["activeWorkflows"];
  contextWindowUsage: ThreadTimelineResponse["contextWindowUsage"];
  goal: ThreadTimelineResponse["goal"];
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  loadOlderTimelineRows: () => Promise<void>;
  modelFallback: ThreadTimelineResponse["modelFallback"];
  pendingTodos: ThreadTimelineResponse["pendingTodos"];
  refetchLatestTimeline: () => Promise<unknown>;
  timelineError: Error | null;
  timelineLoading: boolean;
  timelineRows: TimelineRow[];
}

const EMPTY_ROWS: TimelineRow[] = [];
const EMPTY_WORKFLOWS: ThreadTimelineResponse["activeWorkflows"] = [];
const EMPTY_BACKGROUND_COMMANDS: ThreadTimelineResponse["activeBackgroundCommands"] =
  [];

/**
 * The server answers `beforeAnchorSeq/beforeAnchorId` with 400
 * `invalid_request` when the anchor no longer exists (history rewritten under
 * us); the controller then refetches the latest window and re-derives the
 * cursor from it.
 */
function isStaleTimelinePaginationCursorError(error: unknown): boolean {
  return (
    error instanceof BbHttpError &&
    error.status === 400 &&
    error.code === "invalid_request"
  );
}

function emptyLoadedTimeline(surfaceKey: string): LoadedTimelineState {
  return buildLoadedTimelineState({
    latestWindowEndSequence: null,
    latestRows: [],
    olderCursor: null,
    surfaceKey,
  });
}

export function useThreadTimelineController({
  enabled = true,
  threadId,
}: UseThreadTimelineControllerArgs): UseThreadTimelineControllerResult {
  const { sdk } = useProfileClient();
  const latestTimelineQuery = useThreadTimeline(threadId, { enabled });
  const surfaceKey = threadId;
  const [loadedTimeline, setLoadedTimeline] = useState<LoadedTimelineState>(
    () => emptyLoadedTimeline(surfaceKey),
  );
  const [isLoadingOlderTimelineRows, setIsLoadingOlderTimelineRows] =
    useState(false);
  const latestTimeline = latestTimelineQuery.data;

  useEffect(() => {
    if (!latestTimeline) {
      setLoadedTimeline((current) =>
        current.surfaceKey === surfaceKey
          ? current
          : emptyLoadedTimeline(surfaceKey),
      );
      return;
    }
    setLoadedTimeline((current) =>
      mergeLoadedTimelineWithLatest({ current, latestTimeline, surfaceKey }),
    );
  }, [latestTimeline, surfaceKey]);

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
      setLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) return current;
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
            olderRows: response.rows,
          }),
        };
      });
    } catch (error) {
      if (!isStaleTimelinePaginationCursorError(error)) {
        throw error;
      }
      const result = await refetchLatestTimeline();
      const recovered = result.data ?? latestTimeline;
      setLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) return current;
        if (!recovered) return { ...current, olderCursor: null };
        return recoverLoadedTimelineAfterStaleCursor({
          current,
          latestTimeline: recovered,
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
    sdk,
    surfaceKey,
    threadId,
  ]);

  const timelineRows =
    loadedTimeline.surfaceKey === surfaceKey && loadedTimeline.rows.length > 0
      ? loadedTimeline.rows
      : (latestTimeline?.rows ?? EMPTY_ROWS);
  const timelineLoading =
    latestTimelineQuery.isLoading ||
    (latestTimelineQuery.isFetching && timelineRows.length === 0);
  const timelineError =
    !timelineLoading && latestTimelineQuery.isError && timelineRows.length === 0
      ? latestTimelineQuery.error
      : null;

  return {
    activeBackgroundCommands:
      latestTimeline?.activeBackgroundCommands ?? EMPTY_BACKGROUND_COMMANDS,
    activePromptMode: latestTimeline?.activePromptMode ?? null,
    activeThinking: latestTimeline?.activeThinking ?? null,
    activeWorkflows: latestTimeline?.activeWorkflows ?? EMPTY_WORKFLOWS,
    contextWindowUsage: latestTimeline?.contextWindowUsage,
    goal: latestTimeline?.goal ?? null,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    modelFallback: latestTimeline?.modelFallback ?? null,
    pendingTodos: latestTimeline?.pendingTodos ?? null,
    refetchLatestTimeline,
    timelineError,
    timelineLoading,
    timelineRows,
  };
}
