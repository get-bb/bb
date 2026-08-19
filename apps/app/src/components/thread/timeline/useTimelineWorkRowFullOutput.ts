import { useCallback, useMemo } from "react";
import type {
  TimelineCommandWorkRow,
  TimelineToolWorkRow,
} from "@bb/server-contract";
import { useThreadTimelineTurnSummaryDetails } from "@/hooks/queries/thread-queries";

export type TimelinePreviewableWorkRow =
  | TimelineCommandWorkRow
  | TimelineToolWorkRow;

export type TimelineWorkRowFullOutputState =
  /** The row's inline `output` is complete. */
  | "complete"
  /** The row is still running: the preview's tail is live; the full output loads once it finishes. */
  | "streaming-preview"
  | "loading"
  | "error"
  /** The full output was loaded and is what `output` now holds. */
  | "loaded";

export interface TimelineWorkRowFullOutput {
  output: string;
  state: TimelineWorkRowFullOutputState;
  retry: () => void;
}

/**
 * The default timeline window replaces the running turn's large command/tool
 * outputs with a head+tail preview (`row.outputPreview`). An expanded row wants
 * the whole thing: read it through the turn-summary-details route scoped to
 * this row's own source range, which the server already serves for collapsed
 * turns. The fetch waits until the row has finished — a running row's range
 * still moves with every output delta, and its preview tail is the live part
 * a viewer is watching anyway.
 */
export function useTimelineWorkRowFullOutput(
  row: TimelinePreviewableWorkRow,
): TimelineWorkRowFullOutput {
  const isPreview = row.outputPreview !== undefined;
  const shouldLoad = isPreview && row.turnId !== null && row.status !== "pending";
  const { data, isError, refetch } = useThreadTimelineTurnSummaryDetails(
    {
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
  const loadedOutput = useMemo((): string | null => {
    if (!shouldLoad || data === undefined) {
      return null;
    }
    const match =
      data.rows.find((candidate) => candidate.id === row.id) ??
      data.rows.find(
        (candidate) =>
          candidate.kind === "work" &&
          candidate.workKind === row.workKind &&
          candidate.callId === row.callId,
      );
    if (
      !match ||
      match.kind !== "work" ||
      (match.workKind !== "command" && match.workKind !== "tool")
    ) {
      return null;
    }
    return match.output;
  }, [data, row.callId, row.id, row.workKind, shouldLoad]);

  if (!isPreview) {
    return { output: row.output, state: "complete", retry };
  }
  if (loadedOutput !== null) {
    return { output: loadedOutput, state: "loaded", retry };
  }
  if (!shouldLoad) {
    return { output: row.output, state: "streaming-preview", retry };
  }
  // A details response that does not carry this row cannot be retried into
  // existence; report it like a failed load so the preview stays readable.
  if (isError || data !== undefined) {
    return { output: row.output, state: "error", retry };
  }
  return { output: row.output, state: "loading", retry };
}
