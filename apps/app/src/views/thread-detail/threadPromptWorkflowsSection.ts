import type { TimelineRow, TimelineWorkflowWorkRow } from "@bb/server-contract";
import {
  getWorkflowAgentProgressCounts,
  getWorkflowRunIdFromRow,
  isWorkflowRowActivelyRunning,
} from "@bb/thread-view";
import { getWorkflowRunRoutePath } from "@/lib/app-route-paths";
import type {
  ThreadPromptWorkflowItem,
  ThreadPromptWorkflowsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";

function collectActiveWorkflowRows(
  rows: readonly TimelineRow[],
  found: Map<string, TimelineWorkflowWorkRow>,
): void {
  for (const row of rows) {
    if (row.kind === "turn") {
      if (row.children !== null) {
        collectActiveWorkflowRows(row.children, found);
      }
      continue;
    }
    if (row.kind !== "work") continue;
    if (row.workKind === "delegation") {
      collectActiveWorkflowRows(row.childRows, found);
      continue;
    }
    if (row.workKind !== "workflow") continue;
    if (!isWorkflowRowActivelyRunning(row)) continue;
    const runId = getWorkflowRunIdFromRow(row);
    // Provider-native local_workflow rows have no run page; the banner only
    // surfaces runs the user can navigate to.
    if (runId === null) continue;
    found.set(runId, row);
  }
}

/**
 * Banner section for workflow runs anchored to this thread that are actively
 * running right now (timeline "Running workflow:" semantics — pending, not
 * paused). Returns null when there are none so the banner segment disappears
 * as soon as every run settles or pauses.
 */
export function selectThreadPromptWorkflowsSection(
  timelineRows: readonly TimelineRow[],
): ThreadPromptWorkflowsSection | null {
  const found = new Map<string, TimelineWorkflowWorkRow>();
  collectActiveWorkflowRows(timelineRows, found);
  if (found.size === 0) return null;
  const items: ThreadPromptWorkflowItem[] = [...found.entries()].map(
    ([runId, row]) => {
      const counts = getWorkflowAgentProgressCounts(row.workflow);
      return {
        id: runId,
        name: row.workflowName ?? row.description,
        agentProgress:
          counts === null ? null : `${counts.settled}/${counts.total} agents`,
        href: getWorkflowRunRoutePath(runId),
      };
    },
  );
  return { items };
}
