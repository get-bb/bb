import Database from "better-sqlite3";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  allowlistKey,
  captureQueryCallSite,
  createQueryPlanAuditor,
  type QueryPlanAllowlistEntry,
  type QueryPlanFindingReport,
  type QueryPlanViolation,
  type SourceFrame,
} from "./query-plan-guard.js";
import { QUERY_PLAN_ALLOWLIST } from "./query-plan-allowlist.js";
import { createMigratedConnection } from "./testing.js";

export type QueryPlanReportRow =
  | ({ kind: "finding" } & QueryPlanFindingReport)
  | { kind: "executed"; functions: string[] };

export interface QueryPlanReportComparison {
  unallowed: QueryPlanFindingReport[];
  unusedAllowlistEntries: QueryPlanAllowlistEntry[];
  untestedQueryFunctions: string[];
}

export interface TestQueryPlanGuard {
  takeViolations(): QueryPlanViolation[];
}

export interface InstallTestQueryPlanGuardOptions {
  reportPath: string | null;
}

const DATA_FILE = /^packages\/db\/src\/data\//;
const DEFAULT_STACK_DEPTH = 10;
const REPORT_STACK_DEPTH = 40;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INSTALLED = Symbol.for("bb.queryPlanTestGuard");

type GuardedDatabaseConstructor = typeof Database & {
  [INSTALLED]?: TestQueryPlanGuard;
};

export function installTestQueryPlanGuard(
  options: InstallTestQueryPlanGuardOptions,
): TestQueryPlanGuard {
  const BetterSqlite = Database as GuardedDatabaseConstructor;
  const installed = BetterSqlite[INSTALLED];
  if (installed !== undefined) return installed;

  const reportPath = options.reportPath;
  let pending: QueryPlanViolation[] = [];
  const reportedFunctions = new Set<string>();
  const report = (row: QueryPlanReportRow) => {
    if (reportPath !== null) {
      appendFileSync(reportPath, `${JSON.stringify(row)}\n`);
    }
  };
  const recordExecutedFunctions = (frames: readonly SourceFrame[]) => {
    const functions: string[] = [];
    for (const frame of frames) {
      if (!DATA_FILE.test(frame.file)) continue;
      const name = `${frame.file}#${frame.functionName}`;
      if (reportedFunctions.has(name)) continue;
      reportedFunctions.add(name);
      functions.push(name);
    }
    if (functions.length > 0) report({ kind: "executed", functions });
  };

  const originalPrepare = BetterSqlite.prototype.prepare;
  const auditDatabase = createMigratedConnection().$client;
  const stackDepth =
    reportPath === null ? DEFAULT_STACK_DEPTH : REPORT_STACK_DEPTH;
  const auditor = createQueryPlanAuditor({
    auditDatabase,
    bundle: null,
    onFinding(finding) {
      if (reportPath !== null) {
        report({ kind: "finding", ...finding });
      } else if (!finding.allowed) {
        const { allowed: _allowed, ...violation } = finding;
        pending.push(violation);
      }
    },
    onQueued() {},
  });

  function guardedPrepare(
    this: Database.Database,
    source: string,
  ): Database.Statement {
    const statement = originalPrepare.call(this, source);
    if (this === auditDatabase) return statement;
    const { caller, frames } = captureQueryCallSite(stackDepth, {
      root: REPO_ROOT,
      bundle: null,
    });
    if (reportPath !== null) recordExecutedFunctions(frames);
    if (caller === null) return statement;
    for (const method of ["run", "get", "all", "iterate"] as const) {
      const original = statement[method].bind(statement) as (
        ...params: unknown[]
      ) => unknown;
      Object.defineProperty(statement, method, {
        configurable: true,
        writable: true,
        value: (...params: unknown[]) => {
          auditor.observe(source, params, caller);
          return original(...params);
        },
      });
    }
    return statement;
  }
  Object.defineProperty(BetterSqlite.prototype, "prepare", {
    configurable: true,
    writable: true,
    value: guardedPrepare,
  });

  const guard: TestQueryPlanGuard = {
    takeViolations() {
      auditor.flush();
      const violations = pending;
      pending = [];
      return violations;
    },
  };
  BetterSqlite[INSTALLED] = guard;
  return guard;
}

export function formatQueryPlanViolations(
  violations: readonly QueryPlanViolation[],
): string {
  return violations
    .map(
      (violation) =>
        `${violation.rule} on ${violation.table} in ${violation.caller}: ${violation.detail}\n  plan: ${violation.plan.join(" | ")}\n  sql: ${violation.sql.replace(/\s+/g, " ").slice(0, 400)}`,
    )
    .join("\n\n");
}

export function compareQueryPlanReport(
  rows: readonly QueryPlanReportRow[],
  queryFunctions: readonly string[],
): QueryPlanReportComparison {
  const findings = rows.filter((row) => row.kind === "finding");
  const executed = new Set(
    rows.flatMap((row) => (row.kind === "executed" ? row.functions : [])),
  );
  const reported = new Set(findings.map(allowlistKey));
  return {
    unallowed: findings
      .filter((row) => !row.allowed)
      .map(({ kind: _kind, ...finding }) => finding),
    unusedAllowlistEntries: QUERY_PLAN_ALLOWLIST.filter(
      (entry) => !reported.has(allowlistKey(entry)),
    ),
    untestedQueryFunctions: queryFunctions.filter(
      (name) => !executed.has(name),
    ),
  };
}
