import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { events } from "../schema.js";

/**
 * Item JSON paths that hold a provider's raw inline output. These are the only
 * fields in an event that routinely reach hundreds of kilobytes, and they are
 * the same three the retention sweep truncates on disk
 * (`truncateCompletedEventItemOutputs`).
 *
 * `$.item.result` is typed `unknown` and is occasionally a JSON object rather
 * than a string, so every path is guarded by `json_type(...) = 'text'`.
 */
const INLINE_OUTPUT_JSON_PATHS = [
  "$.item.aggregatedOutput",
  "$.item.result",
  "$.item.resultText",
] as const;

/**
 * `json_replace` ignores a path that does not exist, so pointing a pair at this
 * path is how a value is left untouched without repeating the whole expression
 * once per output field. Chosen to be a path no event payload can contain.
 */
const NOOP_JSON_PATH = "$.__bb_timeline_truncation_noop__";

/**
 * The marker appended in place of the removed characters. Kept identical to the
 * one {@link truncateTimelineRowOutput}'s server-side counterpart produces so a
 * reader cannot tell which layer truncated a given value. `%,d` groups digits
 * the same way `toLocaleString("en-US")` does.
 */
function truncationMarkerSql(originalLength: SQL, max: number): SQL {
  return sql`char(10) || '…[' || printf('%,d', ${originalLength} - ${max}) || ' more characters truncated — open the turn to view the full output]'`;
}

/**
 * `events.data`, with any inline output longer than `maxInlineOutputChars`
 * replaced by a truncated preview, evaluated inside SQLite.
 *
 * The point is what does *not* happen: a 300 KB command output is never read
 * out of the page cache into the driver, never crosses into JS, and is never
 * `JSON.parse`d — the timeline discards it a few steps later anyway, because
 * the window only renders a preview and the full text stays available from the
 * un-truncated `timeline/turn-summary-details` route. Rows whose entire payload
 * already fits are returned as stored, so the JSON functions are skipped for
 * the overwhelming majority of events.
 *
 * Two limits of SQLite's string functions are deliberate here, not oversights.
 * `length`/`substr` count Unicode code points where JavaScript counts UTF-16
 * code units, so an output of astral characters comes back at up to twice the
 * cap; the row-level pass recognises the marker and leaves such a value alone
 * rather than cutting it twice. And `length` stops at an embedded NUL, so an
 * output containing one is judged short and passes through untouched — a missed
 * saving, never a wrong value, and the row-level pass still bounds it.
 */
export function truncatedEventDataColumn(
  maxInlineOutputChars: number,
): SQL<string> {
  const pairs: SQL[] = [];
  for (const path of INLINE_OUTPUT_JSON_PATHS) {
    const value = sql`json_extract(${events.data}, ${path})`;
    const overflows = sql`json_type(${events.data}, ${path}) = 'text' AND length(${value}) > ${maxInlineOutputChars}`;
    pairs.push(
      sql`CASE WHEN ${overflows} THEN ${path} ELSE ${NOOP_JSON_PATH} END`,
      sql`substr(${value}, 1, ${maxInlineOutputChars}) || ${truncationMarkerSql(sql`length(${value})`, maxInlineOutputChars)}`,
    );
  }

  return sql<string>`CASE
    WHEN length(${events.data}) <= ${maxInlineOutputChars} THEN ${events.data}
    ELSE json_replace(${events.data}, ${sql.join(pairs, sql`, `)})
  END`;
}
