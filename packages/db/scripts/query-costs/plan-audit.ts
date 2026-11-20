import { readFileSync } from "node:fs";
import {
  createConnection,
  type DbConnection,
  type QueryPlanExecutionObserver,
} from "../../src/connection.js";
import type { HistoryFixture } from "../../src/history-fixture.js";
import {
  auditQueryPlan,
  isExplainableStatement,
  type QueryPlanFinding,
  type QueryPlanParameter,
} from "../../src/query-plan-audit.js";
import { allowlistKey } from "../../src/query-plan-guard.js";
import type { RegisteredCostCase, SeedsByGroup } from "./case.js";

interface StoredWorld {
  fixture: HistoryFixture;
  seeds: SeedsByGroup;
  pluginDatabasePaths: Readonly<Record<string, string>>;
}

interface ObservedStatement {
  sql: string;
  params: readonly QueryPlanParameter[] | undefined;
}

function isParameterList(
  params: readonly unknown[],
): params is readonly QueryPlanParameter[] {
  return params.every(
    (param) =>
      param === null ||
      typeof param === "string" ||
      typeof param === "number" ||
      typeof param === "bigint" ||
      Buffer.isBuffer(param),
  );
}

export interface CaseQueryPlanAudit {
  problems: string[];
  unusedAllowedFindings: string[];
}

export function auditCaseQueryPlans(
  cases: readonly RegisteredCostCase[],
  world: { databasePath: string; fixturePath: string; fileBacked: boolean },
): CaseQueryPlanAudit {
  const audited = cases.filter((costCase) => costCase.pluginDatabase);
  if (audited.length === 0) return { problems: [], unusedAllowedFindings: [] };
  const stored = JSON.parse(
    readFileSync(world.fixturePath, "utf8"),
  ) as StoredWorld;
  let observed: Map<string, ObservedStatement> | null = null;
  const observer: QueryPlanExecutionObserver = {
    observeFirstExecution(sql, params) {
      if (observed === null || !isExplainableStatement(sql)) return;
      const parameters = isParameterList(params) ? params : undefined;
      observed.set(
        `${sql}\u0000${JSON.stringify(parameters?.map((param) => typeof param))}`,
        { sql, params: parameters },
      );
    },
  };
  const databases = new Map<string, DbConnection>(
    Object.entries(stored.pluginDatabasePaths).map(([group, path]) => [
      group,
      createConnection(world.fileBacked ? path : readFileSync(path), {
        queryPlanObserver: () => observer,
      }),
    ]),
  );
  const allowedFindings = new Map(
    audited.flatMap((costCase) =>
      (costCase.pluginDatabase?.allowedFindings ?? []).map(
        (entry) => [allowlistKey(entry), entry] as const,
      ),
    ),
  );
  const reported = new Set<string>();
  const problems: string[] = [];
  try {
    for (const costCase of audited) {
      const db = databases.get(costCase.group);
      if (db === undefined) {
        throw new Error(`No plugin database for ${costCase.group}`);
      }
      const statements = new Map<string, ObservedStatement>();
      db.$client.exec("SAVEPOINT query_plan_audit");
      try {
        costCase.prepare?.(db, stored.fixture, stored.seeds);
        observed = statements;
        costCase.run(db, stored.fixture, stored.seeds);
      } finally {
        observed = null;
        db.$client.exec("ROLLBACK TO query_plan_audit");
        db.$client.exec("RELEASE query_plan_audit");
      }
      const largeTables = new Set(costCase.pluginDatabase?.auditedTables);
      for (const statement of statements.values()) {
        const result = auditQueryPlan(db.$client, statement.sql, {
          largeTables,
          boundedKeyColumns: new Map(),
          ...(statement.params === undefined
            ? {}
            : { params: statement.params }),
        });
        if (result.status !== "audited") continue;
        for (const finding of result.findings) {
          const key = allowlistKey({ ...finding, caller: costCase.name });
          if (allowedFindings.has(key)) {
            reported.add(key);
            continue;
          }
          problems.push(
            describeFinding(
              costCase.label,
              finding,
              statement.sql,
              result.plan.map((step) => step.detail),
            ),
          );
        }
      }
    }
  } finally {
    for (const db of databases.values()) db.$client.close();
  }
  return {
    problems,
    unusedAllowedFindings: [...allowedFindings]
      .filter(([key]) => !reported.has(key))
      .map(([, entry]) => `${entry.rule} on ${entry.table} in ${entry.caller}`),
  };
}

function describeFinding(
  label: string,
  finding: QueryPlanFinding,
  sql: string,
  plan: readonly string[],
): string {
  return `${label}: ${finding.rule} on ${finding.table}: ${finding.detail}\n    plan: ${plan.join(" | ")}\n    sql: ${sql.replace(/\s+/g, " ").slice(0, 300)}`;
}
