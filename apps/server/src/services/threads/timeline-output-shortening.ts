import {
  mapTimelineRowTree,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";
import { sliceUtf16HeadAndTail } from "@bb/text-utils";

export const DEFAULT_MAX_INLINE_OUTPUT_CHARS = 32_000;

const TRUNCATION_SUFFIX_TAIL = " more characters truncated]";

function truncationSuffix(dropped: number): string {
  return `\n…[${dropped.toLocaleString("en-US")}${TRUNCATION_SUFFIX_TAIL}`;
}

function truncateString(value: string, max: number): string {
  if (value.length <= max || value.endsWith(TRUNCATION_SUFFIX_TAIL)) {
    return value;
  }
  return `${value.slice(0, max)}${truncationSuffix(value.length - max)}`;
}

function truncateRowOutputs(row: TimelineRow, max: number): TimelineRow {
  if (row.kind !== "work") {
    return row;
  }

  switch (row.workKind) {
    case "command":
    case "tool": {
      const output = truncateString(row.output, max);
      return output === row.output ? row : { ...row, output };
    }
    case "file-change": {
      const diff =
        row.change.diff === null ? null : truncateString(row.change.diff, max);
      const stdout =
        row.stdout === null ? null : truncateString(row.stdout, max);
      const stderr =
        row.stderr === null ? null : truncateString(row.stderr, max);
      if (
        diff === row.change.diff &&
        stdout === row.stdout &&
        stderr === row.stderr
      ) {
        return row;
      }
      return {
        ...row,
        change: diff === row.change.diff ? row.change : { ...row.change, diff },
        stdout,
        stderr,
      };
    }
    case "delegation": {
      const output = truncateString(row.output, max);
      return output === row.output ? row : { ...row, output };
    }
    default:
      return row;
  }
}

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

export function previewTimelineRowOutput(row: TimelineRow): TimelineRow {
  if (row.kind !== "work") {
    return row;
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

interface ShortenTimelineResponseOutputsOptions {
  maxInlineOutputChars: number;
  preview: boolean;
}

export function shortenTimelineResponseOutputs(
  response: ThreadTimelineResponse,
  { maxInlineOutputChars, preview }: ShortenTimelineResponseOutputsOptions,
): ThreadTimelineResponse {
  const shorten = (rows: TimelineRow[]) =>
    mapTimelineRowTree(rows, (row) => {
      const truncated = truncateRowOutputs(row, maxInlineOutputChars);
      return preview ? previewTimelineRowOutput(truncated) : truncated;
    });
  const rows = shorten(response.rows);
  const updates = response.timelinePage.olderRowUpdates;
  const olderRowUpdates = updates && shorten(updates);
  if (rows === response.rows && olderRowUpdates === updates) {
    return response;
  }
  return {
    ...response,
    rows,
    timelinePage: { ...response.timelinePage, olderRowUpdates },
  };
}
