import { readFileSync } from "node:fs";
import {
  compareQueryPlanReport,
  formatQueryPlanViolations,
  type QueryPlanReportRow,
} from "../src/query-plan-guard.js";

const reportPaths = process.argv.slice(2);
if (reportPaths.length === 0) {
  console.error(
    "Usage: pnpm --filter @bb/db check:query-plan-allowlist <report.jsonl>...",
  );
  process.exit(2);
}

const rows = reportPaths.flatMap((path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as QueryPlanReportRow),
);
const { unallowed, unusedAllowlistEntries } = compareQueryPlanReport(rows);

if (unallowed.length > 0) {
  console.error(
    `Findings missing from the allowlist:\n\n${formatQueryPlanViolations(unallowed)}\n`,
  );
}
if (unusedAllowlistEntries.length > 0) {
  console.error(
    `Allowlist entries no test run reported; delete them:\n${unusedAllowlistEntries
      .map((entry) => `  ${entry.rule} on ${entry.table} in ${entry.caller}`)
      .join("\n")}`,
  );
}
if (unallowed.length > 0 || unusedAllowlistEntries.length > 0) {
  process.exit(1);
}
console.log(
  `Query plan allowlist matches the report (${rows.length} findings).`,
);
