import { createContext, useContext } from "react";
import type { ThreadTimelineTurnSummaryDetailsQueryIdentity } from "@/hooks/queries/query-keys";

interface TimelineDetailSource {
  sourceSeqEnd: number;
  sourceSeqStart: number;
  threadId: string;
  turnId: string | null;
}

export const TimelineDetailSourceContext =
  createContext<TimelineDetailSource | null>(null);

export function useTimelineDetailIdentity(
  row: TimelineDetailSource,
  threadId: string | undefined,
  itemId: string | null,
): ThreadTimelineTurnSummaryDetailsQueryIdentity {
  const enclosing = useContext(TimelineDetailSourceContext);
  const source = enclosing?.threadId === row.threadId ? enclosing : row;
  return {
    itemId,
    sourceSeqEnd: source.sourceSeqEnd,
    sourceSeqStart: source.sourceSeqStart,
    threadId: threadId ?? source.threadId,
    turnId: source.turnId ?? "",
  };
}
