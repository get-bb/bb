import Database from "better-sqlite3";
import { getCallSites } from "node:util";
import { readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryPlanExecutionObserver } from "./connection.js";
import { registerHostPathSqlFunctions } from "./data/host-path-sql.js";
import {
  auditQueryPlan,
  isExplainableStatement,
  type QueryPlanParameter,
  type QueryPlanRule,
} from "./query-plan-audit.js";
import { QUERY_PLAN_ALLOWLIST } from "./query-plan-allowlist.js";

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

export interface QueryPlanFindingReport extends QueryPlanViolation {
  allowed: boolean;
}

export interface SourceFrame {
  path: string;
  file: string;
  functionName: string;
}

export interface QueryCallSite {
  caller: string | null;
  frames: SourceFrame[];
}

export interface QueryPlanBundle {
  directory: string;
  packagePath: string;
}

export interface QueryCallSiteScope {
  root: string;
  bundle: QueryPlanBundle | null;
}

export interface QueryPlanAuditorOptions {
  auditDatabase: Database.Database;
  bundle: QueryPlanBundle | null;
  onFinding: (finding: QueryPlanFindingReport) => void;
  onQueued: () => void;
}

export interface QueryPlanAuditor extends QueryPlanExecutionObserver {
  observe(source: string, params: readonly unknown[], caller: string): void;
  flush(): void;
}

interface QueuedAudit {
  sql: string;
  caller: () => string | null;
  params: readonly unknown[];
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
const PASS_THROUGH_FILES: ReadonlySet<string> = new Set([
  "packages/db/src/connection.ts",
  "packages/db/src/query-plan-audit.ts",
  "packages/db/src/query-plan-guard.ts",
  "packages/db/src/query-plan-test-guard.ts",
]);
const UNGUARDED_FILES: ReadonlySet<string> = new Set([
  "packages/db/src/migrate.ts",
]);
const FIRST_EXECUTION_STACK_DEPTH = 30;
const STACK_FRAME =
  /^at (?:(.+?) \()?((?:file:\/\/)?\/[^():]+):(\d+):(\d+)\)?$/;
const SOURCE_PATH = /\/((?:apps|packages|plugins)\/[^/]+\/src\/.+)$/;
const BUNDLE_PATH = /\.[cm]?js$/;
const TEST_FILE = /\.test\.tsx?$/;

type FrameLocation =
  | { kind: "source"; frame: SourceFrame }
  | { kind: "dependency" }
  | { kind: "other" };

const BUNDLE_MODULE_MARKER = /^\/\/ (\S+\.[cm]?[jt]sx?)$/;
const bundleModules = new Map<string, BundleModule[]>();

interface BundleModule {
  line: number;
  path: string;
}

function bundleModulesOf(path: string): BundleModule[] {
  const known = bundleModules.get(path);
  if (known !== undefined) return known;
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  const modules = text.split("\n").flatMap((content, index) => {
    const marker = BUNDLE_MODULE_MARKER.exec(content);
    return marker === null ? [] : [{ line: index + 1, path: marker[1] }];
  });
  bundleModules.set(path, modules);
  return modules;
}

function bundledModulePath(
  path: string,
  line: number,
  bundle: QueryPlanBundle,
): string | null {
  const modules = bundleModulesOf(path);
  let low = 0;
  let high = modules.length - 1;
  let found: BundleModule | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = modules[middle];
    if (candidate.line <= line) {
      found = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (found === null) return null;
  return `/${posix.normalize(posix.join(bundle.packagePath, found.path))}`;
}

function originalPath(
  path: string,
  line: number,
  bundle: QueryPlanBundle | null,
): string | null {
  if (
    bundle === null ||
    !BUNDLE_PATH.test(path) ||
    !path.startsWith(`${bundle.directory}/`)
  ) {
    return path;
  }
  return bundledModulePath(path, line, bundle);
}

function functionNameOf(raw: string | undefined): string {
  if (raw === undefined) return "<anonymous>";
  return raw
    .replace(/^async /, "")
    .replace(/^new /, "")
    .replace(/ \[as [^\]]+\]$/, "")
    .replace(/^(?:Object|Function)\./, "");
}

function locateFrame(
  line: string,
  bundle: QueryPlanBundle | null,
): FrameLocation | null {
  const match = STACK_FRAME.exec(line.trim());
  if (match === null) return null;
  const framePath = match[2].startsWith("file://")
    ? fileURLToPath(match[2])
    : match[2];
  const path = originalPath(framePath, Number(match[3]), bundle);
  if (path === null || path.includes("/node_modules/")) {
    return { kind: "dependency" };
  }
  const source = SOURCE_PATH.exec(path);
  if (source === null || TEST_FILE.test(source[1])) return { kind: "other" };
  return {
    kind: "source",
    frame: { path, file: source[1], functionName: functionNameOf(match[1]) },
  };
}

function captureStack(stackDepth: number): string {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = stackDepth;
  try {
    return new Error().stack ?? "";
  } finally {
    Error.stackTraceLimit = limit;
  }
}

function captureTestStack(stackDepth: number): string {
  return (
    "Error\n" +
    getCallSites(stackDepth, { sourceMap: false })
      .map(
        (frame) =>
          `at ${frame.functionName || "<anonymous>"} (${frame.scriptName}:${frame.lineNumber}:${frame.columnNumber})`,
      )
      .join("\n")
  );
}

export function captureQueryCallSite(
  stackDepth: number,
  scope: QueryCallSiteScope,
): QueryCallSite {
  return sourceFrames(captureTestStack(stackDepth), scope);
}

function sourceFrames(stack: string, scope: QueryCallSiteScope): QueryCallSite {
  const frames: SourceFrame[] = [];
  let caller: string | null | undefined;
  for (const line of stack.split("\n").slice(1)) {
    const location = locateFrame(line, scope.bundle);
    if (location === null || location.kind === "dependency") continue;
    if (
      location.kind === "other" ||
      !location.frame.path.startsWith(scope.root)
    ) {
      caller ??= null;
      continue;
    }
    const { file, functionName } = location.frame;
    if (PASS_THROUGH_FILES.has(file)) continue;
    frames.push(location.frame);
    if (caller === undefined) {
      caller = UNGUARDED_FILES.has(file) ? null : `${file}#${functionName}`;
    }
  }
  return { caller: caller ?? null, frames };
}

export function openQueryPlanAuditDatabase(path: string): Database.Database {
  const sqlite = new Database(path, { readonly: true, fileMustExist: true });
  registerHostPathSqlFunctions(sqlite);
  return sqlite;
}

export function allowlistKey(entry: {
  rule: QueryPlanRule;
  table: string;
  caller: string;
}): string {
  return `${entry.rule}\u0000${entry.table}\u0000${entry.caller}`;
}

function partialIndexLiterals(sqlite: Database.Database): Set<string> {
  const rows = sqlite
    .prepare(
      "SELECT sql FROM sqlite_schema WHERE type = 'index' AND sql LIKE '% WHERE %'",
    )
    .all() as Array<{ sql: string }>;
  const literals = new Set<string>();
  for (const row of rows) {
    const predicate = row.sql.slice(row.sql.search(/ WHERE /i));
    for (const match of predicate.matchAll(/'((?:''|[^'])*)'/g)) {
      literals.add(match[1].replaceAll("''", "'"));
    }
  }
  return literals;
}

function planSignature(
  params: readonly unknown[],
  literals: ReadonlySet<string>,
): string {
  return params
    .map((param) =>
      typeof param === "string" && literals.has(param)
        ? `'${param}'`
        : typeof param,
    )
    .join(",");
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

export function createQueryPlanAuditor(
  options: QueryPlanAuditorOptions,
): QueryPlanAuditor {
  const allowed = new Set(QUERY_PLAN_ALLOWLIST.map(allowlistKey));
  const literals = partialIndexLiterals(options.auditDatabase);
  const audited = new Set<string>();

  function audit(sql: string, caller: string, params: readonly unknown[]) {
    const result = auditQueryPlan(options.auditDatabase, sql, {
      largeTables: LARGE_TABLES,
      ...(isParameterList(params) ? { params } : {}),
    });
    if (result.status !== "audited") return;
    for (const finding of result.findings) {
      if (!GUARDED_RULES.has(finding.rule)) continue;
      options.onFinding({
        rule: finding.rule,
        table: finding.table,
        caller,
        detail: finding.detail,
        sql,
        plan: result.plan.map((step) => step.detail),
        allowed: allowed.has(
          allowlistKey({ rule: finding.rule, table: finding.table, caller }),
        ),
      });
    }
  }

  let queue: QueuedAudit[] = [];
  function enqueue(
    sql: string,
    caller: () => string | null,
    params: readonly unknown[],
  ) {
    queue.push({ sql, caller, params: [...params] });
    if (queue.length === 1) options.onQueued();
  }

  return {
    observe(source, params, caller) {
      if (!isExplainableStatement(source)) return;
      const key = `${caller}\u0000${source}\u0000${planSignature(params, literals)}`;
      if (audited.has(key)) return;
      audited.add(key);
      enqueue(source, () => caller, params);
    },
    observeFirstExecution(source, params) {
      if (!isExplainableStatement(source)) return;
      const key = `\u0000${source}\u0000${planSignature(params, literals)}`;
      if (audited.has(key)) return;
      audited.add(key);
      const stack = captureStack(FIRST_EXECUTION_STACK_DEPTH);
      enqueue(
        source,
        () => sourceFrames(stack, { root: "/", bundle: options.bundle }).caller,
        params,
      );
    },
    flush() {
      const pending = queue;
      queue = [];
      for (const entry of pending) {
        const caller = entry.caller();
        if (caller !== null) audit(entry.sql, caller, entry.params);
      }
    },
  };
}
