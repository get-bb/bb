import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface SourceFileViolation {
  filePath: string;
  line: number;
  text: string;
}

const RAW_CACHE_WRITE_METHODS = new Set([
  "cancelQueries",
  "invalidateQueries",
  "refetchQueries",
  "removeQueries",
  "setQueriesData",
  "setQueryData",
]);

const DISALLOWED_CACHE_IMPORT_SUFFIXES = [
  "/cache-effect-utils",
  "/cache-effects",
  "/cache-invalidation-groups",
  "/mutations/thread-archive-cache",
  "/queries/query-cache",
  "/queries/query-keys",
  "/queries/thread-list-cache-data",
] as const;

function getSourceRoot(): string {
  return path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
}

function collectSourceFilePaths(directoryPath: string): string[] {
  const paths: string[] = [];
  for (const entryName of readdirSync(directoryPath)) {
    const entryPath = path.join(directoryPath, entryName);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      paths.push(...collectSourceFilePaths(entryPath));
      continue;
    }
    if (entryPath.endsWith(".ts") || entryPath.endsWith(".tsx")) {
      paths.push(entryPath);
    }
  }
  return paths;
}

function toAppRelativePath(filePath: string): string {
  return path.relative(getSourceRoot(), filePath).split(path.sep).join("/");
}

function isTestOrStoryFile(relativePath: string): boolean {
  return (
    relativePath.includes(".test.") ||
    relativePath.includes(".stories.") ||
    relativePath.endsWith(".d.ts")
  );
}

function isCacheOwnerFile(relativePath: string): boolean {
  return relativePath.startsWith("hooks/cache-owners/");
}

function isCacheBoundarySubject(relativePath: string): boolean {
  return (
    relativePath.startsWith("hooks/mutations/") ||
    relativePath === "hooks/realtime-cache-effects.ts" ||
    relativePath.endsWith("ActionsProvider.tsx")
  );
}

function parseSourceFile(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    toAppRelativePath(filePath),
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function violationForNode(
  sourceFile: ts.SourceFile,
  filePath: string,
  node: ts.Node,
  text: string,
): SourceFileViolation {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return {
    filePath: toAppRelativePath(filePath),
    line: position.line + 1,
    text,
  };
}

function collectRawCacheWriteViolations(): SourceFileViolation[] {
  const violations: SourceFileViolation[] = [];
  for (const filePath of collectSourceFilePaths(getSourceRoot())) {
    const relativePath = toAppRelativePath(filePath);
    if (isTestOrStoryFile(relativePath) || isCacheOwnerFile(relativePath)) {
      continue;
    }
    const sourceFile = parseSourceFile(filePath);
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        RAW_CACHE_WRITE_METHODS.has(node.expression.name.text)
      ) {
        violations.push(
          violationForNode(
            sourceFile,
            filePath,
            node,
            node.expression.getText(sourceFile),
          ),
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return violations;
}

function collectCacheImportBoundaryViolations(): SourceFileViolation[] {
  const violations: SourceFileViolation[] = [];
  for (const filePath of collectSourceFilePaths(getSourceRoot())) {
    const relativePath = toAppRelativePath(filePath);
    if (
      isTestOrStoryFile(relativePath) ||
      !isCacheBoundarySubject(relativePath)
    ) {
      continue;
    }
    const sourceFile = parseSourceFile(filePath);
    sourceFile.forEachChild((node) => {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      ) {
        return;
      }
      const modulePath = node.moduleSpecifier.text;
      if (
        DISALLOWED_CACHE_IMPORT_SUFFIXES.some((suffix) =>
          modulePath.endsWith(suffix),
        )
      ) {
        violations.push(
          violationForNode(sourceFile, filePath, node, modulePath),
        );
      }
    });
  }
  return violations;
}

describe("cache owner boundaries", () => {
  it("keeps raw frontend-domain cache writes inside cache owners", () => {
    expect(collectRawCacheWriteViolations()).toEqual([]);
  });

  it("keeps mutation, realtime, and action-provider files off query-key imports", () => {
    expect(collectCacheImportBoundaryViolations()).toEqual([]);
  });
});
