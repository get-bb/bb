import { useCallback, useMemo } from "react";
import type {
  TimelineCommandWorkRow,
  TimelineOutputPreview,
  TimelineRow,
  TimelineToolWorkRow,
} from "@bb/server-contract";
import { useThreadTimelineTurnSummaryDetails } from "@/hooks/queries/thread-queries";

export type TimelinePreviewableWorkRow =
  | TimelineCommandWorkRow
  | TimelineToolWorkRow;

export type TimelineWorkRowFullOutputState =
  | "complete"
  | "streaming-preview"
  | "limited-preview"
  | "expired-preview"
  | "loading"
  | "error"
  | "loaded";

export interface TimelineWorkRowFullOutput {
  output: string;
  state: TimelineWorkRowFullOutputState;
  retry: () => void;
}

function loadedOutputState(
  outputPreview: TimelineOutputPreview | undefined,
): TimelineWorkRowFullOutputState {
  if (outputPreview === undefined) {
    return "loaded";
  }
  switch (outputPreview.experimental_fullOutputAvailability) {
    case "available":
      return "error";
    case "detail-limit":
      return "limited-preview";
    case "retention-expired":
      return "expired-preview";
  }
}

function findPreviewableWorkRow(
  rows: readonly TimelineRow[],
  workKind: TimelinePreviewableWorkRow["workKind"],
  callId: string,
): TimelinePreviewableWorkRow | null {
  for (const candidate of rows) {
    if (
      candidate.kind === "work" &&
      candidate.workKind === workKind &&
      candidate.callId === callId
    ) {
      return candidate;
    }
  }
  return null;
}

export function shouldLoadTimelineWorkRowFullOutput(
  row: TimelinePreviewableWorkRow,
): boolean {
  return (
    row.outputPreview !== undefined &&
    row.outputPreview.experimental_fullOutputAvailability !==
      "retention-expired" &&
    row.turnId !== null &&
    row.status !== "pending"
  );
}

export function useTimelineWorkRowFullOutput(
  row: TimelinePreviewableWorkRow,
): TimelineWorkRowFullOutput {
  const outputPreview = row.outputPreview;
  const isPreview = outputPreview !== undefined;
  const shouldLoad = shouldLoadTimelineWorkRowFullOutput(row);
  const { data, isError, refetch } = useThreadTimelineTurnSummaryDetails(
    {
      itemId: row.callId,
      sourceSeqEnd: row.sourceSeqEnd,
      sourceSeqStart: row.sourceSeqStart,
      threadId: row.threadId,
      turnId: row.turnId ?? "",
    },
    { enabled: shouldLoad, refetchOnMount: false },
  );
  const retry = useCallback((): void => {
    void refetch();
  }, [refetch]);
  const loadedOutput = useMemo((): {
    output: string;
    outputPreview: TimelineOutputPreview | undefined;
  } | null => {
    if (!shouldLoad || data === undefined) {
      return null;
    }
    const match = findPreviewableWorkRow(data, row.workKind, row.callId);
    if (match === null) {
      return null;
    }
    return {
      output: match.output,
      outputPreview: match.outputPreview,
    };
  }, [data, row.callId, row.workKind, shouldLoad]);

  if (!isPreview) {
    return { output: row.output, state: "complete", retry };
  }
  if (
    outputPreview.experimental_fullOutputAvailability === "retention-expired"
  ) {
    return { output: row.output, state: "expired-preview", retry };
  }
  if (loadedOutput !== null) {
    return {
      output: loadedOutput.output,
      state: loadedOutputState(loadedOutput.outputPreview),
      retry,
    };
  }
  if (!shouldLoad) {
    return { output: row.output, state: "streaming-preview", retry };
  }
  if (isError || data !== undefined) {
    return { output: row.output, state: "error", retry };
  }
  return { output: row.output, state: "loading", retry };
}
