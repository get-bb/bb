import type { ThreadTimelineResponse, TimelineRow } from "@bb/server-contract";

/**
 * Replaces the inline `output` of the default window's top-level command/tool
 * rows with a head+tail preview once it grows past a small threshold.
 *
 * In the default (summary) window every completed turn is already collapsed to
 * a `turn` row whose children load on demand, so the only rows that still
 * carry outputs are the running turn's. A long tool session accumulates
 * hundreds of kilobytes there (measured 264 KB across 138 command rows) and
 * every poll re-ships and re-parses it, although the rows render collapsed.
 * The preview keeps the first and last lines readable and marks the row with
 * `outputPreview` so a client can fetch the whole output through
 * `timelineTurnSummaryDetails` when the user expands it.
 *
 * Only the default window is previewed: `includeNestedRows` consumers (the CLI
 * verbose log, SDK callers that ask for it) receive the full inline outputs
 * they asked for, still bounded by the 32 K inline cap.
 *
 * Rows are rebuilt only when something changes so unchanged rows keep their
 * identity for delta diffing.
 */
export const TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS = 4_000;
export const TIMELINE_INLINE_OUTPUT_PREVIEW_HEAD_CHARS = 2_000;
export const TIMELINE_INLINE_OUTPUT_PREVIEW_TAIL_CHARS = 1_000;

export function buildTimelineOutputPreview(output: string): string {
  const omitted =
    output.length -
    TIMELINE_INLINE_OUTPUT_PREVIEW_HEAD_CHARS -
    TIMELINE_INLINE_OUTPUT_PREVIEW_TAIL_CHARS;
  return [
    output.slice(0, TIMELINE_INLINE_OUTPUT_PREVIEW_HEAD_CHARS),
    `\n…[${omitted.toLocaleString("en-US")} characters omitted from preview]\n`,
    output.slice(output.length - TIMELINE_INLINE_OUTPUT_PREVIEW_TAIL_CHARS),
  ].join("");
}

function previewRow(row: TimelineRow): TimelineRow {
  if (
    row.kind !== "work" ||
    (row.workKind !== "command" && row.workKind !== "tool") ||
    row.outputPreview !== undefined ||
    row.output.length <= TIMELINE_INLINE_OUTPUT_PREVIEW_THRESHOLD_CHARS
  ) {
    return row;
  }
  return {
    ...row,
    output: buildTimelineOutputPreview(row.output),
    outputPreview: { totalChars: row.output.length },
  };
}

export function previewTimelineResponseOutputs(
  response: ThreadTimelineResponse,
): ThreadTimelineResponse {
  let changed = false;
  const rows = response.rows.map((row) => {
    const previewed = previewRow(row);
    if (previewed !== row) {
      changed = true;
    }
    return previewed;
  });
  return changed ? { ...response, rows } : response;
}
