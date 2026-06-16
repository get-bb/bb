import type { TimelineRow, TimelineWorkflowWorkRow } from "@bb/server-contract";

/**
 * Finds the running workflow row in the timeline, if any — the workflow that
 * the prompt stack surfaces as a floating card (mirroring the goal card) while
 * it runs. A Workflow tool call lives inside the turn that spawned it, so the
 * walk descends into turn children and delegation child rows. Returns the most
 * recently started pending workflow; null when none is running.
 */
export function selectActiveWorkflowRow(
  rows: readonly TimelineRow[],
): TimelineWorkflowWorkRow | null {
  let best: TimelineWorkflowWorkRow | null = null;
  const visit = (list: readonly TimelineRow[]): void => {
    for (const row of list) {
      switch (row.kind) {
        case "turn":
          if (row.children) {
            visit(row.children);
          }
          break;
        case "work":
          if (row.workKind === "delegation") {
            visit(row.childRows);
          } else if (row.workKind === "workflow" && row.status === "pending") {
            if (best === null || row.startedAt > best.startedAt) {
              best = row;
            }
          }
          break;
        default:
          break;
      }
    }
  };
  visit(rows);
  return best;
}
