import type Database from "better-sqlite3";

export interface QueryPlanStep {
  id: number;
  parent: number;
  detail: string;
}

export type QueryPlanRule =
  | "full-scan"
  | "weaker-index"
  | "automatic-index"
  | "correlated-subquery"
  | "nested-loop"
  | "json-filter";

export interface QueryPlanFinding {
  rule: QueryPlanRule;
  table: string;
  detail: string;
}

export type QueryPlanParameter = string | number | bigint | Buffer | null;

export interface QueryPlanAuditOptions {
  largeTables: ReadonlySet<string>;
  boundedKeyColumns: ReadonlyMap<string, ReadonlySet<string>>;
  params?: readonly QueryPlanParameter[];
}

export type QueryPlanAudit =
  | { status: "skipped"; reason: string }
  | { status: "audited"; plan: QueryPlanStep[]; findings: QueryPlanFinding[] };

interface TableReference {
  table: string;
  name: string;
  start: number;
  end: number;
}

interface SqlToken {
  text: string;
  start: number;
  depth: number;
}

interface JsonOperand {
  qualifier: string | null;
  expression: string;
}

interface JsonFilter {
  name: string | null;
  expression: string;
  limited: boolean;
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
  equalityColumns: string[];
  rangeTerms: number;
  rowid: boolean;
  exists: boolean;
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
  /^(SCAN|SEARCH) (\S+)( EXISTS)?(?: USING (?:(?:COVERING |PRIMARY KEY )?INDEX (\S+)|INTEGER PRIMARY KEY)(?: \((.*)\))?)?/;
const AUTOMATIC_INDEX = /AUTOMATIC (?:PARTIAL )?COVERING INDEX/;
const CORRELATED_SUBQUERY = /^CORRELATED (?:SCALAR|LIST) SUBQUERY\b/;
const SQL_TOKEN = /'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|[A-Za-z_]\w*|->>?|\S/g;
const IDENTIFIER = /^(?:[A-Za-z_]\w*|"(?:""|[^"])*")$/;
const CLAUSE_KEYWORDS = new Set([
  "select",
  "from",
  "join",
  "where",
  "on",
  "group",
  "order",
  "having",
  "limit",
  "set",
  "values",
  "returning",
  "window",
]);
const FILTER_CLAUSES = new Set(["where", "on", "having"]);

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
  const constraints = match[5] ?? "";
  const terms = constraints === "" ? [] : constraints.split(" AND ");
  return {
    kind: match[1] === "SCAN" ? "SCAN" : "SEARCH",
    name: match[2],
    index: match[4] ?? null,
    exists: match[3] !== undefined,
    equalityTerms: terms.filter((term) => /^(?:<expr>|[^<>]+)=\?$/.test(term))
      .length,
    equalityColumns: terms.flatMap((term) => {
      const column = /^(\w+)=\?$/.exec(term);
      return column === null ? [] : [column[1]];
    }),
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
    const start = match.index ?? 0;
    if (alias === undefined || NON_ALIAS_WORDS.has(alias.toLowerCase())) {
      references.push({ table, name: table, start, end: tableEnd });
    } else {
      references.push({
        table,
        name: alias,
        start,
        end: start + match[0].length,
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

function indexColumns(sqlite: Database.Database, index: string): string[] {
  return (
    sqlite
      .prepare("SELECT name FROM pragma_index_info(?)")
      .all(index) as IndexInfoRow[]
  ).flatMap((row) => (row.name === null ? [] : [row.name]));
}

function indexColumnCount(sqlite: Database.Database, index: string): number {
  return indexColumns(sqlite, index).length;
}

function isBoundedLookup(
  sqlite: Database.Database,
  table: string,
  access: AccessStep,
  options: QueryPlanAuditOptions,
): boolean {
  if (access.rowid && access.equalityTerms > 0) return true;
  const equal = new Set(access.equalityColumns);
  const boundedKeys = options.boundedKeyColumns.get(table);
  if (boundedKeys !== undefined && [...equal].some((c) => boundedKeys.has(c))) {
    return true;
  }
  return indexesOf(sqlite, table).some(
    (index) =>
      index.unique === 1 &&
      indexColumns(sqlite, index.name).every((column) => equal.has(column)),
  );
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

function correlatedSubquery(
  plan: readonly QueryPlanStep[],
  step: QueryPlanStep,
  access: AccessStep,
): string | null {
  if (access.exists) return "EXISTS subquery joined per outer row";
  const byId = new Map(plan.map((candidate) => [candidate.id, candidate]));
  let current = byId.get(step.parent);
  while (current !== undefined) {
    if (CORRELATED_SUBQUERY.test(current.detail)) return current.detail;
    current = byId.get(current.parent);
  }
  return null;
}

function correlatedSubqueryFindings(
  sqlite: Database.Database,
  plan: readonly QueryPlanStep[],
  aliases: ReadonlyMap<string, string>,
  options: QueryPlanAuditOptions,
): QueryPlanFinding[] {
  const findings: QueryPlanFinding[] = [];
  for (const step of plan) {
    const access = parseAccessStep(step.detail);
    if (access === null) continue;
    const table = aliases.get(access.name) ?? access.name;
    if (!options.largeTables.has(table)) continue;
    const subquery = correlatedSubquery(plan, step, access);
    if (subquery === null) continue;
    if (isBoundedLookup(sqlite, table, access, options)) continue;
    findings.push({
      rule: "correlated-subquery",
      table,
      detail: `${subquery} re-runs ${step.detail} for each outer row`,
    });
  }
  return findings;
}

function nestedLoopFindings(
  sqlite: Database.Database,
  plan: readonly QueryPlanStep[],
  tables: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
  options: QueryPlanAuditOptions,
): QueryPlanFinding[] {
  const findings: QueryPlanFinding[] = [];
  const growingByParent = new Map<number, QueryPlanStep>();
  for (const step of plan) {
    const access = parseAccessStep(step.detail);
    if (access === null) continue;
    const table = aliases.get(access.name) ?? access.name;
    if (options.largeTables.has(table)) {
      if (
        !growingByParent.has(step.parent) &&
        !isBoundedLookup(sqlite, table, access, options)
      ) {
        growingByParent.set(step.parent, step);
      }
      continue;
    }
    const outer = growingByParent.get(step.parent);
    if (
      outer === undefined ||
      tables.has(table) ||
      access.index !== null ||
      step.detail.includes("VIRTUAL TABLE")
    ) {
      continue;
    }
    findings.push({
      rule: "nested-loop",
      table:
        aliases.get(parseAccessStep(outer.detail)?.name ?? "") ??
        parseAccessStep(outer.detail)?.name ??
        "",
      detail: `${step.detail} runs once per row of ${outer.detail}`,
    });
  }
  return findings;
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

function tokenize(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let depth = 0;
  for (const match of sql.matchAll(SQL_TOKEN)) {
    const text = match[0];
    if (text === ")") depth = Math.max(0, depth - 1);
    tokens.push({ text, start: match.index ?? 0, depth });
    if (text === "(") depth += 1;
  }
  return tokens;
}

function isJsonFunction(text: string): boolean {
  const name = text.toLowerCase();
  return (
    /^json(?:_\w+)?$/.test(name) && name !== "json_each" && name !== "json_tree"
  );
}

function isIdentifier(token: SqlToken | undefined): token is SqlToken {
  return token !== undefined && IDENTIFIER.test(token.text);
}

function jsonOperand(
  sql: string,
  tokens: readonly SqlToken[],
  index: number,
): JsonOperand | null {
  const token = tokens[index];
  let first: number;
  let last: number;
  let qualifier: SqlToken | null = null;
  if (token.text === "->" || token.text === "->>") {
    if (!isIdentifier(tokens[index - 1])) return null;
    first = index - 1;
    if (tokens[index - 2]?.text === "." && isIdentifier(tokens[index - 3])) {
      first = index - 3;
      qualifier = tokens[first];
    }
    last = Math.min(index + 1, tokens.length - 1);
  } else {
    if (!isJsonFunction(token.text) || tokens[index + 1]?.text !== "(") {
      return null;
    }
    if (!isIdentifier(tokens[index + 2])) return null;
    let next = index + 3;
    if (tokens[next]?.text === "." && isIdentifier(tokens[next + 1])) {
      qualifier = tokens[index + 2];
      next += 2;
    }
    if (tokens[next]?.text !== "," && tokens[next]?.text !== ")") return null;
    first = index;
    last = tokens.findIndex(
      (candidate, position) =>
        position > index &&
        candidate.depth === token.depth &&
        candidate.text === ")",
    );
    if (last === -1) return null;
  }
  return {
    qualifier:
      qualifier === null ? null : qualifier.text.replace(/^"(.*)"$/, "$1"),
    expression: sql.slice(
      tokens[first].start,
      tokens[last].start + tokens[last].text.length,
    ),
  };
}

function enclosingClause(
  tokens: readonly SqlToken[],
  index: number,
): number | null {
  let depth = tokens[index].depth;
  for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
    const token = tokens[candidate];
    if (token.depth > depth) continue;
    depth = token.depth;
    if (CLAUSE_KEYWORDS.has(token.text.toLowerCase())) return candidate;
  }
  return null;
}

function jsonFilters(
  sql: string,
  references: readonly TableReference[],
): JsonFilter[] {
  const tokens = tokenize(sql);
  const depthAt = new Map(tokens.map((token) => [token.start, token.depth]));
  const filters: JsonFilter[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const operand = jsonOperand(sql, tokens, index);
    if (operand === null) continue;
    const clause = enclosingClause(tokens, index);
    if (clause === null) continue;
    if (!FILTER_CLAUSES.has(tokens[clause].text.toLowerCase())) continue;
    const depth = tokens[clause].depth;
    let first = clause;
    while (first > 0 && tokens[first - 1].depth >= depth) first -= 1;
    let last = clause;
    while (last + 1 < tokens.length && tokens[last + 1].depth >= depth) {
      last += 1;
    }
    const scope = {
      start: tokens[first].start,
      end: tokens[last].start + tokens[last].text.length,
    };
    const limited = tokens
      .slice(first, last + 1)
      .some(
        (token) =>
          token.depth === depth && token.text.toLowerCase() === "limit",
      );
    const scoped = references.filter(
      (reference) =>
        reference.start >= scope.start &&
        reference.start < scope.end &&
        depthAt.get(reference.start) === depth,
    );
    const qualifier = operand.qualifier;
    const name =
      qualifier === null
        ? scoped.length === 1
          ? scoped[0].name
          : null
        : scoped.some((reference) => reference.name === qualifier)
          ? qualifier
          : null;
    filters.push({ name, expression: operand.expression, limited });
  }
  return filters;
}

function jsonFilterFindings(
  sqlite: Database.Database,
  sql: string,
  plan: readonly QueryPlanStep[],
  tables: ReadonlySet<string>,
  aliases: ReadonlyMap<string, string>,
  options: QueryPlanAuditOptions,
): QueryPlanFinding[] {
  const findings: QueryPlanFinding[] = [];
  const flagged = new Set<string>();
  for (const filter of jsonFilters(sql, tableReferences(sql, tables))) {
    if (filter.limited || filter.name === null || flagged.has(filter.name)) {
      continue;
    }
    const table = aliases.get(filter.name) ?? filter.name;
    if (!options.largeTables.has(table)) continue;
    const step = plan.find((candidate) => {
      const access = parseAccessStep(candidate.detail);
      return (
        access !== null &&
        access.kind === "SEARCH" &&
        access.name === filter.name &&
        access.rangeTerms === 0 &&
        !isBoundedLookup(sqlite, table, access, options)
      );
    });
    if (step === undefined) continue;
    flagged.add(filter.name);
    findings.push({
      rule: "json-filter",
      table,
      detail: `${step.detail} evaluates ${filter.expression} on every row`,
    });
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
  findings.push(...correlatedSubqueryFindings(sqlite, plan, aliases, options));
  findings.push(...nestedLoopFindings(sqlite, plan, tables, aliases, options));
  findings.push(
    ...jsonFilterFindings(sqlite, sql, plan, tables, aliases, options),
  );
  return { status: "audited", plan, findings };
}
