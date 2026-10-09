import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { deferredTimelineContentItemId } from "@bb/client-core";
import type { ThreadTimelineViewRow } from "@bb/thread-view";
import { BbDiffSplit } from "@/components/code/DiffHost";
import type { ThreadTimelineTurnSummaryDetailsQueryIdentity } from "@/hooks/queries/query-keys";
import { prefetchThreadTimelineTurnSummaryDetails } from "@/hooks/queries/thread-queries";
import {
  useRequestPierreWorkerPool,
  useRequirePierreWorkerPool,
} from "@/lib/pierre-worker-pool-gate";
import { LazyTerminalOutputBlock } from "./LazyTerminalOutputBlock.js";
import { LazyTimelineFileDiffBlock } from "./LazyTimelineFileDiffBlock.js";
import { shouldLoadTimelineWorkRowFullOutput } from "./useTimelineWorkRowFullOutput.js";

interface PreloadableSplit {
  isLoaded: () => boolean;
  preload: () => Promise<void>;
}

const FILE_CHANGE_SPLITS: readonly PreloadableSplit[] = [
  LazyTimelineFileDiffBlock,
  BbDiffSplit,
];
const COMMAND_SPLITS: readonly PreloadableSplit[] = [LazyTerminalOutputBlock];
const NO_SPLITS: readonly PreloadableSplit[] = [];

interface TimelineDetailSource {
  sourceSeqEnd: number;
  sourceSeqStart: number;
  threadId: string;
  turnId: string | null;
}

export function timelineDetailIdentity(
  row: TimelineDetailSource,
  threadId: string | undefined,
  itemId: string | null,
): ThreadTimelineTurnSummaryDetailsQueryIdentity {
  return {
    itemId,
    sourceSeqEnd: row.sourceSeqEnd,
    sourceSeqStart: row.sourceSeqStart,
    threadId: threadId ?? row.threadId,
    turnId: row.turnId ?? "",
  };
}

function timelineRowBodyDetailIdentity(
  row: ThreadTimelineViewRow,
  threadId: string | undefined,
): ThreadTimelineTurnSummaryDetailsQueryIdentity | null {
  const deferredItemId = deferredTimelineContentItemId(row);
  if (deferredItemId !== null) {
    return timelineDetailIdentity(row, threadId, deferredItemId);
  }
  if (row.kind === "turn") {
    return row.children === null
      ? timelineDetailIdentity(row, threadId, null)
      : null;
  }
  if (row.kind !== "work") {
    return null;
  }
  if (row.workKind === "delegation") {
    return row.childRows === null
      ? timelineDetailIdentity(row, threadId, row.callId)
      : null;
  }
  if (
    (row.workKind === "command" || row.workKind === "tool") &&
    shouldLoadTimelineWorkRowFullOutput(row)
  ) {
    return timelineDetailIdentity(row, row.threadId, row.callId);
  }
  return null;
}

function timelineRowBodySplits(
  row: ThreadTimelineViewRow,
): readonly PreloadableSplit[] {
  if (row.kind !== "work") {
    return NO_SPLITS;
  }
  switch (row.workKind) {
    case "file-change":
      return FILE_CHANGE_SPLITS;
    case "command":
      return COMMAND_SPLITS;
    default:
      return NO_SPLITS;
  }
}

function timelineRowBodyHighlightsDiffs(row: ThreadTimelineViewRow): boolean {
  return row.kind === "work" && row.workKind === "file-change";
}

export function usePreloadTimelineRowBody(
  row: ThreadTimelineViewRow,
  threadId: string | undefined,
): () => void {
  const queryClient = useQueryClient();
  const requestDiffWorkers = useRequestPierreWorkerPool();
  return () => {
    const identity = timelineRowBodyDetailIdentity(row, threadId);
    if (identity !== null) {
      prefetchThreadTimelineTurnSummaryDetails(queryClient, identity);
    }
    for (const split of timelineRowBodySplits(row)) {
      void split.preload();
    }
    if (timelineRowBodyHighlightsDiffs(row)) {
      requestDiffWorkers();
    }
  };
}

export function useTimelineRowBodyRenderersReady(
  row: ThreadTimelineViewRow,
): boolean {
  const splits = timelineRowBodySplits(row);
  const diffWorkersReady = useRequirePierreWorkerPool(
    timelineRowBodyHighlightsDiffs(row),
  );
  const [splitsReady, setSplitsReady] = useState(() =>
    splits.every((split) => split.isLoaded()),
  );
  useEffect(() => {
    if (splitsReady) {
      return;
    }
    let cancelled = false;
    void Promise.all(splits.map((split) => split.preload())).then(() => {
      if (!cancelled) {
        setSplitsReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [splits, splitsReady]);
  return diffWorkersReady && splitsReady;
}
