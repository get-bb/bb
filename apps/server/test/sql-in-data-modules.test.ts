import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const PACKAGE_ROOT = resolve(import.meta.dirname, "..");
const QUERY_METHODS = new Set([
  "select",
  "selectDistinct",
  "insert",
  "update",
  "delete",
  "run",
  "all",
  "get",
  "values",
  "prepare",
  "exec",
]);
const CONNECTION_NAMES = new Set(["db", "tx", "$client"]);

function listServerSources(): string[] {
  return readdirSync(join(PACKAGE_ROOT, "src"), { recursive: true })
    .map((entry) => `src/${String(entry).split(sep).join("/")}`)
    .filter(
      (path) =>
        path.endsWith(".ts") &&
        !path.endsWith(".test.ts") &&
        !path.includes("/__tests__/"),
    );
}

function reachesConnection(expression: ts.Expression): boolean {
  let current: ts.Expression = expression;
  while (true) {
    if (ts.isIdentifier(current)) return CONNECTION_NAMES.has(current.text);
    if (ts.isPropertyAccessExpression(current)) {
      if (CONNECTION_NAMES.has(current.name.text)) return true;
      current = current.expression;
    } else if (
      ts.isCallExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current)
    ) {
      current = current.expression;
    } else {
      return false;
    }
  }
}

function isRuntimeDrizzleImport(node: ts.ImportDeclaration): boolean {
  if (!ts.isStringLiteral(node.moduleSpecifier)) return false;
  const source = node.moduleSpecifier.text;
  if (source !== "drizzle-orm" && !source.startsWith("drizzle-orm/")) {
    return false;
  }
  const clause = node.importClause;
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined) return true;
  const bindings = clause.namedBindings;
  if (bindings === undefined || ts.isNamespaceImport(bindings)) return true;
  return bindings.elements.some((element) => !element.isTypeOnly);
}

function queriesIn(path: string): string[] {
  const source = ts.createSourceFile(
    path,
    readFileSync(join(PACKAGE_ROOT, path), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
  const at = (node: ts.Node) =>
    `${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && isRuntimeDrizzleImport(node)) {
      found.push(`${at(node)} imports drizzle-orm`);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      QUERY_METHODS.has(node.expression.name.text) &&
      reachesConnection(node.expression.expression)
    ) {
      found.push(`${at(node)} calls ${node.expression.name.text}`);
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "query" &&
      reachesConnection(node.expression)
    ) {
      found.push(`${at(node)} uses relational queries`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

it("runs SQL only through query functions in packages/db/src/data", () => {
  expect(
    listServerSources().flatMap(queriesIn),
    "Move the query into a function in packages/db/src/data, where check:query-costs times it on long threads and the query-plan guard and the query-functions-run-in-tests check cover it. The server may open transactions and pass them to query functions.",
  ).toEqual([]);
});
