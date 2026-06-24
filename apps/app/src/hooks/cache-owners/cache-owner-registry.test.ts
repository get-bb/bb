import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

interface SourceFileViolation {
  filePath: string;
  line: number;
  text: string;
}

type CacheOwnerQueryKeyImportRegistry = Record<string, readonly string[]>;

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

const DEPRECATED_CACHE_SHIM_MODULES = new Set([
  "hooks/cache-effect-utils",
  "hooks/cache-effects",
  "hooks/cache-invalidation-groups",
  "hooks/environment-cache-effects",
  "hooks/mutation-cache-effects",
  "hooks/mutations/thread-archive-cache",
  "hooks/queries/query-cache",
  "hooks/queries/thread-list-cache-data",
  "hooks/realtime-cache-registry",
  "hooks/system-cache-effects",
]);

const QUERY_KEYS_MODULE_PATH = "hooks/queries/query-keys";

const CACHE_OWNER_QUERY_KEY_IMPORTS: CacheOwnerQueryKeyImportRegistry = {
  "hooks/cache-owners/automation-cache-effects.ts": [
    "automationDetailQueryKey",
    "automationRunsQueryKey",
    "automationsQueryKey",
  ],
  "hooks/cache-owners/cache-invalidation-groups.ts": [
    "allProjectPathsQueryKeyPrefix",
    "allProjectSourceBranchesQueryKeyPrefix",
    "allThreadPendingInteractionsQueryKeyPrefix",
    "allThreadQueryKeyPrefix",
    "allThreadQueuedMessagesQueryKeyPrefix",
    "allThreadTimelineQueryKeyPrefix",
    "allThreadTimelineTurnSummaryDetailsQueryKeyPrefix",
    "localPathExistenceQueryKeyPrefix",
    "projectPathsQueryKeyPrefix",
    "projectPromptHistoryQueryKey",
    "projectPromptHistoryQueryKeyPrefix",
    "projectSourceBranchesQueryKeyPrefix",
    "projectsQueryKey",
    "sidebarNavigationQueryKey",
    "threadPendingInteractionsQueryKey",
    "threadPromptHistoryQueryKey",
    "threadPromptHistoryQueryKeyPrefix",
    "threadQueryKey",
    "threadSearchQueryKeyPrefix",
    "threadQueuedMessagesQueryKey",
    "threadTimelineQueryKeyPrefix",
    "threadTimelineTurnSummaryDetailsQueryKeyPrefix",
    "threadsQueryKey",
  ],
  "hooks/cache-owners/composer-cache-owner.ts": [
    "threadPendingInteractionsQueryKey",
    "threadPromptHistoryQueryKey",
    "threadQueuedMessagesQueryKey",
  ],
  "hooks/cache-owners/environment-cache-effects.ts": [
    "environmentDiffFilesQueryKeyPrefix",
    "environmentFilePreviewQueryKeyPrefix",
    "environmentMergeBaseBranchesQueryKeyPrefix",
    "environmentPathsQueryKeyPrefix",
    "environmentWorkStatusQueryKeyPrefix",
    "systemExecutionOptionsEnvironmentQueryKeyPrefix",
  ],
  "hooks/cache-owners/environment-diff-patch-cache-owner.ts": [
    "environmentDiffPatchQueryKey",
  ],
  "hooks/cache-owners/environment-workspace-cache-owner.ts": [
    "environmentQueryKey",
    "threadSearchQueryKeyPrefix",
  ],
  "hooks/cache-owners/mutation-cache-effects.ts": [
    "archivedThreadsListQueryKey",
    "projectPathsQueryKeyPrefix",
    "sidebarNavigationQueryKey",
    "threadPromptHistoryQueryKey",
    "threadQueryKey",
    "threadSearchQueryKeyPrefix",
    "threadQueuedMessagesQueryKey",
    "threadStorageFilePreviewQueryKeyPrefix",
    "threadStorageFilesForThreadQueryKeyPrefix",
    "threadStoragePathsForThreadQueryKeyPrefix",
    "threadTimelineQueryKeyPrefix",
    "threadTimelineTurnSummaryDetailsQueryKeyPrefix",
    "threadsQueryKey",
  ],
  "hooks/cache-owners/project-cache-owner.ts": [
    "projectsQueryKey",
    "sidebarNavigationQueryKey",
  ],
  "hooks/cache-owners/query-cache.ts": [
    "ARCHIVED_THREADS_LIST_KIND",
    "ArchivedThreadsListFilters",
    "ENVIRONMENT_WORK_STATUS_QUERY_KEY",
    "EnvironmentWorkStatusQueryKey",
    "THREADS_QUERY_KEY",
    "ThreadListQueryFilters",
    "environmentDiffFilesQueryKeyPrefix",
    "environmentDiffPatchQueryKeyPrefix",
    "environmentFilePreviewQueryKeyPrefix",
    "environmentMergeBaseBranchesQueryKeyPrefix",
    "environmentPullRequestQueryKey",
    "environmentQueryKey",
    "environmentWorkStatusQueryKey",
    "environmentWorkStatusQueryKeyPrefix",
    "sidebarNavigationQueryKey",
    "threadQueryKey",
    "threadTimelineQueryKeyPrefix",
    "threadsQueryKey",
  ],
  "hooks/cache-owners/realtime-cache-registry.ts": [
    "allHostQueryKeyPrefix",
    "allAutomationDetailQueryKeyPrefix",
    "allAutomationRunsQueryKeyPrefix",
    "allSystemExecutionOptionsQueryKeyPrefix",
    "automationsQueryKey",
    "allThreadStorageFilePreviewQueryKeyPrefix",
    "allThreadStorageFilesQueryKeyPrefix",
    "allThreadStoragePathsQueryKeyPrefix",
    "allThreadQueryKeyPrefix",
    "allTerminalsQueryKeyPrefix",
    "environmentDiffFilesQueryKeyPrefix",
    "environmentFilePreviewQueryKeyPrefix",
    "environmentPullRequestQueryKey",
    "environmentWorkStatusQueryKeyPrefix",
    "hostsQueryKey",
    "sidebarNavigationQueryKey",
    "systemConfigQueryKey",
    "systemProvidersQueryKey",
    "threadQueryKey",
    "threadSearchQueryKeyPrefix",
    "threadStorageFilePreviewQueryKeyPrefix",
    "threadStorageFilesForThreadQueryKeyPrefix",
    "threadStoragePathsForThreadQueryKeyPrefix",
    "terminalsQueryKey",
    "threadsQueryKey",
  ],
  "hooks/cache-owners/system-cache-effects.ts": [
    "allEnvironmentDiffFilesQueryKeyPrefix",
    "allEnvironmentDiffPatchQueryKeyPrefix",
    "allEnvironmentFilePreviewQueryKeyPrefix",
    "allEnvironmentMergeBaseBranchesQueryKeyPrefix",
    "allEnvironmentQueryKeyPrefix",
    "allEnvironmentWorkStatusQueryKeyPrefix",
    "allHostQueryKeyPrefix",
    "allProjectPathsQueryKeyPrefix",
    "allSystemExecutionOptionsQueryKeyPrefix",
    "allThreadPendingInteractionsQueryKeyPrefix",
    "allThreadQueryKeyPrefix",
    "allThreadQueuedMessagesQueryKeyPrefix",
    "allThreadStorageFilePreviewQueryKeyPrefix",
    "allThreadStorageFilesQueryKeyPrefix",
    "allThreadStoragePathsQueryKeyPrefix",
    "allThreadTimelineQueryKeyPrefix",
    "allThreadTimelineTurnSummaryDetailsQueryKeyPrefix",
    "hostsQueryKey",
    "localPathExistenceQueryKeyPrefix",
    "projectsQueryKey",
    "sidebarNavigationQueryKey",
    "systemConfigQueryKey",
    "systemExecutionOptionsQueryKey",
    "systemProvidersQueryKey",
    "threadPromptHistoryQueryKeyPrefix",
    "threadSearchQueryKeyPrefix",
    "threadsQueryKey",
  ],
  "hooks/cache-owners/system-config-cache-owner.ts": ["systemConfigQueryKey"],
  "hooks/cache-owners/terminal-cache-owner.ts": [
    "allTerminalsQueryKeyPrefix",
    "TerminalQueryScope",
    "terminalsQueryKey",
  ],
  "hooks/cache-owners/thread-archive-cache.ts": [
    "threadQueryKey",
    "threadsQueryKey",
  ],
  "hooks/cache-owners/thread-detail-cache-owner.ts": [
    "environmentQueryKey",
    "hostQueryKey",
    "hostsQueryKey",
    "threadQueryKey",
    "threadTimelineQueryKey",
  ],
  "hooks/cache-owners/thread-list-cache-owner.ts": [
    "sidebarNavigationQueryKey",
    "threadQueryKey",
    "threadSearchQueryKeyPrefix",
    "threadsQueryKey",
  ],
  "hooks/cache-owners/thread-runtime-cache-owner.ts": [
    "projectPromptHistoryQueryKey",
    "projectSourceBranchesQueryKeyPrefix",
    "threadPromptHistoryQueryKey",
    "threadQueryKey",
    "threadQueuedMessagesQueryKey",
    "threadTimelineQueryKeyPrefix",
    "threadTimelineTurnSummaryDetailsQueryKeyPrefix",
    "threadsQueryKey",
  ],
  "hooks/cache-owners/thread-state-cache-owner.ts": [
    "projectsQueryKey",
    "sidebarNavigationQueryKey",
    "threadQueryKey",
    "threadSearchQueryKeyPrefix",
    "threadsQueryKey",
  ],
};

function getSourceRoot(): string {
  return path.resolve(new URL("../../", import.meta.url).pathname);
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

function violationForSourceFile(
  relativePath: string,
  text: string,
): SourceFileViolation {
  return {
    filePath: relativePath,
    line: 1,
    text,
  };
}

function compareSourceFileViolations(
  left: SourceFileViolation,
  right: SourceFileViolation,
): number {
  const filePathComparison = left.filePath.localeCompare(right.filePath);
  if (filePathComparison !== 0) {
    return filePathComparison;
  }
  if (left.line !== right.line) {
    return left.line - right.line;
  }
  return left.text.localeCompare(right.text);
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

function getActualImportsForFile(
  importsByFile: Map<string, Set<string>>,
  relativePath: string,
): Set<string> {
  const existingImports = importsByFile.get(relativePath);
  if (existingImports) {
    return existingImports;
  }
  const imports = new Set<string>();
  importsByFile.set(relativePath, imports);
  return imports;
}

function collectCacheOwnerQueryKeyImportViolations(): SourceFileViolation[] {
  const violations: SourceFileViolation[] = [];
  const actualImportsByFile = new Map<string, Set<string>>();
  const cacheOwnerSourceFiles = new Map<string, ts.SourceFile>();

  for (const filePath of collectSourceFilePaths(getSourceRoot())) {
    const relativePath = toAppRelativePath(filePath);
    if (isTestOrStoryFile(relativePath) || !isCacheOwnerFile(relativePath)) {
      continue;
    }
    const sourceFile = parseSourceFile(filePath);
    cacheOwnerSourceFiles.set(relativePath, sourceFile);

    sourceFile.forEachChild((node) => {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      ) {
        return;
      }
      const resolvedModulePath = resolveAppImportModulePath(
        relativePath,
        node.moduleSpecifier.text,
      );
      if (resolvedModulePath !== QUERY_KEYS_MODULE_PATH) {
        return;
      }

      const importClause = node.importClause;
      if (!importClause) {
        return;
      }
      if (importClause.name) {
        violations.push(
          violationForNode(
            sourceFile,
            filePath,
            importClause.name,
            "default query-key import",
          ),
        );
      }

      const namedBindings = importClause.namedBindings;
      if (!namedBindings) {
        return;
      }
      if (ts.isNamespaceImport(namedBindings)) {
        violations.push(
          violationForNode(
            sourceFile,
            filePath,
            namedBindings,
            "namespace query-key import",
          ),
        );
        return;
      }

      const actualImports = getActualImportsForFile(
        actualImportsByFile,
        relativePath,
      );
      const allowedImports = CACHE_OWNER_QUERY_KEY_IMPORTS[relativePath];
      const allowedImportSet = allowedImports
        ? new Set(allowedImports)
        : undefined;
      for (const element of namedBindings.elements) {
        const importName = element.propertyName?.text ?? element.name.text;
        actualImports.add(importName);
        if (!allowedImportSet) {
          violations.push(
            violationForNode(
              sourceFile,
              filePath,
              element,
              `missing query-key import registry entry: ${importName}`,
            ),
          );
          continue;
        }
        if (!allowedImportSet.has(importName)) {
          violations.push(
            violationForNode(
              sourceFile,
              filePath,
              element,
              `undeclared query-key import: ${importName}`,
            ),
          );
        }
      }
    });
  }

  for (const [relativePath, allowedImports] of Object.entries(
    CACHE_OWNER_QUERY_KEY_IMPORTS,
  )) {
    if (!cacheOwnerSourceFiles.has(relativePath)) {
      violations.push(
        violationForSourceFile(
          relativePath,
          "stale cache-owner query-key import registry entry",
        ),
      );
      continue;
    }
    const actualImports = actualImportsByFile.get(relativePath);
    for (const importName of allowedImports) {
      if (!actualImports?.has(importName)) {
        violations.push(
          violationForSourceFile(
            relativePath,
            `unused allowed query-key import: ${importName}`,
          ),
        );
      }
    }
  }

  return violations.sort(compareSourceFileViolations);
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

function resolveAppImportModulePath(
  relativePath: string,
  modulePath: string,
): string | null {
  if (modulePath.startsWith("@/")) {
    return modulePath.slice(2);
  }
  if (modulePath.startsWith("./") || modulePath.startsWith("../")) {
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(relativePath), modulePath),
    );
  }
  return null;
}

function collectDeprecatedCacheShimImportViolations(): SourceFileViolation[] {
  const violations: SourceFileViolation[] = [];
  for (const filePath of collectSourceFilePaths(getSourceRoot())) {
    const relativePath = toAppRelativePath(filePath);
    const sourceFile = parseSourceFile(filePath);
    sourceFile.forEachChild((node) => {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      ) {
        return;
      }
      const resolvedModulePath = resolveAppImportModulePath(
        relativePath,
        node.moduleSpecifier.text,
      );
      if (
        resolvedModulePath &&
        DEPRECATED_CACHE_SHIM_MODULES.has(resolvedModulePath)
      ) {
        violations.push(
          violationForNode(
            sourceFile,
            filePath,
            node,
            node.moduleSpecifier.text,
          ),
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

  it("keeps cache-owner query-key imports declared per owner", () => {
    expect(collectCacheOwnerQueryKeyImportViolations()).toEqual([]);
  });

  it("keeps mutation, realtime, and action-provider files off query-key imports", () => {
    expect(collectCacheImportBoundaryViolations()).toEqual([]);
  });

  it("keeps imports off deprecated cache-owner re-export shims", () => {
    expect(collectDeprecatedCacheShimImportViolations()).toEqual([]);
  });
});
