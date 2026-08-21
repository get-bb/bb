import type { ThreadTimelineResponse, TimelineRow } from "@bb/server-contract";

/**
 * Caps the largest inline strings in a timeline window. A handful of tool/
 * command outputs and diffs are enormous (observed up to ~1 MB) and dominate
 * both payload bytes and client parse/render cost. The window only needs a
 * readable preview. Turn details return full content when the complete selected
 * slice stays under the safe byte limit.
 *
 * Conservative by design: the threshold is far above a normal output, so only
 * true outliers are touched. Conversation/message text is never truncated.
 * Rows are rebuilt only when something actually changes, so unchanged rows keep
 * their identity (cheap, and stable for delta diffing).
 *
 * The same cap is applied earlier, inside SQLite, to the three item paths that
 * dominate event bytes (`truncatedEventDataColumn`), so those values arrive
 * already shortened and this pass leaves them alone. What remains for this pass
 * is everything the read boundary cannot reach: diffs and stdout/stderr nested
 * inside a file-change's `changes` array, delegation child rows, and any row
 * assembled from more than one event.
 */
export const DEFAULT_MAX_INLINE_OUTPUT_CHARS = 32_000;

const TRUNCATION_SUFFIX_TAIL = " more characters truncated]";

/**
 * The read-boundary truncation produces this same suffix from SQL, so the
 * locale is pinned rather than left to the server's default: a reader must not
 * be able to tell which layer shortened a value.
 */
function truncationSuffix(dropped: number): string {
  return `\n…[${dropped.toLocaleString("en-US")}${TRUNCATION_SUFFIX_TAIL}`;
}

/**
 * A value the read boundary already shortened must be left alone here, and its
 * length is not a reliable test of that.
 *
 * SQLite counts characters in Unicode code points; JavaScript counts UTF-16
 * code units. A command output of emoji cut to 32,000 code points arrives as
 * 64,000 units, which looks over the cap from here — cutting it again would
 * append a second marker and report a character count measured against an
 * already-truncated string.
 */
function isAlreadyTruncated(value: string): boolean {
  return value.endsWith(TRUNCATION_SUFFIX_TAIL);
}

function truncateString(value: string, max: number): string {
  if (value.length <= max || isAlreadyTruncated(value)) {
    return value;
  }
  return `${value.slice(0, max)}${truncationSuffix(value.length - max)}`;
}

function truncateRow(row: TimelineRow, max: number): TimelineRow {
  if (row.kind === "turn") {
    if (!row.children) {
      return row;
    }
    const children = truncateRows(row.children, max);
    return children === row.children ? row : { ...row, children };
  }

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
      const childRows = truncateRows(row.childRows, max);
      if (output === row.output && childRows === row.childRows) {
        return row;
      }
      return { ...row, output, childRows };
    }
    default:
      return row;
  }
}

function truncateRows(rows: TimelineRow[], max: number): TimelineRow[] {
  let changed = false;
  const next = rows.map((row) => {
    const truncated = truncateRow(row, max);
    if (truncated !== row) {
      changed = true;
    }
    return truncated;
  });
  return changed ? next : rows;
}

export function truncateTimelineResponseOutputs(
  response: ThreadTimelineResponse,
  max: number = DEFAULT_MAX_INLINE_OUTPUT_CHARS,
): ThreadTimelineResponse {
  const rows = truncateRows(response.rows, max);
  return rows === response.rows ? response : { ...response, rows };
}
