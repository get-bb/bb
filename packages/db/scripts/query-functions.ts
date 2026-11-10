import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const DATA_DIR = "packages/db/src/data";
const QUERY_METHODS = new Set([
  "select",
  "selectDistinct",
  "insert",
  "update",
  "delete",
  "prepare",
  "findFirst",
  "findMany",
  "run",
  "all",
  "get",
  "values",
]);
const CONNECTION_NAMES = new Set([
  "db",
  "tx",
  "transaction",
  "connection",
  "client",
  "sqlite",
]);
const CACHED_QUERY_HELPERS = new Set([
  "prepareCachedQuery",
  "prepareCachedQueryVariant",
]);

function receiverRoot(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isCallExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      CACHED_QUERY_HELPERS.has(current.expression.text)
    ) {
      return current.expression;
    }
    current = current.expression;
  }
  return current;
}

function buildsQuery(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return CACHED_QUERY_HELPERS.has(callee.text);
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !QUERY_METHODS.has(callee.name.text)
  ) {
    return false;
  }
  const root = receiverRoot(callee.expression);
  return (
    ts.isIdentifier(root) &&
    (CONNECTION_NAMES.has(root.text) || CACHED_QUERY_HELPERS.has(root.text))
  );
}

function containsQuery(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && buildsQuery(node)) return true;
  return ts.forEachChild(node, containsQuery) ?? false;
}

function isExported(node: ts.FunctionDeclaration): boolean {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false
  );
}

export function listQueryFunctionsInSource(
  file: string,
  text: string,
): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const functions: string[] = [];
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.body !== undefined &&
      isExported(statement) &&
      containsQuery(statement.body)
    ) {
      functions.push(`${file}#${statement.name.text}`);
    }
  }
  return functions;
}

export function listQueryFunctions(repoRoot: string): string[] {
  return readdirSync(join(repoRoot, DATA_DIR))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .flatMap((name) => {
      const file = `${DATA_DIR}/${name}`;
      return listQueryFunctionsInSource(
        file,
        readFileSync(join(repoRoot, file), "utf8"),
      );
    });
}
