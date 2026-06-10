import type {
  TimelineViewWorkflowWorkRow,
  WorkflowRunDisplayState,
} from "@bb/thread-view";
import { WorkflowAgentTree } from "../../workflow/WorkflowAgentTree.js";
import { TimelineDetailScroll } from "./TimelineDetailScroll.js";

/**
 * Paused stays item-status "pending" by design (a paused run is resumable),
 * so the run state must branch on taskStatus before status: a paused run
 * renders its agents paused, not live or stopped.
 */
function deriveWorkflowRunState(
  row: TimelineViewWorkflowWorkRow,
): WorkflowRunDisplayState {
  if (row.taskStatus === "paused") {
    return "paused";
  }
  return row.status === "pending" ? "running" : "settled";
}

export function WorkflowWorkRowBody({
  row,
}: {
  row: TimelineViewWorkflowWorkRow;
}) {
  if (!row.workflow) {
    // Degraded body: no progress records — show the terminal summary or error.
    if (!row.summary && !row.error) {
      return null;
    }
    return (
      <div className="px-2 py-1 text-xs text-muted-foreground">
        {row.summary ?? row.error}
      </div>
    );
  }

  const runState = deriveWorkflowRunState(row);
  // Sticky-bottom scroll keys off agent activity so live progress stays visible.
  const contentKey = row.workflow.agents
    .map((agent) => `${agent.index}:${agent.state}:${agent.lastProgressAt}`)
    .join("|");

  return (
    <TimelineDetailScroll
      size="delegation"
      streaming={runState === "running"}
      contentKey={contentKey}
    >
      <div className="flex flex-col gap-1 py-1">
        <WorkflowAgentTree runState={runState} snapshot={row.workflow} />
        {row.error ? (
          <div className="px-2 py-0.5 text-xs text-destructive/80">
            {row.error}
          </div>
        ) : null}
      </div>
    </TimelineDetailScroll>
  );
}
