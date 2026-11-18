import { normalizePath, parseAst, type Plugin } from "vite";

interface SourceRange {
  start: number;
  end: number;
}

interface ImportExpressionNode extends SourceRange {
  source: SourceRange;
}

function isSourceRange(value: unknown): value is SourceRange {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "start") === "number" &&
    typeof Reflect.get(value, "end") === "number"
  );
}

function isImportExpression(value: object): value is ImportExpressionNode {
  return (
    Reflect.get(value, "type") === "ImportExpression" &&
    isSourceRange(value) &&
    isSourceRange(Reflect.get(value, "source"))
  );
}

function collectImportExpressions(
  value: unknown,
  found: ImportExpressionNode[],
): void {
  if (typeof value !== "object" || value === null) return;
  if (isImportExpression(value)) found.push(value);
  for (const child of Object.values(value)) {
    collectImportExpressions(child, found);
  }
}

function isTrackedModule(id: string): boolean {
  const path = normalizePath(id.split("?")[0] ?? id);
  return (
    !path.startsWith("\0") &&
    !path.includes("/node_modules/") &&
    !path.includes("/src/test/") &&
    !/\.test\.[cm]?[jt]sx?$/.test(path) &&
    /\.[cm]?[jt]sx?$/.test(path)
  );
}

export function trackTestLazyImports(): Plugin {
  return {
    name: "bb:test-lazy-imports",
    enforce: "post",
    transform(code, id) {
      if (!code.includes("import(") || !isTrackedModule(id)) return null;
      const expressions: ImportExpressionNode[] = [];
      collectImportExpressions(parseAst(code), expressions);
      if (expressions.length === 0) return null;
      let tracked = code;
      for (const expression of expressions.sort((a, b) => b.start - a.start)) {
        const specifier = code.slice(
          expression.source.start,
          expression.source.end,
        );
        tracked =
          tracked.slice(0, expression.start) +
          "globalThis.__bbTrackLazyImport(" +
          tracked.slice(expression.start, expression.end) +
          `, ${JSON.stringify(specifier)})` +
          tracked.slice(expression.end);
      }
      return { code: tracked, map: null };
    },
  };
}
