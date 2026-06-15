import type {
  TimelineFeedDetailPart,
  TimelineFeedDetailRef,
  TimelineFeedRow,
  TimelineFeedWorkRow,
  TimelineRowBase,
  TimelineTextPreview,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import type {
  ThreadTimelineViewRow,
  TimelineBundleSummaryRow,
  TimelineStepSummaryRow,
} from "./timeline-view.js";

export interface MapTimelineFeedRowsToViewRowsArgs {
  cache?: TimelineFeedViewRowsCache;
  rows: readonly TimelineFeedRow[];
  threadId: string;
}

export interface TimelineFeedViewMetadata {
  feedDetail: TimelineFeedDetailRef | null;
}

export interface TimelineFeedSummaryMetadata {
  childCount: number;
  title: string;
}

type TimelineFeedNonSummaryViewRow = Exclude<
  ThreadTimelineViewRow,
  TimelineBundleSummaryRow | TimelineStepSummaryRow
>;

export type TimelineFeedSummaryViewRow = (
  | TimelineBundleSummaryRow
  | TimelineStepSummaryRow
) &
  TimelineFeedViewMetadata & {
    feedSummary: TimelineFeedSummaryMetadata;
  };

export type TimelineFeedViewRow =
  | (TimelineFeedNonSummaryViewRow & TimelineFeedViewMetadata)
  | TimelineFeedSummaryViewRow;

export type TimelineFeedViewRowsCache = WeakMap<
  TimelineFeedRow,
  TimelineFeedViewRow
>;

interface TimelineFeedOutputDetail {
  fullLength: number;
  previewLength: number;
}

function timelineFeedBase(
  row: TimelineFeedRow,
  threadId: string,
): TimelineRowBase & TimelineFeedViewMetadata {
  return {
    id: row.key,
    threadId,
    turnId: row.turnId,
    sourceSeqStart: row.source.start,
    sourceSeqEnd: row.source.end,
    startedAt: row.startedAt,
    createdAt: row.createdAt,
    feedDetail: row.detail,
  };
}

function outputDetailFromPreview(
  preview: TimelineTextPreview,
): TimelineFeedOutputDetail | undefined {
  return preview.complete
    ? undefined
    : {
        fullLength: preview.fullLength,
        previewLength: preview.text.length,
      };
}

export function createTimelineFeedViewRowsCache(): TimelineFeedViewRowsCache {
  return new WeakMap();
}

function mapTimelineFeedWorkRowToViewRow(
  row: TimelineFeedWorkRow,
  threadId: string,
  cache: TimelineFeedViewRowsCache,
): TimelineFeedViewRow {
  const base = timelineFeedBase(row, threadId);
  switch (row.workKind) {
    case "command":
      return {
        ...base,
        kind: "work",
        workKind: "command",
        status: row.status,
        callId: row.callId,
        command: row.command,
        cwd: row.cwd,
        source: row.sourceLabel,
        output: row.outputPreview.text,
        outputDetail: outputDetailFromPreview(row.outputPreview),
        exitCode: row.exitCode,
        completedAt: row.completedAt,
        approvalStatus: row.approvalStatus,
        activityIntents: row.activityIntents,
      };
    case "tool":
      return {
        ...base,
        kind: "work",
        workKind: "tool",
        status: row.status,
        callId: row.callId,
        toolName: row.toolName,
        toolArgs: row.toolArgs,
        output: row.outputPreview.text,
        outputDetail: outputDetailFromPreview(row.outputPreview),
        completedAt: row.completedAt,
        approvalStatus: row.approvalStatus,
        activityIntents: row.activityIntents,
      };
    case "file-change":
      return {
        ...base,
        kind: "work",
        workKind: "file-change",
        status: row.status,
        callId: row.callId,
        change: {
          path: row.change.path,
          kind: row.change.kind,
          movePath: row.change.movePath,
          diff: row.change.diffPreview?.text ?? null,
          diffStats: row.change.diffStats,
        },
        stdout: row.stdoutPreview?.text ?? null,
        stderr: row.stderrPreview?.text ?? null,
        approvalStatus: row.approvalStatus,
      };
    case "web-search":
      return {
        ...base,
        kind: "work",
        workKind: "web-search",
        status: row.status,
        callId: row.callId,
        queries: row.queries,
        completedAt: row.completedAt,
      };
    case "web-fetch":
      return {
        ...base,
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
        ...base,
        kind: "work",
        workKind: "image-view",
        status: row.status,
        callId: row.callId,
        path: row.path,
        completedAt: row.completedAt,
      };
    case "approval":
      if (row.approvalKind === "file-edit") {
        return {
          ...base,
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
        ...base,
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
        ...base,
        kind: "work",
        workKind: "question",
        status: row.status,
        interactionId: row.interactionId,
        lifecycle: row.lifecycle,
        questions: row.questions,
        answers: row.answers,
        statusReason: row.statusReason,
      };
    case "delegation":
      return {
        ...base,
        kind: "work",
        workKind: "delegation",
        status: row.status,
        callId: row.callId,
        toolName: row.toolName,
        subagentType: row.subagentType,
        description: row.description,
        output: row.outputPreview.text,
        completedAt: row.completedAt,
        childRows: mapTimelineFeedRowsToViewRows({
          cache,
          rows: row.childRows,
          threadId,
        }),
      };
    case "workflow":
      return {
        ...base,
        kind: "work",
        workKind: "workflow",
        status: row.status,
        itemId: row.itemId,
        workflowName: row.workflowName,
        description: row.description,
        taskStatus: row.taskStatus,
        workflow: null,
        usage: row.usage,
        summary: row.summaryPreview?.text ?? null,
        error: row.errorPreview?.text ?? null,
        completedAt: row.completedAt,
      };
    default:
      return assertNever(row);
  }
}

function mapTimelineFeedRowToViewRow(
  row: TimelineFeedRow,
  threadId: string,
  cache: TimelineFeedViewRowsCache,
): TimelineFeedViewRow {
  const cached = cache.get(row);
  if (cached) return cached;

  const base = timelineFeedBase(row, threadId);
  let viewRow: TimelineFeedViewRow;
  switch (row.kind) {
    case "bundle-summary":
    case "step-summary":
      viewRow = {
        ...base,
        kind: row.kind,
        status: row.status,
        children: [],
        feedSummary: {
          childCount: row.childCount,
          title: row.title,
        },
      };
      break;
    case "conversation":
      if (row.role === "user") {
        viewRow = {
          ...base,
          kind: "conversation",
          role: "user",
          text: row.textPreview.text,
          attachments: row.attachments,
          initiator: row.initiator,
          senderThreadId: row.senderThreadId,
          turnRequest: row.turnRequest,
          mentions: row.mentions,
        };
        break;
      }
      viewRow = {
        ...base,
        kind: "conversation",
        role: "assistant",
        text: row.textPreview.text,
        attachments: row.attachments,
        turnRequest: null,
      };
      break;
    case "system":
      if (row.systemKind === "operation") {
        if (row.operationKind === "parent-change") {
          viewRow = {
            ...base,
            kind: "system",
            systemKind: "operation",
            operationKind: "parent-change",
            title: row.title,
            detail: row.detailPreview?.text ?? null,
            status: row.status,
            parentChange: row.parentChange,
            completedAt: row.completedAt,
          };
          break;
        }
        viewRow = {
          ...base,
          kind: "system",
          systemKind: "operation",
          operationKind: row.operationKind,
          title: row.title,
          detail: row.detailPreview?.text ?? null,
          status: row.status,
          completedAt: row.completedAt,
        };
        break;
      }
      viewRow = {
        ...base,
        kind: "system",
        systemKind: row.systemKind,
        title: row.title,
        detail: row.detailPreview?.text ?? null,
        status: row.status,
      };
      break;
    case "turn":
      viewRow = {
        ...base,
        kind: "turn",
        turnId: row.turnId,
        status: row.status,
        summaryCount: row.summaryCount,
        completedAt: row.completedAt,
        children:
          row.children === null
            ? null
            : mapTimelineFeedRowsToViewRows({
                cache,
                rows: row.children,
                threadId,
              }),
      };
      break;
    case "work":
      viewRow = mapTimelineFeedWorkRowToViewRow(row, threadId, cache);
      break;
    default:
      viewRow = assertNever(row);
  }
  cache.set(row, viewRow);
  return viewRow;
}

export function mapTimelineFeedRowsToViewRows({
  cache = createTimelineFeedViewRowsCache(),
  rows,
  threadId,
}: MapTimelineFeedRowsToViewRowsArgs): TimelineFeedViewRow[] {
  return rows.map((row) => mapTimelineFeedRowToViewRow(row, threadId, cache));
}

function hasTimelineFeedMetadata(
  row: ThreadTimelineViewRow,
): row is TimelineFeedViewRow {
  return "feedDetail" in row;
}

export function getTimelineFeedDetail(
  row: ThreadTimelineViewRow,
): TimelineFeedDetailRef | null {
  return hasTimelineFeedMetadata(row) ? row.feedDetail : null;
}

export function hasTimelineFeedDetailPart(
  row: ThreadTimelineViewRow,
  part: TimelineFeedDetailPart,
): boolean {
  return getTimelineFeedDetail(row)?.parts.includes(part) ?? false;
}

export function isTimelineFeedSummaryViewRow(
  row: ThreadTimelineViewRow,
): row is TimelineFeedSummaryViewRow {
  return (
    (row.kind === "bundle-summary" || row.kind === "step-summary") &&
    "feedSummary" in row
  );
}
