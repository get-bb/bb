import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type ReadSource = "host-state" | "host-workspace" | "server-state";

const READ_SOURCES: Record<string, ReadSource> = {
  "environments.listProviders": "host-state",
  "hostDaemon.fetchWorkspaceOpenTargets": "host-state",
  "hosts.providerCliStatus": "host-state",
  "projects.commands": "host-state",
  "providers.list": "host-state",
  "system.cliSkillsStatus": "host-state",
  "system.executionOptions": "host-state",
  "system.experimental_cliCommand": "host-state",
  "system.providerStates": "host-state",

  "environments.paths": "host-workspace",
  "hosts.cloneDefaultPath": "host-workspace",
  "hosts.directory": "host-workspace",
  "hosts.experimental_discoverRepos": "host-workspace",
  "hosts.pathsExist": "host-workspace",
  "projects.paths": "host-workspace",
  "skills.getContent": "host-workspace",
  "skills.list": "host-workspace",
  "skills.listFiles": "host-workspace",
  "terminals.output": "host-workspace",
  "threads.defaultExecutionOptions": "host-workspace",
  "threads.storageFiles": "host-workspace",
  "threads.storageLocation": "host-workspace",
  "threads.storagePaths": "host-workspace",

  "environments.get": "server-state",
  "experimental_server.moveStatus": "server-state",
  "hosts.experimental_listProviders": "server-state",
  "hosts.experimental_providerCliInstallJobs.list": "server-state",
  "hosts.list": "server-state",
  "projects.defaultExecutionOptions": "server-state",
  "projects.machineEnvironment": "server-state",
  "projects.promptHistory": "server-state",
  "providers.catalog": "server-state",
  "skills.registry.detail": "server-state",
  "skills.registry.entries": "server-state",
  "skills.registry.get": "server-state",
  "skills.registry.repositoryStars": "server-state",
  "skills.registry.search": "server-state",
  "system.aiServices": "server-state",
  "system.appUpdate": "server-state",
  "system.config": "server-state",
  "system.machineEnvironment": "server-state",
  "system.mobileAppReleases": "server-state",
  "system.uiPreferences.list": "server-state",
  "system.version": "server-state",
  "terminals.list": "server-state",
  "theme.resolve": "server-state",
  "threads.conversationOutline": "server-state",
  "threads.count": "server-state",
  "threads.get": "server-state",
  "threads.interactions.list": "server-state",
  "threads.list": "server-state",
  "threads.promptHistory": "server-state",
  "threads.queuedMessages.list": "server-state",
  "threads.search": "server-state",
  "threads.tabs.get": "server-state",
  "threads.timeline": "server-state",
  "threads.timelineTurnSummaryDetails": "server-state",
};

const HOST_DAEMON_CLIENT_MODULE = "lib/api-host-daemon.ts";
const HOST_DERIVED_POLICY = "HOST_DERIVED_QUERY_POLICY";
const POLICY_OVERRIDES = new Set(["meta", "refetchOnMount"]);
const NEVER_STALE_POLICIES = new Set([
  "REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY",
  "SERVER_SESSION_QUERY_POLICY",
  "SESSION_STATIC_QUERY_POLICY",
]);

interface QueryDefinition {
  location: string;
  reads: string[];
  policyProblems: string[];
}

interface ParsedModule {
  relativePath: string;
  sourceFile: ts.SourceFile;
  declarations: Map<string, ts.Node>;
  imports: Map<string, { modulePath: string; name: string }>;
}

const sourceRoot = path.resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const moduleCache = new Map<string, ParsedModule | null>();

function collectSourceFilePaths(directoryPath: string): string[] {
  return readdirSync(directoryPath).flatMap((entryName) => {
    const entryPath = path.join(directoryPath, entryName);
    if (statSync(entryPath).isDirectory()) {
      return collectSourceFilePaths(entryPath);
    }
    const relativePath = toRelativePath(entryPath);
    return /\.tsx?$/.test(entryPath) && !isTestOrStoryFile(relativePath)
      ? [entryPath]
      : [];
  });
}

function toRelativePath(filePath: string): string {
  return path.relative(sourceRoot, filePath).split(path.sep).join("/");
}

function isTestOrStoryFile(relativePath: string): boolean {
  return (
    relativePath.startsWith("test/") ||
    relativePath.includes(".test.") ||
    relativePath.includes(".stories.") ||
    relativePath.endsWith(".d.ts")
  );
}

function resolveModulePath(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : null;
  if (base === null) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function parseModule(filePath: string): ParsedModule | null {
  if (moduleCache.has(filePath)) return moduleCache.get(filePath) ?? null;
  if (!existsSync(filePath)) {
    moduleCache.set(filePath, null);
    return null;
  }
  const sourceFile = ts.createSourceFile(
    toRelativePath(filePath),
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const declarations = new Map<string, ts.Node>();
  const imports = new Map<string, { modulePath: string; name: string }>();
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer);
        }
      }
    } else if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      const modulePath = resolveModulePath(
        filePath,
        statement.moduleSpecifier.text,
      );
      if (modulePath === null) continue;
      for (const element of statement.importClause.namedBindings.elements) {
        imports.set(element.name.text, {
          modulePath,
          name: (element.propertyName ?? element.name).text,
        });
      }
    }
  }
  const parsed = {
    relativePath: toRelativePath(filePath),
    sourceFile,
    declarations,
    imports,
  };
  moduleCache.set(filePath, parsed);
  return parsed;
}

function collectReads(
  module: ParsedModule,
  node: ts.Node,
  visited: Set<string>,
): string[] {
  const reads: string[] = [];
  const followIdentifier = (name: string) => {
    const local = module.declarations.get(name);
    const localKey = `${module.relativePath}#${name}`;
    if (local !== undefined) {
      if (visited.has(localKey)) return;
      visited.add(localKey);
      reads.push(...collectReads(module, local, visited));
      return;
    }
    const imported = module.imports.get(name);
    if (imported === undefined) return;
    const target = parseModule(imported.modulePath);
    if (target === null) return;
    if (target.relativePath === HOST_DAEMON_CLIENT_MODULE) {
      reads.push(`hostDaemon.${imported.name}`);
      return;
    }
    const declaration = target.declarations.get(imported.name);
    const importedKey = `${target.relativePath}#${imported.name}`;
    if (declaration === undefined || visited.has(importedKey)) return;
    visited.add(importedKey);
    reads.push(...collectReads(target, declaration, visited));
  };
  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current)) {
      const callee = current.expression.getText(module.sourceFile);
      const sdkRead = /^sdk\.([\w.]+)$/.exec(callee);
      if (sdkRead?.[1] !== undefined) {
        reads.push(sdkRead[1]);
      } else if (ts.isIdentifier(current.expression)) {
        followIdentifier(current.expression.text);
      }
    } else if (
      ts.isIdentifier(current) &&
      current.parent !== undefined &&
      ts.isPropertyAssignment(current.parent) &&
      current.parent.initializer === current
    ) {
      followIdentifier(current.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return reads;
}

function propertyName(
  property: ts.ObjectLiteralElementLike,
  sourceFile: ts.SourceFile,
): string | null {
  return property.name === undefined ? null : property.name.getText(sourceFile);
}

function policyProblems(
  objectLiteral: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): string[] {
  const problems: string[] = [];
  let spreadsHostPolicy = false;
  for (const property of objectLiteral.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = property.expression.getText(sourceFile);
      if (spread === HOST_DERIVED_POLICY) spreadsHostPolicy = true;
      if (NEVER_STALE_POLICIES.has(spread)) {
        problems.push(`spreads ${spread}`);
      }
      continue;
    }
    const name = propertyName(property, sourceFile);
    if (name === null) continue;
    if (spreadsHostPolicy && POLICY_OVERRIDES.has(name)) {
      problems.push(`overrides ${name} after ${HOST_DERIVED_POLICY}`);
    }
    if (
      name === "staleTime" &&
      ts.isPropertyAssignment(property) &&
      property.initializer.getText(sourceFile) === "Infinity"
    ) {
      problems.push("sets staleTime: Infinity");
    }
  }
  if (!spreadsHostPolicy) {
    problems.unshift(`does not spread ${HOST_DERIVED_POLICY}`);
  }
  return problems;
}

function lineOf(module: ParsedModule, node: ts.Node): string {
  const line =
    module.sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  return `${module.relativePath}:${line}`;
}

function collectAtomHostStateReads(): string[] {
  const violations: string[] = [];
  for (const filePath of collectSourceFilePaths(sourceRoot)) {
    const module = parseModule(filePath);
    if (module === null) continue;
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "atom"
      ) {
        for (const read of new Set(collectReads(module, node, new Set()))) {
          if (READ_SOURCES[read] === "host-state") {
            violations.push(`${lineOf(module, node)} ${read}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }
  return violations;
}

function collectQueryDefinitions(): QueryDefinition[] {
  const definitions: QueryDefinition[] = [];
  for (const filePath of collectSourceFilePaths(sourceRoot)) {
    const module = parseModule(filePath);
    if (module === null) continue;
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const queryFn = node.properties.find(
          (property) => propertyName(property, module.sourceFile) === "queryFn",
        );
        if (queryFn !== undefined) {
          definitions.push({
            location: lineOf(module, node),
            reads: [...new Set(collectReads(module, queryFn, new Set()))],
            policyProblems: policyProblems(node, module.sourceFile),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }
  return definitions;
}

const definitions = collectQueryDefinitions();

describe("host-derived query freshness", () => {
  it("classifies every read a query makes", () => {
    const unclassified = definitions.flatMap((definition) =>
      definition.reads
        .filter((read) => READ_SOURCES[read] === undefined)
        .map((read) => `${definition.location} ${read}`),
    );
    expect(unclassified).toEqual([]);
  });

  it("lists only reads that queries make", () => {
    const found = new Set(
      definitions.flatMap((definition) => definition.reads),
    );
    expect(
      Object.keys(READ_SOURCES).filter((read) => !found.has(read)),
    ).toEqual([]);
  });

  it("refreshes every host-state query through the host-derived owner", () => {
    const violations = definitions
      .filter((definition) =>
        definition.reads.some((read) => READ_SOURCES[read] === "host-state"),
      )
      .flatMap((definition) =>
        definition.policyProblems.map(
          (problem) =>
            `${definition.location} (${definition.reads.join(", ")}) ${problem}`,
        ),
      );
    expect(violations).toEqual([]);
  });

  it("keeps host-state reads out of atoms the owner cannot refresh", () => {
    expect(collectAtomHostStateReads()).toEqual([]);
  });
});
