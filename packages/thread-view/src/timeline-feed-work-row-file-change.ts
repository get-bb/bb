import type { TimelineFeedRow } from "@bb/server-contract";
import type { TimelineViewWorkRow } from "./timeline-view.js";
import {
  buildTimelineFileDiffPreview,
  nullableExpandableBodyFeedPreview,
  timelineFeedBase,
  timelineFeedDetailPartsForText,
  timelineFileChangeIndexFromRowId,
  type TimelineFeedRowsBuildContext,
} from "./timeline-feed-row-helpers.js";

type TimelineFileChangeFeedWorkRow = Extract<
  TimelineViewWorkRow,
  { workKind: "file-change" }
>;

interface MapFileChangeWorkFeedRowArgs {
  context: TimelineFeedRowsBuildContext;
  key: string;
  row: TimelineFileChangeFeedWorkRow;
}

export function mapFileChangeWorkFeedRow({
  context,
  key,
  row,
}: MapFileChangeWorkFeedRowArgs): TimelineFeedRow {
  const changeIndex = timelineFileChangeIndexFromRowId(row.id);
  const diffPreview =
    changeIndex === null
      ? nullableExpandableBodyFeedPreview(row.change.diff, row.status)
      : buildTimelineFileDiffPreview({
          changeIndex,
          diff: row.change.diff,
          lookup: context.fileDiffLookup,
          row,
        });
  const stdoutPreview = nullableExpandableBodyFeedPreview(
    row.stdout,
    row.status,
  );
  const stderrPreview = nullableExpandableBodyFeedPreview(
    row.stderr,
    row.status,
  );
  const parts = [
    ...timelineFeedDetailPartsForText("file-diff", diffPreview),
    ...timelineFeedDetailPartsForText("stdout", stdoutPreview),
    ...timelineFeedDetailPartsForText("stderr", stderrPreview),
  ];
  return {
    ...timelineFeedBase(row, key, parts),
    kind: "work",
    workKind: "file-change",
    status: row.status,
    callId: row.callId,
    change: {
      path: row.change.path,
      kind: row.change.kind,
      movePath: row.change.movePath,
      diffPreview,
      diffStats: row.change.diffStats,
    },
    stdoutPreview,
    stderrPreview,
    approvalStatus: row.approvalStatus,
  };
}
