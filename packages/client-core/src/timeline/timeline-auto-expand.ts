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
