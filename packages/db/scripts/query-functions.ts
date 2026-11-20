import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const DATA_DIR = "packages/db/src/data";
export const PLUGIN_QUERY_MODULES: readonly string[] = [
  "plugins/account-pool/src/store.ts",
  "plugins/automations/src/data.ts",
  "plugins/workflows/src/data.ts",
];
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
    if (
      ts.isPropertyAccessExpression(current) &&
      current.expression.kind === ts.SyntaxKind.ThisKeyword &&
      CONNECTION_NAMES.has(current.name.text)
    ) {
      return current.name;
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

function isExported(
  node: ts.FunctionDeclaration | ts.ClassDeclaration,
): boolean {
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
  methods: ReadonlyMap<string, ts.Node>,
): string[] {
  const names: string[] = [];
  const visit = (child: ts.Node) => {
    if (ts.isCallExpression(child)) {
      const callee = child.expression;
      if (ts.isIdentifier(callee) && callables.has(callee.text)) {
        names.push(callee.text);
      } else if (
        ts.isPropertyAccessExpression(callee) &&
        callee.expression.kind === ts.SyntaxKind.ThisKeyword &&
        methods.has(callee.name.text)
      ) {
        names.push(`this.${callee.name.text}`);
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function classMethods(node: ts.ClassDeclaration): Map<string, ts.Node> {
  const methods = new Map<string, ts.Node>();
  for (const member of node.members) {
    if (
      ts.isMethodDeclaration(member) &&
      member.body !== undefined &&
      (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name))
    ) {
      methods.set(member.name.text, member.body);
    }
  }
  return methods;
}

function isPublicMethod(
  member: ts.ClassElement,
): member is ts.MethodDeclaration {
  return (
    ts.isMethodDeclaration(member) &&
    member.body !== undefined &&
    ts.isIdentifier(member.name) &&
    !(
      member.modifiers?.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.PrivateKeyword ||
          modifier.kind === ts.SyntaxKind.ProtectedKeyword ||
          modifier.kind === ts.SyntaxKind.StaticKeyword,
      ) ?? false
    )
  );
}

export function listQueryFunctionsInSource(
  file: string,
  text: string,
): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const callables = localCallables(source);
  const queriesByScope = new Map<
    ReadonlyMap<string, ts.Node>,
    Map<string, boolean>
  >();
  const runsQuery = (
    name: string,
    methods: ReadonlyMap<string, ts.Node>,
    visiting: Set<string>,
  ): boolean => {
    let queries = queriesByScope.get(methods);
    if (queries === undefined) {
      queries = new Map();
      queriesByScope.set(methods, queries);
    }
    const known = queries.get(name);
    if (known !== undefined) return known;
    const body = name.startsWith("this.")
      ? methods.get(name.slice("this.".length))
      : callables.get(name);
    if (body === undefined || visiting.has(name)) return false;
    visiting.add(name);
    const result =
      containsQuery(body) ||
      calledLocals(body, callables, methods).some((callee) =>
        runsQuery(callee, methods, visiting),
      );
    visiting.delete(name);
    queries.set(name, result);
    return result;
  };
  const noMethods = new Map<string, ts.Node>();
  const functions: string[] = [];
  for (const statement of source.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name !== undefined &&
      statement.body !== undefined &&
      isExported(statement) &&
      runsQuery(statement.name.text, noMethods, new Set())
    ) {
      functions.push(`${file}#${statement.name.text}`);
    } else if (
      ts.isClassDeclaration(statement) &&
      statement.name !== undefined &&
      isExported(statement)
    ) {
      const methods = classMethods(statement);
      for (const member of statement.members) {
        if (
          isPublicMethod(member) &&
          runsQuery(`this.${member.name.getText(source)}`, methods, new Set())
        ) {
          functions.push(
            `${file}#${statement.name.text}.${member.name.getText(source)}`,
          );
        }
      }
    }
  }
  return functions;
}

export function listPluginQueryFunctions(repoRoot: string): string[] {
  return PLUGIN_QUERY_MODULES.flatMap((file) =>
    listQueryFunctionsInSource(
      file,
      readFileSync(join(repoRoot, file), "utf8"),
    ),
  );
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
