import Database from "better-sqlite3";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  auditQueryPlan,
  type QueryPlanParameter,
  type QueryPlanRule,
} from "./query-plan-audit.js";
import { QUERY_PLAN_ALLOWLIST } from "./query-plan-allowlist.js";
import { createMigratedConnection } from "./testing.js";

export interface QueryPlanAllowlistEntry {
  rule: QueryPlanRule;
  table: string;
  caller: string;
  reason: string;
}

export interface QueryPlanViolation {
  rule: QueryPlanRule;
  table: string;
  caller: string;
  detail: string;
  sql: string;
  plan: string[];
}

export interface QueryPlanGuard {
  takeViolations(): QueryPlanViolation[];
}

export interface InstallQueryPlanGuardOptions {
  reportPath: string | null;
}

const LARGE_TABLES: ReadonlySet<string> = new Set([
  "events",
  "thread_search_segments",
  "prompt_history_entries",
  "terminal_sessions",
]);
const GUARDED_RULES: ReadonlySet<QueryPlanRule> = new Set([
  "full-scan",
  "weaker-index",
  "automatic-index",
]);
const PASS_THROUGH_FILES = new Set([
  "packages/db/src/connection.ts",
  "packages/db/src/query-plan-guard.ts",
  "packages/db/src/query-plan-audit.ts",
]);
const UNGUARDED_FILES = new Set(["packages/db/src/migrate.ts"]);
const SOURCE_FILE =
  /^(?:apps|packages|plugins)\/[^/]+\/src\/(?!.*\.test\.tsx?$)/;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const STACK_FRAME = /^at (?:(.+?) \()?(\/[^():]+):\d+:\d+\)?$/;
const INSTALLED = Symbol.for("bb.queryPlanGuard");

type GuardedDatabaseConstructor = typeof Database & {
  [INSTALLED]?: QueryPlanGuard;
};

function sourceCaller(stack: string | undefined): string | null {
  if (stack === undefined) return null;
  for (const line of stack.split("\n").slice(1)) {
    const match = STACK_FRAME.exec(line.trim());
    if (match === null) continue;
    const path = match[2];
    if (!path.startsWith(REPO_ROOT) || path.includes("/node_modules/")) {
      continue;
    }
    const file = path.slice(REPO_ROOT.length);
    if (PASS_THROUGH_FILES.has(file)) continue;
    if (UNGUARDED_FILES.has(file) || !SOURCE_FILE.test(file)) return null;
    const functionName = (match[1] ?? "<anonymous>").replace(
      /^(?:Object|Function)\./,
      "",
    );
    return `${file}#${functionName}`;
  }
  return null;
}

function isParameterList(params: unknown[]): params is QueryPlanParameter[] {
  return params.every(
    (param) =>
      param === null ||
      typeof param === "string" ||
      typeof param === "number" ||
      typeof param === "bigint" ||
      Buffer.isBuffer(param),
  );
}

export function installQueryPlanGuard(
  options: InstallQueryPlanGuardOptions,
): QueryPlanGuard {
  const BetterSqlite = Database as GuardedDatabaseConstructor;
  const installed = BetterSqlite[INSTALLED];
  if (installed !== undefined) return installed;

  const allowed = new Set(
    QUERY_PLAN_ALLOWLIST.map(
      (entry) => `${entry.rule}\u0000${entry.table}\u0000${entry.caller}`,
    ),
  );
  const audited = new Set<string>();
  let pending: QueryPlanViolation[] = [];
  let auditDb: Database.Database | null = null;

  function audit(sql: string, caller: string, params: unknown[]): void {
    auditDb ??= createMigratedConnection().$client;
    const result = auditQueryPlan(auditDb, sql, {
      largeTables: LARGE_TABLES,
      ...(isParameterList(params) ? { params } : {}),
    });
    if (result.status !== "audited") return;
    for (const finding of result.findings) {
      if (!GUARDED_RULES.has(finding.rule)) continue;
      const isAllowed = allowed.has(
        `${finding.rule}\u0000${finding.table}\u0000${caller}`,
      );
      const violation: QueryPlanViolation = {
        rule: finding.rule,
        table: finding.table,
        caller,
        detail: finding.detail,
        sql,
        plan: result.plan.map((step) => step.detail),
      };
      if (options.reportPath !== null) {
        appendFileSync(
          options.reportPath,
          `${JSON.stringify({ ...violation, allowed: isAllowed })}\n`,
        );
      } else if (!isAllowed) {
        pending.push(violation);
      }
    }
  }

  const originalPrepare = BetterSqlite.prototype.prepare;
  function guardedPrepare(
    this: Database.Database,
    source: string,
  ): Database.Statement {
    const statement = originalPrepare.call(this, source);
    if (this === auditDb) return statement;
    const caller = sourceCaller(new Error().stack);
    if (caller === null) return statement;
    const key = `${caller}\u0000${source}`;
    if (audited.has(key)) return statement;
    for (const method of ["run", "get", "all", "iterate"] as const) {
      const original = statement[method].bind(statement) as (
        ...params: unknown[]
      ) => unknown;
      Object.defineProperty(statement, method, {
        configurable: true,
        writable: true,
        value: (...params: unknown[]) => {
          if (!audited.has(key)) {
            audited.add(key);
            audit(source, caller, params);
          }
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

  const guard: QueryPlanGuard = {
    takeViolations() {
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
