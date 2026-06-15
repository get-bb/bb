import type {
  TimelineConversationRow,
  TimelineFeedRow,
  TimelineRow,
  TimelineSystemRow,
  TimelineTurnRow,
  TimelineWorkRow,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import {
  buildTimelineWorkSummaryLabel,
  buildTimelineViewRows,
  closeOpenStepAtBoundary,
  flushOpenStepAsBundles,
  isSummarizableWorkRow,
  isTimelineStepBoundary,
  type ThreadTimelineViewRow,
  type TimelineViewWorkRow,
  type TimelineWorkSummaryRow,
} from "./timeline-view.js";
import {
  buildTimelineFeedTextPreview,
  nullableExpandableBodyFeedPreview,
  timelineFeedBase,
  timelineFeedDetailPartsForText,
  type BuildTimelineFeedRowsArgs,
  type BuildTimelineFeedRowsFromViewRowsArgs,
  type TimelineFeedRowsBuildContext,
} from "./timeline-feed-row-helpers.js";
import { mapTimelineWorkViewRowToFeedRow } from "./timeline-feed-work-rows.js";

export { timelineFileChangeIndexFromRowId } from "./timeline-feed-row-helpers.js";
export type {
  BuildTimelineFeedRowsArgs,
  BuildTimelineFeedRowsFromViewRowsArgs,
  TimelineFeedFileDiffLookupFactory,
  TimelineFeedFileDiffLookup,
  TimelineFeedFileDiffLookupArgs,
  TimelineFeedFileDiffMetadata,
  TimelineFeedKeyRow,
  TimelineFeedRowKeyBuilder,
} from "./timeline-feed-row-helpers.js";

type TimelineFeedBuildRow =
  | TimelineConversationRow
  | TimelineSystemRow
  | TimelineTurnRow
  | TimelineViewWorkRow
  | TimelineWorkSummaryRow;

interface TimelineFeedRowsBuildState {
  context: TimelineFeedRowsBuildContext;
  rows: TimelineFeedRow[];
  openStep: TimelineViewWorkRow[];
}

function toTimelineFeedWorkRow(row: TimelineWorkRow): TimelineViewWorkRow {
  if (row.workKind !== "delegation") {
    return row;
  }
  return {
    ...row,
    childRows: buildTimelineViewRows(row.childRows, {
      closedScope: row.status !== "pending",
    }),
  };
}

function mapTimelineFeedBuildRowToFeedRow(
  row: TimelineFeedBuildRow,
  context: TimelineFeedRowsBuildContext,
): TimelineFeedRow {
  const key = context.rowKeyForRow(row);
  switch (row.kind) {
    case "bundle-summary":
    case "step-summary":
      return {
        ...timelineFeedBase(row, key, ["children"]),
        kind: row.kind,
        status: row.status,
        title: buildTimelineWorkSummaryLabel(row, {
          active: row.status === "pending",
        }),
        childCount: row.children.length,
      };
    case "conversation": {
      const textPreview = buildTimelineFeedTextPreview(row.text);
      const parts = timelineFeedDetailPartsForText("text", textPreview);
      if (row.role === "user") {
        return {
          ...timelineFeedBase(row, key, parts),
          kind: "conversation",
          role: "user",
          textPreview,
          attachments: row.attachments,
          initiator: row.initiator,
          senderThreadId: row.senderThreadId,
          turnRequest: row.turnRequest,
          mentions: row.mentions,
        };
      }
      return {
        ...timelineFeedBase(row, key, parts),
        kind: "conversation",
        role: "assistant",
        textPreview,
        attachments: row.attachments,
        turnRequest: null,
      };
    }
    case "system": {
      const detailPreview = nullableExpandableBodyFeedPreview(
        row.detail,
        row.status,
      );
      const parts = timelineFeedDetailPartsForText(
        "system-detail",
        detailPreview,
      );
      if (row.systemKind === "operation") {
        if (row.operationKind === "parent-change") {
          return {
            ...timelineFeedBase(row, key, parts),
            kind: "system",
            systemKind: "operation",
            operationKind: "parent-change",
            title: row.title,
            detailPreview,
            status: row.status,
            parentChange: row.parentChange,
            completedAt: row.completedAt,
          };
        }
        return {
          ...timelineFeedBase(row, key, parts),
          kind: "system",
          systemKind: "operation",
          operationKind: row.operationKind,
          title: row.title,
          detailPreview,
          status: row.status,
          completedAt: row.completedAt,
        };
      }
      return {
        ...timelineFeedBase(row, key, parts),
        kind: "system",
        systemKind: row.systemKind,
        title: row.title,
        detailPreview,
        status: row.status,
      };
    }
    case "turn":
      return {
        ...timelineFeedBase(row, key, []),
        kind: "turn",
        turnId: row.turnId,
        status: row.status,
        summaryCount: row.summaryCount,
        completedAt: row.completedAt,
        children:
          row.children === null
            ? null
            : buildTimelineFeedRows({
                closedScope: true,
                fileDiffLookup: context.fileDiffLookup,
                rowKeyForRow: context.rowKeyForRow,
                rows: row.children,
              }),
      };
    case "work":
      return mapTimelineWorkViewRowToFeedRow({
        context,
        mapRowsToFeedRows: (rows) =>
          buildTimelineFeedRowsFromViewRows({
            fileDiffLookup: context.fileDiffLookup,
            rowKeyForRow: context.rowKeyForRow,
            rows,
          }),
        row,
      });
    default:
      return assertNever(row);
  }
}

function mapTimelineViewRowToFeedRow(
  row: ThreadTimelineViewRow,
  context: TimelineFeedRowsBuildContext,
): TimelineFeedRow {
  if (row.kind === "turn") {
    const key = context.rowKeyForRow(row);
    return {
      ...timelineFeedBase(row, key, []),
      kind: "turn",
      turnId: row.turnId,
      status: row.status,
      summaryCount: row.summaryCount,
      completedAt: row.completedAt,
      children:
        row.children === null
          ? null
          : buildTimelineFeedRowsFromViewRows({
              fileDiffLookup: context.fileDiffLookup,
              rowKeyForRow: context.rowKeyForRow,
              rows: row.children,
            }),
    };
  }
  return mapTimelineFeedBuildRowToFeedRow(row, context);
}

function appendTimelineFeedBuildRows(
  state: TimelineFeedRowsBuildState,
  rows: readonly ThreadTimelineViewRow[],
): void {
  for (const row of rows) {
    state.rows.push(mapTimelineViewRowToFeedRow(row, state.context));
  }
}

function flushOpenStepAsFeedBundles(state: TimelineFeedRowsBuildState): void {
  appendTimelineFeedBuildRows(
    state,
    flushOpenStepAsBundles(state.openStep),
  );
  state.openStep = [];
}

function closeOpenStepAsFeedSummary(state: TimelineFeedRowsBuildState): void {
  appendTimelineFeedBuildRows(
    state,
    closeOpenStepAtBoundary(state.openStep),
  );
  state.openStep = [];
}

function appendTimelineSourceRowToFeed(
  state: TimelineFeedRowsBuildState,
  row: TimelineRow,
): void {
  const feedRow =
    row.kind === "work" ? toTimelineFeedWorkRow(row) : row;

  if (isSummarizableWorkRow(feedRow)) {
    state.openStep.push(feedRow);
    return;
  }
  if (isTimelineStepBoundary(feedRow)) {
    closeOpenStepAsFeedSummary(state);
    state.rows.push(mapTimelineFeedBuildRowToFeedRow(feedRow, state.context));
    return;
  }

  flushOpenStepAsFeedBundles(state);
  state.rows.push(mapTimelineFeedBuildRowToFeedRow(feedRow, state.context));
}

function finishTimelineFeedRows(
  state: TimelineFeedRowsBuildState,
  closedScope: boolean,
): TimelineFeedRow[] {
  if (closedScope) {
    closeOpenStepAsFeedSummary(state);
  } else {
    flushOpenStepAsFeedBundles(state);
  }
  return state.rows;
}

export function buildTimelineFeedRows(
  args: BuildTimelineFeedRowsArgs,
): TimelineFeedRow[] {
  const state: TimelineFeedRowsBuildState = {
    context: {
      fileDiffLookup: args.fileDiffLookup,
      rowKeyForRow: args.rowKeyForRow,
    },
    openStep: [],
    rows: [],
  };
  for (const row of args.rows) {
    appendTimelineSourceRowToFeed(state, row);
  }
  return finishTimelineFeedRows(state, args.closedScope ?? false);
}

export function buildTimelineFeedRowsFromViewRows(
  args: BuildTimelineFeedRowsFromViewRowsArgs,
): TimelineFeedRow[] {
  const context: TimelineFeedRowsBuildContext = {
    fileDiffLookup: args.fileDiffLookup,
    rowKeyForRow: args.rowKeyForRow,
  };
  return args.rows.map((row) =>
    mapTimelineViewRowToFeedRow(row, context),
  );
}
