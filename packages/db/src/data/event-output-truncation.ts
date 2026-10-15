import { storedText } from "../stored-text.js";
import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { RETAINED_EVENT_OUTPUT_TARGETS } from "../retained-event-output.js";
import { events } from "../schema.js";

const INLINE_OUTPUT_JSON_PATHS = Array.from(
  new Set(
    RETAINED_EVENT_OUTPUT_TARGETS.map(
      (target) => `$.item.${target.outputPath}`,
    ),
  ),
);

const NOOP_JSON_PATH = "$.__bb_timeline_truncation_noop__";

function truncationMarkerSql(originalLength: SQL, max: number | SQL): SQL {
  return sql`char(10) || '…[' || printf('%,d', ${originalLength} - ${max}) || ' more characters truncated]'`;
}

export function truncatedEventDataColumn(
  maxInlineOutputChars: number | SQL,
  data: SQL<string> = sql<string>`${storedText(events.data)}`,
): SQL<string> {
  const pairs: SQL[] = [];
  for (const path of INLINE_OUTPUT_JSON_PATHS) {
    const value = sql`json_extract(${data}, ${path})`;
    const overflows = sql`json_type(${data}, ${path}) = 'text' AND length(${value}) > ${maxInlineOutputChars}`;
    pairs.push(
      sql`CASE WHEN ${overflows} THEN ${path} ELSE ${NOOP_JSON_PATH} END`,
      sql`substr(${value}, 1, ${maxInlineOutputChars}) || ${truncationMarkerSql(sql`length(${value})`, maxInlineOutputChars)}`,
    );
  }

  return sql<string>`CASE
    WHEN length(${data}) <= ${maxInlineOutputChars} THEN ${data}
    ELSE json_replace(${data}, ${sql.join(pairs, sql`, `)})
  END`;
}
