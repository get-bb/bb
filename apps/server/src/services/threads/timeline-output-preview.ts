import type { ThreadTimelineResponse, TimelineRow } from "@bb/server-contract";
import { sliceUtf16HeadAndTail } from "@bb/text-utils";
import { mapTimelineResponseRows } from "./timeline-output-truncation.js";

export const TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS = 4_000;
export const TIMELINE_INLINE_OUTPUT_PREVIEW_HEAD_CHARS = 2_000;
export const TIMELINE_INLINE_OUTPUT_PREVIEW_TAIL_CHARS = 1_000;

function buildTimelineOutputPreview(output: string): string {
  const { head, tail } = sliceUtf16HeadAndTail(
    output,
    TIMELINE_INLINE_OUTPUT_PREVIEW_HEAD_CHARS,
    TIMELINE_INLINE_OUTPUT_PREVIEW_TAIL_CHARS,
  );
  const omitted = output.length - head.length - tail.length;
  return [
    head,
    `\n…[${omitted.toLocaleString("en-US")} characters omitted from preview]\n`,
    tail,
  ].join("");
}

function previewRow(row: TimelineRow): TimelineRow {
  if (row.kind === "turn") {
    if (row.children === null) {
      return row;
    }
    const children = previewTimelineRowOutputs(row.children);
    return children === row.children ? row : { ...row, children };
  }
  if (row.kind !== "work") {
    return row;
  }
  if (row.workKind === "delegation") {
    if (row.childRows === null) {
      return row;
    }
    const childRows = previewTimelineRowOutputs(row.childRows);
    return childRows === row.childRows ? row : { ...row, childRows };
  }
  if (
    (row.workKind !== "command" && row.workKind !== "tool") ||
    row.output.length <= TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS
  ) {
    return row;
  }
  return {
    ...row,
    output: buildTimelineOutputPreview(row.output),
    outputPreview: row.outputPreview ?? {
      experimental_fullOutputAvailability: "available",
      totalChars: row.output.length,
    },
  };
}

export function previewTimelineRowOutputs(rows: TimelineRow[]): TimelineRow[] {
  let changed = false;
  const previewed = rows.map((row) => {
    const next = previewRow(row);
    if (next !== row) {
      changed = true;
    }
    return next;
  });
  return changed ? previewed : rows;
}

export function previewTimelineResponseOutputs(
  response: ThreadTimelineResponse,
): ThreadTimelineResponse {
  return mapTimelineResponseRows(response, previewTimelineRowOutputs);
}
