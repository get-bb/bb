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

function localCallables(source: ts.SourceFile): Map<string, ts.Node> {
  const callables = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.body !== undefined
    ) {
      callables.set(statement.name.text, statement.body);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer !== undefined &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          callables.set(declaration.name.text, declaration.initializer.body);
        }
      }
    }
  }
  return callables;
}

function calledLocals(
  node: ts.Node,
  callables: ReadonlyMap<string, ts.Node>,
): string[] {
  const names: string[] = [];
  const visit = (child: ts.Node) => {
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      callables.has(child.expression.text)
    ) {
      names.push(child.expression.text);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

export function listQueryFunctionsInSource(
  file: string,
  text: string,
): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const callables = localCallables(source);
  const queries = new Map<string, boolean>();
  const runsQuery = (name: string, visiting: Set<string>): boolean => {
    const known = queries.get(name);
    if (known !== undefined) return known;
    const body = callables.get(name);
    if (body === undefined || visiting.has(name)) return false;
    visiting.add(name);
    const result =
      containsQuery(body) ||
      calledLocals(body, callables).some((callee) =>
        runsQuery(callee, visiting),
      );
    visiting.delete(name);
    queries.set(name, result);
    return result;
  };
  const functions: string[] = [];
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.body !== undefined &&
      isExported(statement) &&
      runsQuery(statement.name.text, new Set())
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
