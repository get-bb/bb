import { useCallback } from "react";
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

export function resolveTimelineWorkRowFullOutput({
  data,
  isError,
  row,
}: {
  data: readonly TimelineRow[] | undefined;
  isError: boolean;
  row: TimelinePreviewableWorkRow;
}): Omit<TimelineWorkRowFullOutput, "retry"> {
  const outputPreview = row.outputPreview;
  if (outputPreview === undefined) {
    return { output: row.output, state: "complete" };
  }
  if (
    outputPreview.experimental_fullOutputAvailability === "retention-expired"
  ) {
    return { output: row.output, state: "expired-preview" };
  }
  const shouldLoad = shouldLoadTimelineWorkRowFullOutput(row);
  const match =
    shouldLoad && data !== undefined
      ? findPreviewableWorkRow(data, row.workKind, row.callId)
      : null;
  if (match !== null) {
    return {
      output: match.output,
      state: loadedOutputState(match.outputPreview),
    };
  }
  if (!shouldLoad) {
    return { output: row.output, state: "streaming-preview" };
  }
  if (isError || data !== undefined) {
    return { output: row.output, state: "error" };
  }
  return { output: row.output, state: "loading" };
}

export function useTimelineWorkRowFullOutput(
  row: TimelinePreviewableWorkRow,
): TimelineWorkRowFullOutput {
  const { data, isError, refetch } = useThreadTimelineTurnSummaryDetails(
    {
      itemId: row.callId,
      sourceSeqEnd: row.sourceSeqEnd,
      sourceSeqStart: row.sourceSeqStart,
      threadId: row.threadId,
      turnId: row.turnId ?? "",
    },
    {
      enabled: shouldLoadTimelineWorkRowFullOutput(row),
      refetchOnMount: false,
    },
  );
  const retry = useCallback((): void => {
    void refetch();
  }, [refetch]);
  return { ...resolveTimelineWorkRowFullOutput({ data, isError, row }), retry };
}
