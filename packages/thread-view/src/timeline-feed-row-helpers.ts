import type {
  TimelineCommandWorkRow,
  TimelineFeedDetailPart,
  TimelineFeedRow,
  TimelineRow,
  TimelineRowBase,
  TimelineRowStatus,
  TimelineTextPreview,
  TimelineWorkRow,
} from "@bb/server-contract";
import type {
  ThreadTimelineViewRow,
  TimelineViewWorkRow,
} from "./timeline-view.js";

type TimelineFeedNonWorkRowKind = Exclude<TimelineFeedRow["kind"], "work">;

export type TimelineFeedKeyRow = TimelineRowBase &
  (
    | { kind: "work"; workKind: TimelineWorkRow["workKind"] }
    | { kind: TimelineFeedNonWorkRowKind }
  );

export type TimelineFeedRowKeyBuilder = (row: TimelineFeedKeyRow) => string;
export type TimelineFeedFileDiffLookupFactory = (
  rows: readonly TimelineRow[],
) => TimelineFeedFileDiffLookup | null;

type TimelineWorkOutputDetail = NonNullable<
  TimelineCommandWorkRow["outputDetail"]
>;
export type TimelineFileChangeViewWorkRow = Extract<
  TimelineViewWorkRow,
  { workKind: "file-change" }
>;
type TimelineFeedBaseFields = Pick<
  TimelineFeedRow,
  "key" | "turnId" | "source" | "startedAt" | "createdAt" | "detail"
>;

export interface TimelineFeedFileDiffMetadata {
  originalLength: number;
}

export interface TimelineFeedFileDiffLookupArgs {
  changeIndex: number;
  row: TimelineFileChangeViewWorkRow;
}

export interface TimelineFeedFileDiffLookup {
  getMetadata(
    args: TimelineFeedFileDiffLookupArgs,
  ): TimelineFeedFileDiffMetadata | null;
  getStoredDiff(args: TimelineFeedFileDiffLookupArgs): string | null;
}

export interface BuildTimelineFeedRowsArgs {
  closedScope?: boolean;
  fileDiffLookup: TimelineFeedFileDiffLookup | null;
  rowKeyForRow: TimelineFeedRowKeyBuilder;
  rows: readonly TimelineRow[];
}

export interface BuildTimelineFeedRowsFromViewRowsArgs {
  fileDiffLookup: TimelineFeedFileDiffLookup | null;
  rowKeyForRow: TimelineFeedRowKeyBuilder;
  rows: readonly ThreadTimelineViewRow[];
}

export interface TimelineFeedRowsBuildContext {
  fileDiffLookup: TimelineFeedFileDiffLookup | null;
  rowKeyForRow: TimelineFeedRowKeyBuilder;
}

export interface BuildTimelineFileDiffPreviewArgs {
  changeIndex: number;
  diff: string | null;
  lookup: TimelineFeedFileDiffLookup | null;
  row: TimelineFileChangeViewWorkRow;
}

const TIMELINE_FEED_TEXT_PREVIEW_HEAD_CHARS = 1024;
const TIMELINE_FEED_TEXT_PREVIEW_TAIL_CHARS = 1024;
const TIMELINE_FEED_TEXT_PREVIEW_THRESHOLD_CHARS =
  TIMELINE_FEED_TEXT_PREVIEW_HEAD_CHARS + TIMELINE_FEED_TEXT_PREVIEW_TAIL_CHARS;
const TIMELINE_FEED_TEXT_PREVIEW_MARKER =
  "\n\n[... detail omitted from timeline feed; expand row to load full detail ...]\n\n";
const TIMELINE_FILE_CHANGE_ROW_ID_SUFFIX_PATTERN = /:file-change:(\d+)$/u;

export function timelineFileChangeIndexFromRowId(
  rowId: string,
): number | null {
  const match = TIMELINE_FILE_CHANGE_ROW_ID_SUFFIX_PATTERN.exec(rowId);
  if (!match) {
    return null;
  }
  const changeIndex = Number(match[1]);
  return Number.isSafeInteger(changeIndex) && changeIndex >= 0
    ? changeIndex
    : null;
}

export function buildTimelineFeedTextPreview(
  text: string,
): TimelineTextPreview {
  if (text.length <= TIMELINE_FEED_TEXT_PREVIEW_THRESHOLD_CHARS) {
    return {
      complete: true,
      fullLength: text.length,
      text,
    };
  }

  return {
    complete: false,
    fullLength: text.length,
    text: [
      text.slice(0, TIMELINE_FEED_TEXT_PREVIEW_HEAD_CHARS),
      TIMELINE_FEED_TEXT_PREVIEW_MARKER,
      text.slice(-TIMELINE_FEED_TEXT_PREVIEW_TAIL_CHARS),
    ].join(""),
  };
}

export function nullableTimelineFeedTextPreview(
  text: string | null,
): TimelineTextPreview | null {
  return text === null ? null : buildTimelineFeedTextPreview(text);
}

export function buildOmittedTimelineFeedTextPreview(
  text: string,
  outputDetail: TimelineWorkOutputDetail | undefined,
): TimelineTextPreview {
  const fullLength = outputDetail?.fullLength ?? text.length;
  return {
    complete: fullLength <= text.length,
    fullLength,
    text: "",
  };
}

export function buildExpandableBodyFeedPreview(
  text: string,
  status: TimelineRowStatus | null,
  outputDetail: TimelineWorkOutputDetail | undefined,
): TimelineTextPreview {
  return status === "pending"
    ? buildTimelineFeedTextPreview(text)
    : buildOmittedTimelineFeedTextPreview(text, outputDetail);
}

export function nullableExpandableBodyFeedPreview(
  text: string | null,
  status: TimelineRowStatus | null,
): TimelineTextPreview | null {
  return text === null
    ? null
    : buildExpandableBodyFeedPreview(text, status, undefined);
}

export function buildTimelineFileDiffPreview({
  changeIndex,
  diff,
  lookup,
  row,
}: BuildTimelineFileDiffPreviewArgs): TimelineTextPreview | null {
  if (diff === null) {
    return null;
  }
  if (lookup === null) {
    return buildExpandableBodyFeedPreview(diff, row.status, undefined);
  }

  const metadata = lookup.getMetadata({ changeIndex, row });
  if (metadata === null) {
    return buildExpandableBodyFeedPreview(diff, row.status, undefined);
  }

  if (row.status === "pending") {
    return buildTimelineFeedTextPreview(
      lookup.getStoredDiff({ changeIndex, row }) ?? diff,
    );
  }

  return buildOmittedTimelineFeedTextPreview(diff, {
    fullLength: metadata.originalLength,
    previewLength: diff.length,
  });
}

export function timelineFeedDetailRef(
  row: TimelineRowBase,
  key: string,
  parts: readonly TimelineFeedDetailPart[],
): NonNullable<TimelineFeedRow["detail"]> | null {
  return parts.length === 0
    ? null
    : {
        rowKey: key,
        source: {
          start: row.sourceSeqStart,
          end: row.sourceSeqEnd,
        },
        parts: [...parts],
      };
}

export function timelineFeedBase(
  row: TimelineRowBase,
  key: string,
  parts: readonly TimelineFeedDetailPart[],
): TimelineFeedBaseFields {
  return {
    key,
    turnId: row.turnId,
    source: {
      start: row.sourceSeqStart,
      end: row.sourceSeqEnd,
    },
    startedAt: row.startedAt,
    createdAt: row.createdAt,
    detail: timelineFeedDetailRef(row, key, parts),
  };
}

export function timelineFeedDetailPartsForText(
  part: TimelineFeedDetailPart,
  preview: TimelineTextPreview | null,
): TimelineFeedDetailPart[] {
  return preview !== null && !preview.complete ? [part] : [];
}

export function uniqueTimelineFeedDetailParts(
  parts: readonly TimelineFeedDetailPart[],
): TimelineFeedDetailPart[] {
  return [...new Set(parts)];
}
