import type { TimelineFileChangeWorkRow } from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import {
  formatFileChangePath,
  getFileChangeAction,
  getFileChangeActionInfinitive,
  getFileChangeActionPastTense,
  getFileChangeActionPresentTense,
} from "./file-change-summary.js";
import {
  diffStatsDecoration,
  filterNull,
  makeTitle,
  segment,
  statusDecoration,
} from "./timeline-title-helpers.js";
import type {
  TimelineTitle,
  TimelineTitleAction,
} from "./timeline-row-title.js";
import { displayWorkApprovalStatus } from "./timeline-work-row-title-shared.js";

export function mapFileChangeTitle(
  row: TimelineFileChangeWorkRow,
): TimelineTitle {
  const status = displayWorkApprovalStatus({
    approvalStatus: row.approvalStatus,
    status: row.status,
  });
  const action = getFileChangeAction(row.change);
  const compactPath = formatFileChangePath({
    change: row.change,
    mode: "compact",
  });
  const fullPath = formatFileChangePath({ change: row.change, mode: "full" });
  const titleAction: TimelineTitleAction = {
    kind: "open-file-diff",
    // For renames, the destination path is the canonical workspace location
    // and matches what TimelineFileDiffBlock renders against.
    path: row.change.movePath ?? row.change.path,
  };
  const pathSegment = segment(compactPath, {
    em: true,
    truncate: true,
    plainText: fullPath,
    accent: "file",
  });

  switch (status) {
    case "waiting":
      return makeTitle({
        segments: [
          segment("Waiting for approval", { shimmer: true }),
          segment("to edit"),
          pathSegment,
        ],
        decorations: filterNull([diffStatsDecoration(row.change)]),
        action: titleAction,
      });
    case "denied":
      return makeTitle({
        segments: [segment("Permission denied:"), pathSegment],
        decorations: filterNull([diffStatsDecoration(row.change)]),
        action: titleAction,
      });
    case "pending":
      return makeTitle({
        segments: [
          segment(getFileChangeActionPresentTense(action), { shimmer: true }),
          pathSegment,
        ],
        decorations: filterNull([diffStatsDecoration(row.change)]),
        action: titleAction,
      });
    case "completed":
      return makeTitle({
        segments: [segment(getFileChangeActionPastTense(action)), pathSegment],
        decorations: filterNull([diffStatsDecoration(row.change)]),
        action: titleAction,
      });
    case "error":
      return makeTitle({
        segments: [
          segment(`Failed to ${getFileChangeActionInfinitive(action)}`),
          pathSegment,
        ],
        decorations: [statusDecoration("error", null)],
        action: titleAction,
      });
    case "interrupted":
      return makeTitle({
        segments: [
          segment(
            `Interrupted while ${getFileChangeActionPresentTense(action).toLowerCase()}`,
          ),
          pathSegment,
        ],
        action: titleAction,
      });
    default:
      return assertNever(status);
  }
}
