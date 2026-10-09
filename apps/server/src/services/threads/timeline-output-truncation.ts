import {
  mapTimelineRowTree,
  type ThreadTimelineResponse,
  type TimelineRow,
} from "@bb/server-contract";

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

function truncateRow(row: TimelineRow, max: number): TimelineRow {
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

function truncateRows(rows: TimelineRow[], max: number): TimelineRow[] {
  return mapTimelineRowTree(rows, (row) => truncateRow(row, max));
}

export function truncateTimelineResponseOutputs(
  response: ThreadTimelineResponse,
  max: number = DEFAULT_MAX_INLINE_OUTPUT_CHARS,
): ThreadTimelineResponse {
  return mapTimelineResponseRows(response, (rows) => truncateRows(rows, max));
}

export function mapTimelineResponseRows(
  response: ThreadTimelineResponse,
  map: (rows: TimelineRow[]) => TimelineRow[],
): ThreadTimelineResponse {
  const rows = map(response.rows);
  const updates = response.timelinePage.olderRowUpdates;
  const olderRowUpdates = updates && map(updates);
  if (rows === response.rows && olderRowUpdates === updates) {
    return response;
  }
  return {
    ...response,
    rows,
    timelinePage: { ...response.timelinePage, olderRowUpdates },
  };
}
