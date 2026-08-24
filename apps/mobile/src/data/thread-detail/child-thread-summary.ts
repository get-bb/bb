import {
  getCollapsedChildActivity,
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
} from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";

/**
 * What the thread detail surfaces about a parent's children: how many there
 * are and the rolled-up activity signals (pending input, working, unread),
 * using the same precedence the sidebar applies to collapsed parents.
 */
export interface ChildThreadSummary {
  count: number;
  activity: CollapsedChildActivity;
  threads: readonly ThreadListEntry[];
}

const EMPTY_CHILD_THREAD_SUMMARY: ChildThreadSummary = {
  count: 0,
  activity: NO_COLLAPSED_CHILD_ACTIVITY,
  threads: [],
};

export function summarizeChildThreads(
  threads: readonly ThreadListEntry[] | undefined,
): ChildThreadSummary {
  if (!threads || threads.length === 0) return EMPTY_CHILD_THREAD_SUMMARY;
  return {
    count: threads.length,
    activity: getCollapsedChildActivity(threads),
    threads,
  };
}
