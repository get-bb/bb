import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  compareQueryPlanReport,
  formatQueryPlanViolations,
  type QueryPlanReportRow,
} from "../src/query-plan-test-guard.js";
import { listQueryFunctions } from "./query-functions.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const reportPaths = process.argv.slice(2);
if (reportPaths.length === 0) {
  console.error(
    "Usage: pnpm --filter @bb/db check:query-plan-report <report.jsonl>...",
  );
  process.exit(2);
}

const rows = reportPaths.flatMap((path) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as QueryPlanReportRow),
);
const queryFunctions = listQueryFunctions(REPO_ROOT);
const { unallowed, unusedAllowlistEntries, untestedQueryFunctions } =
  compareQueryPlanReport(rows, queryFunctions);

if (unallowed.length > 0) {
  console.error(
    `Findings missing from the allowlist:\n\n${formatQueryPlanViolations(unallowed)}\n`,
  );
}
if (unusedAllowlistEntries.length > 0) {
  console.error(
    `Allowlist entries no test run reported; delete them:\n${unusedAllowlistEntries
      .map((entry) => `  ${entry.rule} on ${entry.table} in ${entry.caller}`)
      .join("\n")}\n`,
  );
}
if (untestedQueryFunctions.length > 0) {
  console.error(
    `Query functions no @bb/db or @bb/server test runs; add a test that runs each one:\n${untestedQueryFunctions
      .map((name) => `  ${name}`)
      .join("\n")}\n`,
  );
}
if (
  unallowed.length > 0 ||
  unusedAllowlistEntries.length > 0 ||
  untestedQueryFunctions.length > 0
) {
  process.exit(1);
}
const findings = rows.filter((row) => row.kind === "finding").length;
console.log(
  `Query plan report matches the allowlist (${findings} findings) and runs all ${queryFunctions.length} query functions.`,
);
