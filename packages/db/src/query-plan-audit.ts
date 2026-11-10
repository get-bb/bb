import type Database from "better-sqlite3";

export interface QueryPlanStep {
  detail: string;
}

export type QueryPlanRule = "full-scan" | "weaker-index" | "automatic-index";

export interface QueryPlanFinding {
  rule: QueryPlanRule;
  table: string;
  detail: string;
}

export type QueryPlanParameter = string | number | bigint | Buffer | null;

export interface QueryPlanAuditOptions {
  largeTables: ReadonlySet<string>;
  params?: readonly QueryPlanParameter[];
}

export type QueryPlanAudit =
  | { status: "skipped"; reason: string }
  | { status: "audited"; plan: QueryPlanStep[]; findings: QueryPlanFinding[] };

interface TableReference {
  table: string;
  name: string;
  end: number;
}

interface IndexListRow {
  name: string;
  unique: number;
}

interface IndexInfoRow {
  name: string | null;
}

interface AccessStep {
  kind: "SCAN" | "SEARCH";
  name: string;
  index: string | null;
  equalityTerms: number;
  rangeTerms: number;
  rowid: boolean;
}

const EXPLAINABLE_STATEMENT = /^\s*(?:with|select|insert|update|delete)\b/i;
const TABLE_REFERENCE =
  /\b(?:from|join|update|into)\s+("?)([A-Za-z_]\w*)\1(?:\s+(?:as\s+)?("?)([A-Za-z_]\w*)\3)?/dgi;
const NON_ALIAS_WORDS = new Set([
  "where",
  "on",
  "inner",
  "left",
  "right",
  "cross",
  "join",
  "group",
  "order",
  "limit",
  "set",
  "values",
  "select",
  "union",
  "using",
  "indexed",
  "not",
  "natural",
  "full",
  "outer",
  "having",
  "window",
  "returning",
  "default",
  "except",
  "intersect",
]);
const ACCESS_STEP =
  /^(SCAN|SEARCH) (\S+)(?: USING (?:(?:COVERING |PRIMARY KEY )?INDEX (\S+)|INTEGER PRIMARY KEY)(?: \((.*)\))?)?/;
const AUTOMATIC_INDEX = /AUTOMATIC (?:PARTIAL )?COVERING INDEX/;

export function isExplainableStatement(sql: string): boolean {
  return EXPLAINABLE_STATEMENT.test(sql);
}

function countPlaceholders(sql: string): number {
  let count = 0;
  let quote: string | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") quote = char;
    else if (char === "?") count += 1;
  }
  return count;
}

function explain(
  sqlite: Database.Database,
  sql: string,
  params: readonly QueryPlanParameter[] | undefined,
): QueryPlanStep[] | string {
  let statement: Database.Statement;
  try {
    statement = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  try {
    if (params !== undefined)
      return statement.all(...params) as QueryPlanStep[];
  } catch {}
  try {
    const placeholders = countPlaceholders(sql);
    return statement.all(
      ...Array.from({ length: placeholders }, () => null),
    ) as QueryPlanStep[];
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function parseAccessStep(detail: string): AccessStep | null {
  const match = ACCESS_STEP.exec(detail);
  if (match === null) return null;
  const constraints = match[4] ?? "";
  const terms = constraints === "" ? [] : constraints.split(" AND ");
  return {
    kind: match[1] === "SCAN" ? "SCAN" : "SEARCH",
    name: match[2],
    index: match[3] ?? null,
    equalityTerms: terms.filter((term) => /^[^<>]+=\?$/.test(term)).length,
    rangeTerms: terms.filter((term) => /[<>]\?$/.test(term)).length,
    rowid: detail.includes("INTEGER PRIMARY KEY"),
  };
}

function tableReferences(
  sql: string,
  tables: ReadonlySet<string>,
): TableReference[] {
  const references: TableReference[] = [];
  for (const match of sql.matchAll(TABLE_REFERENCE)) {
    const table = match[2];
    if (!tables.has(table)) continue;
    const alias = match[4];
    const tableSpan = match.indices?.[2];
    if (tableSpan === undefined) continue;
    const tableEnd = tableSpan[1] + match[1].length;
    if (alias === undefined || NON_ALIAS_WORDS.has(alias.toLowerCase())) {
      references.push({ table, name: table, end: tableEnd });
    } else {
      references.push({
        table,
        name: alias,
        end: (match.index ?? 0) + match[0].length,
      });
    }
  }
  return references;
}

function indexesOf(sqlite: Database.Database, table: string): IndexListRow[] {
  return sqlite
    .prepare('SELECT name, "unique" FROM pragma_index_list(?)')
    .all(table) as IndexListRow[];
}

function indexColumnCount(sqlite: Database.Database, index: string): number {
  return (
    sqlite
      .prepare("SELECT name FROM pragma_index_info(?)")
      .all(index) as IndexInfoRow[]
  ).length;
}

function stepsNamed(
  plan: readonly QueryPlanStep[],
  name: string,
): AccessStep[] {
  return plan
    .map((step) => parseAccessStep(step.detail))
    .filter((step): step is AccessStep => step?.name === name);
}

function sumTerms(
  steps: readonly AccessStep[],
  kind: "equalityTerms" | "rangeTerms",
): number {
  return steps.reduce((total, step) => total + step[kind], 0);
}

function isBestPossible(
  sqlite: Database.Database,
  steps: readonly AccessStep[],
  uniqueIndexes: ReadonlySet<string>,
): boolean {
  return steps.every(
    (step) =>
      (step.rowid && step.equalityTerms > 0) ||
      (step.index !== null &&
        uniqueIndexes.has(step.index) &&
        step.equalityTerms === indexColumnCount(sqlite, step.index)),
  );
}

function weakerIndexFindings(
  sqlite: Database.Database,
  sql: string,
  plan: readonly QueryPlanStep[],
  tables: ReadonlySet<string>,
  options: QueryPlanAuditOptions,
): QueryPlanFinding[] {
  const findings: QueryPlanFinding[] = [];
  for (const reference of tableReferences(sql, tables)) {
    if (!options.largeTables.has(reference.table)) continue;
    const baseline = stepsNamed(plan, reference.name);
    if (baseline.length === 0) continue;
    const indexes = indexesOf(sqlite, reference.table);
    const uniqueIndexes = new Set(
      indexes.filter((index) => index.unique === 1).map((index) => index.name),
    );
    if (isBestPossible(sqlite, baseline, uniqueIndexes)) continue;
    const baselineEquality = sumTerms(baseline, "equalityTerms");
    const baselineRange = sumTerms(baseline, "rangeTerms");
    for (const index of indexes) {
      if (baseline.some((step) => step.index === index.name)) continue;
      const forcedSql = `${sql.slice(0, reference.end)} INDEXED BY "${index.name}"${sql.slice(reference.end)}`;
      const forced = explain(sqlite, forcedSql, options.params);
      if (typeof forced === "string") continue;
      const forcedSteps = stepsNamed(forced, reference.name);
      const forcedEquality = sumTerms(forcedSteps, "equalityTerms");
      if (forcedEquality <= baselineEquality) continue;
      if (sumTerms(forcedSteps, "rangeTerms") < baselineRange) continue;
      findings.push({
        rule: "weaker-index",
        table: reference.table,
        detail: `${baseline.map((step) => step.index ?? step.kind).join(", ")} (${baselineEquality} equality terms) chosen over ${index.name} (${forcedEquality})`,
      });
      break;
    }
  }
  return findings;
}

export function auditQueryPlan(
  sqlite: Database.Database,
  sql: string,
  options: QueryPlanAuditOptions,
): QueryPlanAudit {
  if (!isExplainableStatement(sql)) {
    return { status: "skipped", reason: "not a DML statement" };
  }
  const plan = explain(sqlite, sql, options.params);
  if (typeof plan === "string") return { status: "skipped", reason: plan };
  const tables = new Set(
    (
      sqlite
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .all() as Array<{ name: string }>
    ).map((row) => row.name),
  );
  const aliases = new Map(
    tableReferences(sql, tables).map((reference) => [
      reference.name,
      reference.table,
    ]),
  );
  const findings: QueryPlanFinding[] = [];
  for (const step of plan) {
    const access = parseAccessStep(step.detail);
    if (access?.kind === "SCAN") {
      const table = aliases.get(access.name) ?? access.name;
      if (options.largeTables.has(table)) {
        findings.push({ rule: "full-scan", table, detail: step.detail });
      }
    }
    if (AUTOMATIC_INDEX.test(step.detail)) {
      const table = access?.name ?? "";
      findings.push({
        rule: "automatic-index",
        table: aliases.get(table) ?? table,
        detail: step.detail,
      });
    }
  }
  findings.push(...weakerIndexFindings(sqlite, sql, plan, tables, options));
  return { status: "audited", plan, findings };
}
