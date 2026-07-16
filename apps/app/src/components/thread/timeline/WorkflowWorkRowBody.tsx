import type { TimelineViewWorkflowWorkRow } from "@bb/thread-view";
import { WorkflowProgress } from "@bb/shared-ui/workflow-progress";
import type { DetailScrollSize } from "../../ui/detail-scroll-size.js";
import { TimelineDetailScroll } from "./TimelineDetailScroll.js";

/**
 * The Claude Code timeline and prompt-stack workflow renderer. The phase/agent
 * presentation lives in shared UI so built-in plugins can render the same
 * workflow language instead of maintaining a lookalike implementation.
 */
export function WorkflowWorkRowBody({
  row,
  size = "delegation",
  collapsiblePhases = false,
}: {
  row: TimelineViewWorkflowWorkRow;
  /** Max-height tier for the scroll container. */
  size?: DetailScrollSize;
  /** Follow the active phase and allow each phase to be toggled. */
  collapsiblePhases?: boolean;
}) {
  if (!row.workflow) {
    if (!row.summary && !row.error) return null;
    return (
      <div className="px-2 py-1 text-xs text-muted-foreground">
        {row.summary ?? row.error}
      </div>
    );
  }

  const contentKey = row.workflow.agents
    .map((agent) => `${agent.index}:${agent.state}:${agent.lastProgressAt}`)
    .join("|");
  return (
    <TimelineDetailScroll
      size={size}
      streaming={collapsiblePhases ? false : row.status === "pending"}
      contentKey={contentKey}
      scrollClassName={collapsiblePhases ? "px-2.5 py-2" : undefined}
    >
      <WorkflowProgress
        progress={row.workflow}
        settled={row.status !== "pending"}
        error={row.error}
        collapsiblePhases={collapsiblePhases}
      />
    </TimelineDetailScroll>
  );
}
