import type { TimelineFeedRow } from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import type {
  ThreadTimelineViewRow,
  TimelineViewWorkRow,
} from "./timeline-view.js";
import { mapAgentWorkFeedRow } from "./timeline-feed-work-row-agent.js";
import { mapExecutionWorkFeedRow } from "./timeline-feed-work-row-execution.js";
import { mapFileChangeWorkFeedRow } from "./timeline-feed-work-row-file-change.js";
import {
  timelineFeedBase,
  type TimelineFeedRowsBuildContext,
} from "./timeline-feed-row-helpers.js";

export type TimelineFeedRowsMapper = (
  rows: readonly ThreadTimelineViewRow[],
) => TimelineFeedRow[];

export interface MapTimelineWorkViewRowToFeedRowArgs {
  context: TimelineFeedRowsBuildContext;
  mapRowsToFeedRows: TimelineFeedRowsMapper;
  row: TimelineViewWorkRow;
}

type TimelineInteractionFeedWorkRow = Extract<
  TimelineViewWorkRow,
  { workKind: "approval" | "question" }
>;

type TimelineWebFeedWorkRow = Extract<
  TimelineViewWorkRow,
  { workKind: "image-view" | "web-fetch" | "web-search" }
>;

interface MapSimpleWorkFeedRowArgs<
  TRow extends TimelineInteractionFeedWorkRow | TimelineWebFeedWorkRow,
> {
  key: string;
  row: TRow;
}

function mapInteractionWorkFeedRow({
  key,
  row,
}: MapSimpleWorkFeedRowArgs<TimelineInteractionFeedWorkRow>): TimelineFeedRow {
  switch (row.workKind) {
    case "approval":
      if (row.approvalKind === "file-edit") {
        return {
          ...timelineFeedBase(row, key, []),
          kind: "work",
          workKind: "approval",
          status: row.status,
          interactionId: row.interactionId,
          target: row.target,
          approvalKind: "file-edit",
          lifecycle: row.lifecycle,
        };
      }
      return {
        ...timelineFeedBase(row, key, []),
        kind: "work",
        workKind: "approval",
        status: row.status,
        interactionId: row.interactionId,
        target: row.target,
        approvalKind: "permission-grant",
        lifecycle: row.lifecycle,
        grantScope: row.grantScope,
        statusReason: row.statusReason,
      };
    case "question":
      return {
        ...timelineFeedBase(row, key, []),
        kind: "work",
        workKind: "question",
        status: row.status,
        interactionId: row.interactionId,
        lifecycle: row.lifecycle,
        questions: row.questions,
        answers: row.answers,
        statusReason: row.statusReason,
      };
    default:
      return assertNever(row);
  }
}

function mapWebWorkFeedRow({
  key,
  row,
}: MapSimpleWorkFeedRowArgs<TimelineWebFeedWorkRow>): TimelineFeedRow {
  switch (row.workKind) {
    case "web-search":
      return {
        ...timelineFeedBase(row, key, []),
        kind: "work",
        workKind: "web-search",
        status: row.status,
        callId: row.callId,
        queries: row.queries,
        completedAt: row.completedAt,
      };
    case "web-fetch":
      return {
        ...timelineFeedBase(row, key, []),
        kind: "work",
        workKind: "web-fetch",
        status: row.status,
        callId: row.callId,
        url: row.url,
        prompt: row.prompt,
        pattern: row.pattern,
        completedAt: row.completedAt,
      };
    case "image-view":
      return {
        ...timelineFeedBase(row, key, []),
        kind: "work",
        workKind: "image-view",
        status: row.status,
        callId: row.callId,
        path: row.path,
        completedAt: row.completedAt,
      };
    default:
      return assertNever(row);
  }
}

export function mapTimelineWorkViewRowToFeedRow({
  context,
  mapRowsToFeedRows,
  row,
}: MapTimelineWorkViewRowToFeedRowArgs): TimelineFeedRow {
  const key = context.rowKeyForRow(row);
  switch (row.workKind) {
    case "command":
    case "tool":
      return mapExecutionWorkFeedRow({ key, row });
    case "file-change":
      return mapFileChangeWorkFeedRow({ context, key, row });
    case "web-search":
    case "web-fetch":
    case "image-view":
      return mapWebWorkFeedRow({ key, row });
    case "approval":
    case "question":
      return mapInteractionWorkFeedRow({ key, row });
    case "delegation":
    case "workflow":
      return mapAgentWorkFeedRow({ key, mapRowsToFeedRows, row });
    default:
      return assertNever(row);
  }
}
