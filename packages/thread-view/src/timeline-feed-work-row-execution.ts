import type { TimelineFeedRow } from "@bb/server-contract";
import type { TimelineViewWorkRow } from "./timeline-view.js";
import {
  buildExpandableBodyFeedPreview,
  timelineFeedBase,
  timelineFeedDetailPartsForText,
} from "./timeline-feed-row-helpers.js";

type TimelineExecutionFeedWorkRow = Extract<
  TimelineViewWorkRow,
  { workKind: "command" | "tool" }
>;

interface MapExecutionWorkFeedRowArgs {
  key: string;
  row: TimelineExecutionFeedWorkRow;
}

export function mapExecutionWorkFeedRow({
  key,
  row,
}: MapExecutionWorkFeedRowArgs): TimelineFeedRow {
  const outputPreview = buildExpandableBodyFeedPreview(
    row.output,
    row.status,
    row.outputDetail,
  );
  const parts = timelineFeedDetailPartsForText("output", outputPreview);
  switch (row.workKind) {
    case "command":
      return {
        ...timelineFeedBase(row, key, parts),
        kind: "work",
        workKind: "command",
        status: row.status,
        callId: row.callId,
        command: row.command,
        cwd: row.cwd,
        sourceLabel: row.source,
        outputPreview,
        exitCode: row.exitCode,
        completedAt: row.completedAt,
        approvalStatus: row.approvalStatus,
        activityIntents: row.activityIntents,
      };
    case "tool":
      return {
        ...timelineFeedBase(row, key, parts),
        kind: "work",
        workKind: "tool",
        status: row.status,
        callId: row.callId,
        toolName: row.toolName,
        toolArgs: row.toolArgs,
        outputPreview,
        completedAt: row.completedAt,
        approvalStatus: row.approvalStatus,
        activityIntents: row.activityIntents,
      };
  }
}
