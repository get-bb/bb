import type { TimelineRow, TimelineRowStatus } from "@bb/server-contract";
import { sliceUtf16Head } from "@bb/text-utils";
import { parseSentThreadMessage } from "@bb/thread-view";

export const TIMELINE_DEFERRED_CONTENT_MIN_CHARS = 1_000;

export const TIMELINE_DEFERRED_COMMAND_PREFIX_CHARS = 300;

export function timelineRowItemId(row: TimelineRow): string | null {
  if (row.kind === "work" && "callId" in row) {
    return row.callId;
  }
  if (
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind !== "parent-change"
  ) {
    return row.reasoningId ?? null;
  }
  return null;
}

function isSettled(row: {
  status: TimelineRowStatus | null;
  turnId: string | null;
}): boolean {
  return row.turnId !== null && row.status !== null && row.status !== "pending";
}

function deferRowContent(row: TimelineRow): TimelineRow {
  if (row.kind === "work") {
    if (!isSettled(row)) {
      return row;
    }
    switch (row.workKind) {
      case "command": {
        if (
          row.output.length + row.command.length <=
            TIMELINE_DEFERRED_CONTENT_MIN_CHARS ||
          parseSentThreadMessage(row) !== null
        ) {
          return row;
        }
        const { outputPreview: _outputPreview, ...rest } = row;
        return {
          ...rest,
          command: sliceUtf16Head(
            row.command,
            TIMELINE_DEFERRED_COMMAND_PREFIX_CHARS,
          ),
          output: "",
          contentDeferred: true,
        };
      }
      case "tool": {
        if (row.output.length <= TIMELINE_DEFERRED_CONTENT_MIN_CHARS) {
          return row;
        }
        const { outputPreview: _outputPreview, ...rest } = row;
        return { ...rest, output: "", contentDeferred: true };
      }
      case "file-change": {
        const chars =
          (row.change.diff?.length ?? 0) +
          (row.stdout?.length ?? 0) +
          (row.stderr?.length ?? 0);
        if (chars <= TIMELINE_DEFERRED_CONTENT_MIN_CHARS) {
          return row;
        }
        return {
          ...row,
          change: { ...row.change, diff: null },
          stdout: null,
          stderr: null,
          contentDeferred: true,
        };
      }
      default:
        return row;
    }
  }
  if (
    row.kind === "system" &&
    row.systemKind === "operation" &&
    row.operationKind !== "parent-change" &&
    isSettled(row) &&
    row.reasoningId !== undefined &&
    row.detail !== null &&
    row.detail.length > TIMELINE_DEFERRED_CONTENT_MIN_CHARS
  ) {
    return { ...row, detail: null, contentDeferred: true };
  }
  return row;
}

export function deferSettledTimelineRow(row: TimelineRow): TimelineRow {
  if (
    row.kind === "work" &&
    row.workKind === "delegation" &&
    row.childRows !== null &&
    row.childRows.length > 0 &&
    isSettled(row)
  ) {
    return { ...row, childRows: null };
  }
  return deferRowContent(row);
}
