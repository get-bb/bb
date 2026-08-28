import {
  assertNever,
  findTimelineFrontierRow,
  hasTimelineExplorationIntent,
  type ThreadTimelineViewRow,
  type TimelineViewWorkRow,
} from "@bb/thread-view";

interface CollectTimelineAutoExpansionRowIdsArgs {
  rows: readonly ThreadTimelineViewRow[];
  scopeActive: boolean;
}

export interface TimelineAutoExpansionRowIds {
  /**
   * Rows the timeline opens for as long as the condition holds and closes
   * again when it stops: the active scope's live frontier, plus every waiting
   * dispatch hold.
   */
  liveExpandedRowIds: ReadonlySet<string>;
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
      return row.lifecycle === "answered" || row.lifecycle === "resolving";
    case "command":
      return !hasTimelineExplorationIntent(row);
    case "tool":
      return true;
    case "file-read":
    case "search":
      return false;
    case "plan-steps":
      return row.steps.length > 0;
    case "extension":
      return (
        row.presentation.detail !== undefined &&
        row.presentation.detail.trim().length > 0
      );
    case "file-change":
      return true;
    case "delegation":
      return row.childRows.length > 0 || row.output.trim().length > 0;
    case "workflow":
      return (
        row.workflow !== null || row.summary !== null || row.error !== null
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
      if (row.systemKind === "operation" && row.operationKind === "queue-state") {
        // A parked row's reason rides its title line, so the body holds only
        // the two things that need room: the parked message and the waiting
        // plugin's report. `detail` carries the report alone, which is why it
        // cannot be the whole test — a scheduled send has never reported
        // anything and still has a message worth showing.
        return (
          row.inputPreview !== null ||
          (row.detail !== null && row.detail.trim().length > 0)
        );
      }
      return row.detail !== null && row.detail.trim().length > 0;
    case "bundle-summary":
    case "step-summary":
      return row.children.length > 0;
    case "turn":
      return true;
    case "work":
      return isWorkRowExpandable(row);
    default:
      return assertNever(row);
  }
}

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

/**
 * A dispatch that is still waiting opens wherever it sits. Unlike the
 * frontier rules this does not depend on an active scope: a thread whose first
 * turn is parked is *not* running, so frontier logic would leave the one row
 * explaining the silence closed. It is not latched either, so the row closes
 * again on its own once the send goes through.
 */
function isWaitingDispatchRow(row: ThreadTimelineViewRow): boolean {
  return (
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind === "queue-state" &&
    row.status === "pending" &&
    isRowExpandable(row)
  );
}

function visitForWaitingDispatchAutoExpand(
  rows: readonly ThreadTimelineViewRow[],
  ids: Set<string>,
): void {
  for (const row of rows) {
    if (isWaitingDispatchRow(row)) {
      ids.add(row.id);
    }
    if (row.kind === "work" && row.workKind === "delegation") {
      visitForWaitingDispatchAutoExpand(row.childRows, ids);
    }
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
//   3. Waiting dispatch holds: scope-independent, because a held thread is by
//      definition not running. See `isWaitingDispatchRow`.
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
  const liveExpandedRowIds = new Set<string>();
  visitForTerminalFrontierAutoExpand(rows, terminalFrontierRowIds);
  visitForLiveFrontierAutoExpand(rows, scopeActive, liveExpandedRowIds);
  visitForWaitingDispatchAutoExpand(rows, liveExpandedRowIds);
  return {
    liveExpandedRowIds,
    terminalFrontierRowIds,
  };
}
