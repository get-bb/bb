import {
  isSettledWorkflowAgentState,
  LOCAL_WORKFLOW_TASK_TYPE,
} from "@bb/domain";
import type { TimelineFeedDetailPart, TimelineFeedRow } from "@bb/server-contract";
import type {
  ThreadTimelineViewRow,
  TimelineViewWorkRow,
} from "./timeline-view.js";
import {
  buildExpandableBodyFeedPreview,
  nullableTimelineFeedTextPreview,
  timelineFeedBase,
  timelineFeedDetailPartsForText,
  uniqueTimelineFeedDetailParts,
} from "./timeline-feed-row-helpers.js";

type TimelineAgentFeedWorkRow = Extract<
  TimelineViewWorkRow,
  { workKind: "delegation" | "workflow" }
>;

type TimelineFeedRowsMapper = (
  rows: readonly ThreadTimelineViewRow[],
) => TimelineFeedRow[];

interface MapAgentWorkFeedRowArgs {
  key: string;
  mapRowsToFeedRows: TimelineFeedRowsMapper;
  row: TimelineAgentFeedWorkRow;
}

export function mapAgentWorkFeedRow({
  key,
  mapRowsToFeedRows,
  row,
}: MapAgentWorkFeedRowArgs): TimelineFeedRow {
  switch (row.workKind) {
    case "delegation": {
      const outputPreview = buildExpandableBodyFeedPreview(
        row.output,
        row.status,
        row.outputDetail,
      );
      const includeChildRows = row.status === "pending";
      const hasOmittedChildRows = row.childRowsOmitted === true;
      const childRows = includeChildRows ? mapRowsToFeedRows(row.childRows) : [];
      const parts: TimelineFeedDetailPart[] = [
        ...timelineFeedDetailPartsForText("output", outputPreview),
      ];
      if (hasOmittedChildRows || childRows.length < row.childRows.length) {
        parts.push("children");
      }
      return {
        ...timelineFeedBase(row, key, parts),
        kind: "work",
        workKind: "delegation",
        status: row.status,
        callId: row.callId,
        toolName: row.toolName,
        subagentType: row.subagentType,
        description: row.description,
        outputPreview,
        completedAt: row.completedAt,
        childCount: row.childRows.length,
        childRows,
      };
    }
    case "workflow": {
      const summaryPreview = nullableTimelineFeedTextPreview(row.summary);
      const errorPreview = nullableTimelineFeedTextPreview(row.error);
      const parts: TimelineFeedDetailPart[] = [];
      if (row.workflow !== null) {
        parts.push("workflow");
      }
      parts.push(
        ...timelineFeedDetailPartsForText("workflow", summaryPreview),
        ...timelineFeedDetailPartsForText("workflow", errorPreview),
      );
      return {
        ...timelineFeedBase(row, key, uniqueTimelineFeedDetailParts(parts)),
        kind: "work",
        workKind: "workflow",
        status: row.status,
        itemId: row.itemId,
        taskType: LOCAL_WORKFLOW_TASK_TYPE,
        workflowName: row.workflowName,
        description: row.description,
        taskStatus: row.taskStatus,
        workflowSummary:
          row.workflow === null
            ? null
            : {
                agentCount: row.workflow.agents.length,
                phaseCount: row.workflow.phases.length,
                settledAgentCount: row.workflow.agents.filter((agent) =>
                  isSettledWorkflowAgentState(agent.state),
                ).length,
              },
        usage: row.usage,
        summaryPreview,
        errorPreview,
        completedAt: row.completedAt,
      };
    }
  }
}
