import type {
  ThreadTimelineFeedResponse,
  TimelineFeedRow,
} from "@bb/server-contract";

export function timelineHasAssistantConversation(
  timeline: ThreadTimelineFeedResponse,
): boolean {
  return flattenTimelineRows(timeline.rows).some(
    (row) => row.kind === "conversation" && row.role === "assistant",
  );
}

export function formatTimelineRowKindsForDiagnostics(
  timeline: ThreadTimelineFeedResponse,
): string {
  return flattenTimelineRows(timeline.rows).map(formatTimelineRowKind).join(", ");
}

function flattenTimelineRows(rows: readonly TimelineFeedRow[]): TimelineFeedRow[] {
  const flattened: TimelineFeedRow[] = [];
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

function formatTimelineRowKind(row: TimelineFeedRow): string {
  switch (row.kind) {
    case "conversation":
      return `conversation:${row.role}`;
    case "work":
      return `work:${row.workKind}`;
    case "turn":
      return "turn";
    case "system":
      return `system:${row.systemKind}`;
    case "bundle-summary":
      return "bundle-summary";
    case "step-summary":
      return "step-summary";
  }
}
