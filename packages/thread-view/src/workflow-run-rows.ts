import {
  BB_WORKFLOW_TASK_TYPE,
  isSettledWorkflowAgentState,
  type WorkflowProgressSnapshot,
} from "@bb/domain";
import type { TimelineWorkflowWorkRow } from "@bb/server-contract";

/**
 * The `wfr_` run id for bb workflow rows that have a run page. bb workflow
 * runs anchor their run id in `itemId`; provider-native local_workflow rows
 * have no run page and return null. The single gate for workflow-run deep
 * links — keep timeline titles and other surfaces on this helper so the
 * link-eligibility rule never drifts.
 */
export function getWorkflowRunIdFromRow(
  row: TimelineWorkflowWorkRow,
): string | null {
  return row.taskType === BB_WORKFLOW_TASK_TYPE ? row.itemId : null;
}

/**
 * Whether the row represents a run that is actively executing right now.
 * Matches the timeline's "Running workflow:" shimmer semantics: pending item
 * status, and not paused (a paused run keeps status "pending" by design — see
 * backgroundTaskItemStatus — but is resumable, not running).
 */
export function isWorkflowRowActivelyRunning(
  row: TimelineWorkflowWorkRow,
): boolean {
  return row.status === "pending" && row.taskStatus !== "paused";
}

export interface WorkflowAgentProgressCounts {
  settled: number;
  total: number;
}

/**
 * Settled-vs-total agent counts from a progress snapshot, or null when the
 * provider reported no agents (degraded rendering omits progress entirely).
 */
export function getWorkflowAgentProgressCounts(
  workflow: WorkflowProgressSnapshot | null,
): WorkflowAgentProgressCounts | null {
  const agents = workflow?.agents ?? [];
  if (agents.length === 0) {
    return null;
  }
  const settled = agents.filter((agent) =>
    isSettledWorkflowAgentState(agent.state),
  ).length;
  return { settled, total: agents.length };
}
