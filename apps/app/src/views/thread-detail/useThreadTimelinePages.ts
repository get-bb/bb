import { useCallback, useEffect, useState } from "react";
import type {
  ThreadTimelineFeedResponse,
  TimelineFeedRow,
  TimelineTextPreview,
  TimelinePaginationCursor,
} from "@bb/server-contract";
import { assertNever } from "@bb/thread-view";
import { useThreadTimelineFeed } from "@/hooks/queries/thread-queries";
import * as api from "@/lib/api";

interface UseThreadTimelinePagesArgs {
  threadId: string;
}

interface UseThreadTimelinePagesResult {
  activeThinking: ThreadTimelineFeedResponse["activeThinking"];
  contextWindowUsage: ThreadTimelineFeedResponse["contextWindowUsage"];
  hasOlderTimelineRows: boolean;
  isLoadingOlderTimelineRows: boolean;
  loadOlderTimelineRows: () => Promise<void>;
  pendingTodos: ThreadTimelineFeedResponse["pendingTodos"];
  timelineError: Error | null;
  timelineLoading: boolean;
  timelineRows: readonly TimelineFeedRow[];
}

type NullableTimelinePaginationCursor = TimelinePaginationCursor | null;

export interface LoadedTimelineState {
  olderCursor: NullableTimelinePaginationCursor;
  rows: readonly TimelineFeedRow[];
  surfaceKey: string;
}

interface BuildLoadedTimelineStateArgs {
  latestRows: readonly TimelineFeedRow[];
  olderCursor: NullableTimelinePaginationCursor;
  surfaceKey: string;
}

interface AreTimelinePaginationCursorsEqualArgs {
  left: NullableTimelinePaginationCursor;
  right: NullableTimelinePaginationCursor;
}

export interface MergeLatestTimelineRowsArgs {
  latestRows: readonly TimelineFeedRow[];
  loadedRows: readonly TimelineFeedRow[];
}

interface MergeLatestTimelineRowsResult {
  hasLatestOverlap: boolean;
  rows: readonly TimelineFeedRow[];
}

interface TimelineRowIdentityEntry {
  row: TimelineFeedRow;
  signature: string;
}

type TimelineFeedSignaturePart = boolean | number | string | null | undefined;
type TimelineFeedAttachments = NonNullable<
  Extract<TimelineFeedRow, { kind: "conversation" }>["attachments"]
>;
type TimelineFeedDetail = NonNullable<TimelineFeedRow["detail"]>;
type TimelineFeedWorkRow = Extract<TimelineFeedRow, { kind: "work" }>;
type TimelineFeedWorkflowSummary = NonNullable<
  Extract<TimelineFeedWorkRow, { workKind: "workflow" }>["workflowSummary"]
>;
type TimelineFeedWorkflowUsage = NonNullable<
  Extract<TimelineFeedWorkRow, { workKind: "workflow" }>["usage"]
>;

interface PreserveTimelineRowIdentityArgs {
  nextRows: readonly TimelineFeedRow[];
  previousRows: readonly TimelineFeedRow[];
}

interface AreTimelineRowReferencesEqualArgs {
  left: readonly TimelineFeedRow[];
  right: readonly TimelineFeedRow[];
}

export interface PrependOlderTimelineRowsArgs {
  loadedRows: readonly TimelineFeedRow[];
  olderRows: readonly TimelineFeedRow[];
}

export interface MergeLoadedTimelineWithLatestArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineFeedResponse;
  surfaceKey: string;
}

export interface RecoverLoadedTimelineAfterStaleCursorArgs {
  current: LoadedTimelineState;
  latestTimeline: ThreadTimelineFeedResponse;
  surfaceKey: string;
}

function buildSurfaceKey({ threadId }: UseThreadTimelinePagesArgs): string {
  return threadId;
}

function buildLoadedTimelineState({
  latestRows,
  olderCursor,
  surfaceKey,
}: BuildLoadedTimelineStateArgs): LoadedTimelineState {
  return {
    olderCursor,
    rows: [...latestRows],
    surfaceKey,
  };
}

function areTimelinePaginationCursorsEqual({
  left,
  right,
}: AreTimelinePaginationCursorsEqualArgs): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.anchorSeq === right.anchorSeq && left.anchorId === right.anchorId;
}

function appendTimelineRowsPreservingOrder(
  target: TimelineFeedRow[],
  rows: readonly TimelineFeedRow[],
): void {
  const seenIds = new Set(target.map((row) => row.key));
  for (const row of rows) {
    if (seenIds.has(row.key)) {
      continue;
    }
    seenIds.add(row.key);
    target.push(row);
  }
}

function timelineFeedSignaturePart(value: TimelineFeedSignaturePart): string {
  if (value === null) return "<null>";
  if (value === undefined) return "<undefined>";
  return String(value);
}

function joinTimelineFeedSignatureParts(
  parts: readonly TimelineFeedSignaturePart[],
): string {
  return parts.map(timelineFeedSignaturePart).join("\u001f");
}

function timelineFeedObjectSignature(value: object | null): string {
  if (value === null) return "<null>";
  return JSON.stringify(value) ?? "";
}

function timelineFeedTextPreviewSignature(
  preview: TimelineTextPreview | null,
): string {
  if (preview === null) return "<null>";
  return joinTimelineFeedSignatureParts([
    preview.text,
    preview.fullLength,
    preview.complete,
  ]);
}

function timelineFeedAttachmentsSignature(
  attachments: TimelineFeedAttachments | null,
): string {
  if (attachments === null) return "<null>";
  return joinTimelineFeedSignatureParts([
    attachments.webImages,
    attachments.localImages,
    attachments.localFiles,
    attachments.imageUrls.join("\u001d"),
    attachments.localImagePaths.join("\u001d"),
    attachments.localFilePaths.join("\u001d"),
  ]);
}

function timelineFeedDetailSignature(
  detail: TimelineFeedDetail | null,
): string {
  if (detail === null) return "<null>";
  return joinTimelineFeedSignatureParts([
    detail.rowKey,
    detail.source.start,
    detail.source.end,
    detail.parts.join("\u001d"),
  ]);
}

function timelineFeedBaseSignature(row: TimelineFeedRow): string {
  return joinTimelineFeedSignatureParts([
    row.key,
    row.kind,
    row.turnId,
    row.source.start,
    row.source.end,
    row.startedAt,
    row.createdAt,
    timelineFeedDetailSignature(row.detail),
  ]);
}

function timelineFeedWorkflowSummarySignature(
  summary: TimelineFeedWorkflowSummary | null,
): string {
  if (summary === null) return "<null>";
  return joinTimelineFeedSignatureParts([
    summary.agentCount,
    summary.phaseCount,
    summary.settledAgentCount,
  ]);
}

function timelineFeedWorkflowUsageSignature(
  usage: TimelineFeedWorkflowUsage | null,
): string {
  if (usage === null) return "<null>";
  return joinTimelineFeedSignatureParts([
    usage.totalTokens,
    usage.toolUses,
    usage.durationMs,
  ]);
}

function timelineFeedChildRowsSignature(
  rows: readonly TimelineFeedRow[] | null,
): string {
  if (rows === null) return "<null>";
  return rows.map(timelineRowIdentitySignature).join("\u001e");
}

function timelineFeedWorkRowIdentitySignature(
  row: TimelineFeedWorkRow,
): string {
  const baseParts: TimelineFeedSignaturePart[] = [
    timelineFeedBaseSignature(row),
    row.status,
    row.workKind,
  ];

  switch (row.workKind) {
    case "command":
      return joinTimelineFeedSignatureParts([
        ...baseParts,
        row.callId,
        row.command,
        row.cwd,
        row.sourceLabel,
        timelineFeedTextPreviewSignature(row.outputPreview),
        row.exitCode,
        row.completedAt,
        row.approvalStatus,
        row.activityIntents
          .map((intent) => timelineFeedObjectSignature(intent))
          .join("\u001e"),
      ]);
    case "tool":
      return joinTimelineFeedSignatureParts([
        ...baseParts,
        row.callId,
        row.toolName,
        timelineFeedObjectSignature(row.toolArgs),
        timelineFeedTextPreviewSignature(row.outputPreview),
        row.completedAt,
        row.approvalStatus,
        row.activityIntents
          .map((intent) => timelineFeedObjectSignature(intent))
          .join("\u001e"),
      ]);
    case "file-change":
      return joinTimelineFeedSignatureParts([
        ...baseParts,
        row.callId,
        row.change.path,
        row.change.kind,
        row.change.movePath,
        timelineFeedTextPreviewSignature(row.change.diffPreview),
        row.change.diffStats.added,
        row.change.diffStats.removed,
        timelineFeedTextPreviewSignature(row.stdoutPreview),
        timelineFeedTextPreviewSignature(row.stderrPreview),
        row.approvalStatus,
      ]);
    case "web-search":
      return joinTimelineFeedSignatureParts([
        ...baseParts,
        row.callId,
        row.queries.join("\u001d"),
        row.completedAt,
      ]);
    case "web-fetch":
      return joinTimelineFeedSignatureParts([
        ...baseParts,
        row.callId,
        row.url,
        row.prompt,
        row.pattern,
        row.completedAt,
      ]);
    case "image-view":
      return joinTimelineFeedSignatureParts([
        ...baseParts,
        row.callId,
        row.path,
        row.completedAt,
      ]);
    case "approval":
      return row.approvalKind === "file-edit"
        ? joinTimelineFeedSignatureParts([
            ...baseParts,
            row.interactionId,
            row.target.itemId,
            row.target.toolName,
            row.approvalKind,
            row.lifecycle,
          ])
        : joinTimelineFeedSignatureParts([
            ...baseParts,
            row.interactionId,
            row.target.itemId,
            row.target.toolName,
            row.approvalKind,
            row.lifecycle,
            row.grantScope,
            row.statusReason,
          ]);
    case "question":
      return joinTimelineFeedSignatureParts([
        ...baseParts,
        row.interactionId,
        row.lifecycle,
        timelineFeedObjectSignature(row.questions),
        timelineFeedObjectSignature(row.answers),
        row.statusReason,
      ]);
    case "delegation":
      return joinTimelineFeedSignatureParts([
        ...baseParts,
        row.callId,
        row.toolName,
        row.subagentType,
        row.description,
        timelineFeedTextPreviewSignature(row.outputPreview),
        row.completedAt,
        row.childCount,
        timelineFeedChildRowsSignature(row.childRows),
      ]);
    case "workflow":
      return joinTimelineFeedSignatureParts([
        ...baseParts,
        row.itemId,
        row.taskType,
        row.workflowName,
        row.description,
        row.taskStatus,
        timelineFeedWorkflowSummarySignature(row.workflowSummary),
        timelineFeedWorkflowUsageSignature(row.usage),
        timelineFeedTextPreviewSignature(row.summaryPreview),
        timelineFeedTextPreviewSignature(row.errorPreview),
        row.completedAt,
      ]);
    default:
      return assertNever(row);
  }
}

function timelineRowIdentitySignature(row: TimelineFeedRow): string {
  const base = timelineFeedBaseSignature(row);
  switch (row.kind) {
    case "bundle-summary":
    case "step-summary":
      return joinTimelineFeedSignatureParts([
        base,
        row.status,
        row.title,
        row.childCount,
      ]);
    case "conversation":
      return row.role === "user"
        ? joinTimelineFeedSignatureParts([
            base,
            row.role,
            timelineFeedTextPreviewSignature(row.textPreview),
            timelineFeedAttachmentsSignature(row.attachments),
            row.initiator,
            row.senderThreadId,
            row.turnRequest.kind,
            row.turnRequest.status,
            timelineFeedObjectSignature(row.mentions),
          ])
        : joinTimelineFeedSignatureParts([
            base,
            row.role,
            timelineFeedTextPreviewSignature(row.textPreview),
            timelineFeedAttachmentsSignature(row.attachments),
          ]);
    case "system":
      if (row.systemKind === "operation") {
        return row.operationKind === "parent-change"
          ? joinTimelineFeedSignatureParts([
              base,
              row.systemKind,
              row.operationKind,
              row.title,
              timelineFeedTextPreviewSignature(row.detailPreview),
              row.status,
              row.parentChange.action,
              row.parentChange.previousParentThreadId,
              row.parentChange.previousParentThreadTitle,
              row.parentChange.nextParentThreadId,
              row.parentChange.nextParentThreadTitle,
              row.completedAt,
            ])
          : joinTimelineFeedSignatureParts([
              base,
              row.systemKind,
              row.operationKind,
              row.title,
              timelineFeedTextPreviewSignature(row.detailPreview),
              row.status,
              row.completedAt,
            ]);
      }
      return joinTimelineFeedSignatureParts([
        base,
        row.systemKind,
        row.title,
        timelineFeedTextPreviewSignature(row.detailPreview),
        row.status,
      ]);
    case "turn":
      return joinTimelineFeedSignatureParts([
        base,
        row.status,
        row.summaryCount,
        row.completedAt,
        timelineFeedChildRowsSignature(row.children),
      ]);
    case "work":
      return timelineFeedWorkRowIdentitySignature(row);
    default:
      return assertNever(row);
  }
}

function buildTimelineRowIdentityMap(
  rows: readonly TimelineFeedRow[],
): ReadonlyMap<string, TimelineRowIdentityEntry> {
  const rowsById = new Map<string, TimelineRowIdentityEntry>();
  for (const row of rows) {
    rowsById.set(row.key, {
      row,
      signature: timelineRowIdentitySignature(row),
    });
  }
  return rowsById;
}

function preserveTimelineRowIdentity({
  nextRows,
  previousRows,
}: PreserveTimelineRowIdentityArgs): TimelineFeedRow[] {
  const previousRowsById = buildTimelineRowIdentityMap(previousRows);
  return nextRows.map((row) => {
    const previous = previousRowsById.get(row.key);
    if (previous && previous.signature === timelineRowIdentitySignature(row)) {
      return previous.row;
    }
    return row;
  });
}

function areTimelineRowReferencesEqual({
  left,
  right,
}: AreTimelineRowReferencesEqualArgs): boolean {
  if (left.length !== right.length) return false;
  return left.every((row, index) => row === right[index]);
}

export function prependOlderTimelineRows({
  loadedRows,
  olderRows,
}: PrependOlderTimelineRowsArgs): TimelineFeedRow[] {
  const rows: TimelineFeedRow[] = [];
  appendTimelineRowsPreservingOrder(rows, olderRows);
  appendTimelineRowsPreservingOrder(rows, loadedRows);
  return rows;
}

export function mergeLatestTimelineRows({
  latestRows,
  loadedRows,
}: MergeLatestTimelineRowsArgs): MergeLatestTimelineRowsResult {
  const identityPreservedLatestRows = preserveTimelineRowIdentity({
    nextRows: latestRows,
    previousRows: loadedRows,
  });

  if (loadedRows.length === 0) {
    return {
      hasLatestOverlap: false,
      rows: identityPreservedLatestRows,
    };
  }

  const latestRowIds = new Set(latestRows.map((row) => row.key));
  const firstLatestOverlapIndex = loadedRows.findIndex((row) =>
    latestRowIds.has(row.key),
  );
  if (firstLatestOverlapIndex === -1) {
    return {
      hasLatestOverlap: false,
      rows: identityPreservedLatestRows,
    };
  }

  const rows = [
    ...loadedRows.slice(0, firstLatestOverlapIndex),
    ...identityPreservedLatestRows,
  ];
  if (areTimelineRowReferencesEqual({ left: loadedRows, right: rows })) {
    return {
      hasLatestOverlap: true,
      rows: loadedRows,
    };
  }

  return {
    hasLatestOverlap: true,
    rows,
  };
}

export function mergeLoadedTimelineWithLatest({
  current,
  latestTimeline,
  surfaceKey,
}: MergeLoadedTimelineWithLatestArgs): LoadedTimelineState {
  if (
    current.surfaceKey !== surfaceKey ||
    (current.rows.length === 0 && current.olderCursor === null)
  ) {
    return buildLoadedTimelineState({
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  const latestMerge = mergeLatestTimelineRows({
    latestRows: latestTimeline.rows,
    loadedRows: current.rows,
  });

  if (!latestMerge.hasLatestOverlap) {
    return buildLoadedTimelineState({
      latestRows: latestMerge.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  return {
    ...current,
    olderCursor: current.olderCursor,
    rows: latestMerge.rows,
  };
}

export function recoverLoadedTimelineAfterStaleCursor({
  current,
  latestTimeline,
  surfaceKey,
}: RecoverLoadedTimelineAfterStaleCursorArgs): LoadedTimelineState {
  if (current.surfaceKey !== surfaceKey) {
    return buildLoadedTimelineState({
      latestRows: latestTimeline.rows,
      olderCursor: latestTimeline.timelinePage.olderCursor,
      surfaceKey,
    });
  }

  const latestMerge = mergeLatestTimelineRows({
    latestRows: latestTimeline.rows,
    loadedRows: current.rows,
  });

  return {
    olderCursor: latestTimeline.timelinePage.olderCursor,
    rows: latestMerge.rows,
    surfaceKey,
  };
}

export function isStaleTimelinePaginationCursorError(error: Error): boolean {
  return (
    error instanceof api.HttpError &&
    error.status === 400 &&
    error.code === "invalid_request"
  );
}

export function useThreadTimelinePages({
  threadId,
}: UseThreadTimelinePagesArgs): UseThreadTimelinePagesResult {
  const latestTimelineQuery = useThreadTimelineFeed(threadId, {
    refetchOnMount: true,
    staleTime: Infinity,
  });
  const surfaceKey = buildSurfaceKey({ threadId });
  const [loadedTimeline, setLoadedTimeline] = useState<LoadedTimelineState>(
    () =>
      buildLoadedTimelineState({
        latestRows: [],
        olderCursor: null,
        surfaceKey,
      }),
  );
  const [isLoadingOlderTimelineRows, setIsLoadingOlderTimelineRows] =
    useState(false);
  const latestTimeline = latestTimelineQuery.data;

  useEffect(() => {
    if (!latestTimeline) {
      setLoadedTimeline((current) =>
        current.surfaceKey === surfaceKey
          ? current
          : buildLoadedTimelineState({
              latestRows: [],
              olderCursor: null,
              surfaceKey,
            }),
      );
      return;
    }

    setLoadedTimeline((current) =>
      mergeLoadedTimelineWithLatest({
        current,
        latestTimeline,
        surfaceKey,
      }),
    );
  }, [latestTimeline, surfaceKey]);
  const refetchLatestTimeline = latestTimelineQuery.refetch;

  const nextOlderCursor =
    loadedTimeline.surfaceKey === surfaceKey
      ? loadedTimeline.olderCursor
      : null;
  const hasOlderTimelineRows = nextOlderCursor !== null;
  const loadOlderTimelineRows = useCallback(async (): Promise<void> => {
    if (!nextOlderCursor || !threadId || isLoadingOlderTimelineRows) {
      return;
    }

    setIsLoadingOlderTimelineRows(true);
    try {
      const response = await api.getThreadTimelineFeed({
        beforeCursor: nextOlderCursor,
        id: threadId,
      });
      setLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) {
          return current;
        }
        return {
          olderCursor: areTimelinePaginationCursorsEqual({
            left: current.olderCursor,
            right: nextOlderCursor,
          })
            ? response.timelinePage.olderCursor
            : current.olderCursor,
          rows: prependOlderTimelineRows({
            loadedRows: current.rows,
            olderRows: response.rows,
          }),
          surfaceKey,
        };
      });
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !isStaleTimelinePaginationCursorError(error)
      ) {
        throw error;
      }

      const latestTimelineResult = await refetchLatestTimeline();
      const recoveredLatestTimeline =
        latestTimelineResult.data ?? latestTimeline;
      setLoadedTimeline((current) => {
        if (current.surfaceKey !== surfaceKey) {
          return current;
        }
        if (!recoveredLatestTimeline) {
          return {
            ...current,
            olderCursor: null,
          };
        }
        return recoverLoadedTimelineAfterStaleCursor({
          current,
          latestTimeline: recoveredLatestTimeline,
          surfaceKey,
        });
      });
    } finally {
      setIsLoadingOlderTimelineRows(false);
    }
  }, [
    isLoadingOlderTimelineRows,
    latestTimeline,
    nextOlderCursor,
    refetchLatestTimeline,
    surfaceKey,
    threadId,
  ]);

  return {
    activeThinking: latestTimeline?.activeThinking ?? null,
    contextWindowUsage: latestTimeline?.contextWindowUsage,
    hasOlderTimelineRows,
    isLoadingOlderTimelineRows,
    loadOlderTimelineRows,
    pendingTodos: latestTimeline?.pendingTodos ?? null,
    timelineError: latestTimelineQuery.error,
    timelineLoading: latestTimelineQuery.isLoading,
    timelineRows:
      loadedTimeline.surfaceKey === surfaceKey && loadedTimeline.rows.length > 0
        ? loadedTimeline.rows
        : (latestTimeline?.rows ?? []),
  };
}
