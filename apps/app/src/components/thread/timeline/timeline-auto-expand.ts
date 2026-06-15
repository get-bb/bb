import {
  assertNever,
  findTimelineFrontierRow,
  hasTimelineFeedDetailPart,
  hasTimelineExplorationIntent,
  isTimelineFeedSummaryViewRow,
  type ThreadTimelineViewRow,
  type TimelineViewWorkRow,
} from "@bb/thread-view";

interface CollectTimelineAutoExpansionRowIdsArgs {
  rows: readonly ThreadTimelineViewRow[];
  scopeActive: boolean;
}

export interface TimelineAutoExpansionRowIds {
  liveFrontierRowIds: ReadonlySet<string>;
  terminalFrontierRowIds: ReadonlySet<string>;
}

export function isWorkRowExpandable(row: TimelineViewWorkRow): boolean {
  switch (row.workKind) {
    case "web-search":
    case "web-fetch":
    case "approval":
      return false;
    case "image-view":
      return true;
    case "question":
      // Resolving and answered rows both carry a recorded answer in their
      // body. Pending/interrupted stay title-only. Matches the
      // body-collapse rule in QuestionWorkRowBody.
      return row.lifecycle === "answered" || row.lifecycle === "resolving";
    case "command":
    case "tool":
      return !hasTimelineExplorationIntent(row);
    case "file-change":
      return true;
    case "delegation":
      return (
        row.childRows.length > 0 ||
        row.output.trim().length > 0 ||
        hasTimelineFeedDetailPart(row, "children") ||
        hasTimelineFeedDetailPart(row, "output")
      );
    case "workflow":
      // The phase/agent tree (or terminal summary/error) lives in the body; a
      // degraded row with none of them stays title-only. Matches the
      // body-collapse rule in WorkflowWorkRowBody.
      return (
        row.workflow !== null ||
        row.summary !== null ||
        row.error !== null ||
        hasTimelineFeedDetailPart(row, "workflow")
      );
    default:
      return assertNever(row);
  }
}

export function isRowExpandable(row: ThreadTimelineViewRow): boolean {
  switch (row.kind) {
    case "conversation":
      return false;
    case "system":
      return (
        (row.detail !== null && row.detail.trim().length > 0) ||
        hasTimelineFeedDetailPart(row, "system-detail")
      );
    case "bundle-summary":
    case "step-summary":
      return isTimelineFeedSummaryViewRow(row)
        ? row.feedSummary.childCount > 0
        : row.children.length > 0;
    case "turn":
      return true;
    case "work":
      return isWorkRowExpandable(row);
    default:
      return assertNever(row);
  }
}

/**
 * Bundle and step summaries whose children are all non-expandable get the
 * base max-height cap with overflow fades. Summaries that contain any
 * expandable child do not — capping then would put the child's own scroll
 * body inside a scrolling parent, which is poor UX. The expandability test
 * reuses `isWorkRowExpandable` so the cap rule and the per-row expand
 * affordance can never disagree.
 */
export function isNonExpandableSummary(
  children: readonly TimelineViewWorkRow[],
): boolean {
  return (
    children.length > 0 &&
    children.every((child) => !isWorkRowExpandable(child))
  );
}

function shouldAutoExpandLiveFrontierRow(row: ThreadTimelineViewRow): boolean {
  if (!isRowExpandable(row)) {
    return false;
  }
  switch (row.kind) {
    case "system":
      return row.status === "pending";
    case "bundle-summary":
      return true;
    case "work":
      return (
        row.workKind === "delegation" ||
        row.workKind === "image-view" ||
        // A running workflow auto-opens so live agent progress is visible.
        (row.workKind === "workflow" && row.status === "pending")
      );
    case "conversation":
    case "step-summary":
    case "turn":
      return false;
    default:
      return assertNever(row);
  }
}

function shouldAutoExpandTerminalFrontierRow(
  row: ThreadTimelineViewRow,
): boolean {
  return (
    isRowExpandable(row) && row.kind === "system" && row.status === "error"
  );
}

function visitForTerminalFrontierAutoExpand(
  rows: readonly ThreadTimelineViewRow[],
  ids: Set<string>,
): void {
  const tail = rows[rows.length - 1];
  if (tail && shouldAutoExpandTerminalFrontierRow(tail)) {
    ids.add(tail.id);
  }

  for (const row of rows) {
    if (
      row.kind === "work" &&
      row.workKind === "delegation" &&
      row.status === "pending"
    ) {
      visitForTerminalFrontierAutoExpand(row.childRows, ids);
    }
  }
}

// Auto-expand rule:
//
//   1. Terminal frontier: the literal tail row in a scope. Selected terminal
//      rows, currently system errors with detail, open when they arrive. The
//      terminal pass descends into pending delegation childRows as nested
//      scopes. The row component preserves that visible disclosure state after
//      later appends; the collector does not keep old terminal rows
//      auto-expanded.
//
//   2. Live frontier: only while the scope is active, find the trailing row
//      that the agent produced (skipping user input rows). Selected live rows
//      open while they are the current active frontier, then stop being
//      auto-expanded when newer agent/system/work output supersedes them.
//
// Active containers are the timeline's top-level row list (when the thread
// is active) and the childRows of pending delegations *inside an active
// container*. A completed delegation closes its scope, so a pending
// sub-delegation buried inside a completed parent does NOT auto-expand —
// the active scope must propagate from the top-level thread runtime down
// through every enclosing container.
function visitForLiveFrontierAutoExpand(
  rows: readonly ThreadTimelineViewRow[],
  scopeActive: boolean,
  ids: Set<string>,
): void {
  if (!scopeActive) {
    return;
  }
  const frontier = findTimelineFrontierRow(rows);
  if (frontier && shouldAutoExpandLiveFrontierRow(frontier)) {
    ids.add(frontier.id);
  }
  for (const row of rows) {
    if (
      row.kind === "work" &&
      row.workKind === "delegation" &&
      row.status === "pending"
    ) {
      visitForLiveFrontierAutoExpand(row.childRows, true, ids);
    }
  }
}

export function collectTimelineAutoExpansionRowIds({
  rows,
  scopeActive,
}: CollectTimelineAutoExpansionRowIdsArgs): TimelineAutoExpansionRowIds {
  const terminalFrontierRowIds = new Set<string>();
  const liveFrontierRowIds = new Set<string>();
  visitForTerminalFrontierAutoExpand(rows, terminalFrontierRowIds);
  visitForLiveFrontierAutoExpand(rows, scopeActive, liveFrontierRowIds);
  return {
    liveFrontierRowIds,
    terminalFrontierRowIds,
  };
}
