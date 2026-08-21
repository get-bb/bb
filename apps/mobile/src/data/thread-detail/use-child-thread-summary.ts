import { useMemo } from "react";
import {
  summarizeChildThreads,
  type ChildThreadSummary,
} from "./child-thread-summary";
import { useChildThreads } from "./thread-detail-queries";

/** Live child-thread roll-up for the open thread (count + activity). */
export function useChildThreadSummary(
  parentThreadId: string | undefined,
  options?: { enabled?: boolean },
): ChildThreadSummary {
  const query = useChildThreads(parentThreadId, options);
  return useMemo(() => summarizeChildThreads(query.data), [query.data]);
}
