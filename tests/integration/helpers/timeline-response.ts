import type {
  ThreadTimelineResponse,
  TimelineRow,
  TimelineWorkflowWorkRow,
} from "@bb/server-contract";

export function timelineHasAssistantConversation(
  timeline: ThreadTimelineResponse,
): boolean {
  return flattenTimelineRows(timeline.rows).some(
    (row) => row.kind === "conversation" && row.role === "assistant",
  );
}

/**
 * Every workflow work row in the timeline (nested rows included) — the
 * thread-view projection's fold of the anchor `item/backgroundTask/*` rows,
 * which the M5 anchor criteria assert collapses to exactly ONE row per run.
 */
export function listWorkflowTimelineRows(
  timeline: ThreadTimelineResponse,
): TimelineWorkflowWorkRow[] {
  return flattenTimelineRows(timeline.rows).filter(
    (row): row is TimelineWorkflowWorkRow =>
      row.kind === "work" && row.workKind === "workflow",
  );
}

export function formatTimelineRowKindsForDiagnostics(
  timeline: ThreadTimelineResponse,
): string {
  return flattenTimelineRows(timeline.rows).map(formatTimelineRowKind).join(", ");
}

function flattenTimelineRows(rows: readonly TimelineRow[]): TimelineRow[] {
  const flattened: TimelineRow[] = [];
  for (const row of rows) {
    flattened.push(row);
    switch (row.kind) {
      case "turn":
        if (row.children) {
          flattened.push(...flattenTimelineRows(row.children));
        }
        break;
      case "work":
        if (row.workKind === "delegation") {
          flattened.push(...flattenTimelineRows(row.childRows));
        }
        break;
      case "conversation":
      case "system":
        break;
    }
  }
  return flattened;
}

function formatTimelineRowKind(row: TimelineRow): string {
  switch (row.kind) {
    case "conversation":
      return `conversation:${row.role}`;
    case "work":
      return `work:${row.workKind}`;
    case "turn":
      return "turn";
    case "system":
      return `system:${row.systemKind}`;
  }
}
