import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type CallSource = "host-state" | "host-workspace" | "other";

const HOST_STATE_READS = [
  "environments.listProviders",
  "hostDaemon.fetchWorkspaceOpenTargets",
  "hosts.providerCliStatus",
  "projects.commands",
  "providers.list",
  "system.cliSkillsStatus",
  "system.executionOptions",
  "system.experimental_cliCommand",
  "system.providerStates",
] as const;

const HOST_WORKSPACE_READS = [
  "environments.paths",
  "hosts.cloneDefaultPath",
  "hosts.directory",
  "hosts.experimental_discoverRepos",
  "hosts.pathsExist",
  "hosts.pickFolder",
  "projects.paths",
  "skills.getContent",
  "skills.list",
  "skills.listFiles",
  "terminals.output",
  "threads.defaultExecutionOptions",
  "threads.storageFiles",
  "threads.storageLocation",
  "threads.storagePaths",
] as const;

const OTHER_CALLS = [
  "environments.archiveThreads",
  "environments.commit",
  "environments.get",
  "environments.update",
  "experimental_server.cancelMove",
  "experimental_server.checkMove",
  "experimental_server.moveStatus",
  "experimental_server.startMove",
  "files.mkdir",
  "hostDaemon.fetchHostStatus",
  "hostDaemon.openInTarget",
  "hosts.delete",
  "hosts.experimental_create",
  "hosts.experimental_deleteOldServerCopy",
  "hosts.experimental_getEnrollmentCommand",
  "hosts.experimental_listProviders",
  "hosts.experimental_providerCliInstallJobs.list",
  "hosts.experimental_providerCliInstallJobs.wait",
  "hosts.experimental_reconnect",
  "hosts.experimental_resume",
  "hosts.experimental_retryCleanup",
  "hosts.experimental_startProviderCliInstall",
  "hosts.experimental_suspend",
  "hosts.get",
  "hosts.list",
  "hosts.retryUpdate",
  "hosts.update",
  "projects.attachments.copy",
  "projects.attachments.upload",
  "projects.create",
  "projects.defaultExecutionOptions",
  "projects.delete",
  "projects.machineEnvironment",
  "projects.promptHistory",
  "projects.reorder",
  "projects.replaceMachineEnvironment",
  "projects.sources.add",
  "projects.sources.delete",
  "projects.sources.update",
  "projects.update",
  "providers.catalog",
  "providers.setEnabled",
  "skills.registry.detail",
  "skills.registry.entries",
  "skills.registry.get",
  "skills.registry.repositoryStars",
  "skills.registry.search",
  "skills.remove",
  "system.acknowledgeAppUpdate",
  "system.aiServices",
  "system.appUpdate",
  "system.applyAppUpdate",
  "system.config",
  "system.experimental_cancelScheduledAppUpdate",
  "system.experimental_installCliCommand",
  "system.experimental_removeCliCommand",
  "system.experimental_setAppUpdateAuto",
  "system.installCliSkills",
  "system.machineEnvironment",
  "system.mobileAppReleases",
  "system.replaceMachineEnvironment",
  "system.setAiServiceSelection",
  "system.testAiService",
  "system.uiPreferences.list",
  "system.uiPreferences.set",
  "system.updateExperiments",
  "system.updateGeneralSettings",
  "system.updateKeyboardSettings",
  "system.version",
  "terminals.close",
  "terminals.create",
  "terminals.get",
  "terminals.list",
  "terminals.rename",
  "theme.resolve",
  "theme.set",
  "threadSections.create",
  "threadSections.delete",
  "threadSections.update",
  "threads.archiveAll",
  "threads.cancelPlan",
  "threads.conversationOutline",
  "threads.count",
  "threads.delete",
  "threads.editMessage",
  "threads.experimental_listCascade",
  "threads.experimental_listPluginMetadata",
  "threads.experimental_regenerateTitle",
  "threads.fork",
  "threads.get",
  "threads.getPluginMetadata",
  "threads.interactions.cancel",
  "threads.interactions.list",
  "threads.interactions.resolve",
  "threads.interactions.respond",
  "threads.list",
  "threads.markRead",
  "threads.markUnread",
  "threads.pin",
  "threads.promptHistory",
  "threads.queuedMessages.delete",
  "threads.queuedMessages.experimental_holdForEdit",
  "threads.queuedMessages.experimental_releaseEditHold",
  "threads.queuedMessages.list",
  "threads.queuedMessages.reorder",
  "threads.queuedMessages.send",
  "threads.queuedMessages.setGroupBoundary",
  "threads.queuedMessages.update",
  "threads.reorderPinned",
  "threads.resolveMentions",
  "threads.restoreEnvironment",
  "threads.search",
  "threads.send",
  "threads.spawn",
  "threads.stop",
  "threads.tabs.get",
  "threads.tabs.update",
  "threads.timeline",
  "threads.timelineTurnSummaryDetails",
  "threads.unarchive",
  "threads.unpin",
  "threads.update",
  "threads.updatePluginMetadata",
] as const;

const CALL_SOURCES = new Map<string, CallSource>([
  ...HOST_STATE_READS.map((call) => [call, "host-state"] as const),
  ...HOST_WORKSPACE_READS.map((call) => [call, "host-workspace"] as const),
  ...OTHER_CALLS.map((call) => [call, "other"] as const),
]);

const HOST_DAEMON_CLIENT_MODULE = "lib/api-host-daemon.ts";
const HOST_DERIVED_POLICY = "hostDerivedQueryPolicy";
const MOUNT_SKIPPING_POLICIES = new Set(["SESSION_STATIC_QUERY_POLICY"]);

const appRoot = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const repoRoot = path.resolve(appRoot, "../../..");
const pluginsRoot = path.join(repoRoot, "plugins");

interface ParsedModule {
  relativePath: string;
  sourceFile: ts.SourceFile;
  declarations: Map<string, ts.Node>;
  imports: Map<string, { modulePath: string; name: string }>;
}

interface ReadCall {
  node: ts.CallExpression;
  read: string;
}

interface LocatedReadCall extends ReadCall {
  location: string;
}

function isTestOrGenerated(relativePath: string): boolean {
  return (
    relativePath.startsWith("test/") ||
    /(^|\/)(node_modules|dist|__tests__|__fixtures__|test|tests)\//.test(
      relativePath,
    ) ||
    /\.(test|stories|bench)\./.test(relativePath) ||
    relativePath.endsWith(".d.ts")
  );
}

function collectSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entryName) => {
    if (entryName === "node_modules" || entryName.startsWith(".")) return [];
    const entryPath = path.join(root, entryName);
    if (statSync(entryPath).isDirectory()) return collectSourceFiles(entryPath);
    const relativePath = path
      .relative(root, entryPath)
      .split(path.sep)
      .join("/");
    return /\.tsx?$/.test(entryPath) && !isTestOrGenerated(relativePath)
      ? [entryPath]
      : [];
  });
}

function parseFile(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function namedDeclarations(sourceFile: ts.SourceFile): Map<string, ts.Node> {
  const declarations = new Map<string, ts.Node>();
  sourceFile.forEachChild(function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      declarations.set(node.name.text, node);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.set(node.name.text, node.initializer);
    }
    node.forEachChild(visit);
  });
  return declarations;
}

const moduleCache = new Map<string, ParsedModule | null>();

function resolveModulePath(fromFile: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(appRoot, specifier.slice(2))
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
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function parseModule(filePath: string): ParsedModule | null {
  if (moduleCache.has(filePath)) return moduleCache.get(filePath) ?? null;
  if (!existsSync(filePath)) {
    moduleCache.set(filePath, null);
    return null;
  }
  const sourceFile = parseFile(filePath);
  const imports = new Map<string, { modulePath: string; name: string }>();
  for (const statement of sourceFile.statements) {
    if (
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
  const parsed: ParsedModule = {
    relativePath: path.relative(appRoot, filePath).split(path.sep).join("/"),
    sourceFile,
    declarations: namedDeclarations(sourceFile),
    imports,
  };
  moduleCache.set(filePath, parsed);
  return parsed;
}

function readOfCall(
  module: ParsedModule,
  call: ts.CallExpression,
): string | null {
  const callee = call.expression.getText(module.sourceFile);
  const sdkRead = /^sdk\.([\w.]+)$/.exec(callee)?.[1];
  if (sdkRead !== undefined) return sdkRead;
  if (!ts.isIdentifier(call.expression)) return null;
  const imported = module.imports.get(call.expression.text);
  if (imported === undefined) return null;
  return parseModule(imported.modulePath)?.relativePath ===
    HOST_DAEMON_CLIENT_MODULE
    ? `hostDaemon.${imported.name}`
    : null;
}

function collectReadCalls(
  module: ParsedModule,
  node: ts.Node,
  visited: Set<string>,
): ReadCall[] {
  const calls: ReadCall[] = [];
  const follow = (name: string) => {
    const local = module.declarations.get(name);
    if (local !== undefined) {
      const key = `${module.relativePath}#${name}`;
      if (visited.has(key)) return;
      visited.add(key);
      calls.push(...collectReadCalls(module, local, visited));
      return;
    }
    const imported = module.imports.get(name);
    if (imported === undefined) return;
    const target = parseModule(imported.modulePath);
    if (target === null) return;
    const declaration = target.declarations.get(imported.name);
    const key = `${target.relativePath}#${imported.name}`;
    if (declaration === undefined || visited.has(key)) return;
    visited.add(key);
    calls.push(...collectReadCalls(target, declaration, visited));
  };
  const visit = (current: ts.Node) => {
    if (ts.isCallExpression(current)) {
      const read = readOfCall(module, current);
      if (read !== null) {
        calls.push({ node: current, read });
      } else if (ts.isIdentifier(current.expression)) {
        follow(current.expression.text);
      }
    } else if (
      ts.isIdentifier(current) &&
      current.parent !== undefined &&
      ts.isPropertyAssignment(current.parent) &&
      current.parent.initializer === current
    ) {
      follow(current.text);
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return calls;
}

function lineOf(module: ParsedModule, node: ts.Node): string {
  const line =
    module.sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  return `${module.relativePath}:${line}`;
}

function propertyName(
  property: ts.ObjectLiteralElementLike,
  sourceFile: ts.SourceFile,
): string | null {
  return property.name === undefined ? null : property.name.getText(sourceFile);
}

function hostPolicyIndex(
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): number {
  return object.properties.findIndex(
    (property) =>
      ts.isSpreadAssignment(property) &&
      ts.isCallExpression(property.expression) &&
      property.expression.expression.getText(sourceFile) ===
        HOST_DERIVED_POLICY,
  );
}

function freshnessProblems(
  object: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  ownerIndex: number,
): string[] {
  const problems: string[] = [];
  object.properties.forEach((property, index) => {
    if (ts.isSpreadAssignment(property)) {
      const spread = property.expression.getText(sourceFile);
      if (MOUNT_SKIPPING_POLICIES.has(spread)) {
        problems.push(`spreads ${spread}`);
      }
      return;
    }
    const name = propertyName(property, sourceFile);
    if (
      name === "refetchOnMount" &&
      !(
        ts.isPropertyAssignment(property) &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword
      )
    ) {
      problems.push("sets refetchOnMount");
    }
    if (name === "meta" && index > ownerIndex) {
      problems.push("overrides meta");
    }
  });
  return problems;
}

interface AppScan {
  ownedCalls: Set<ts.CallExpression>;
  allCalls: LocatedReadCall[];
  freshnessViolations: string[];
}

function enclosingDeclarationNames(node: ts.Node): string[] {
  const names: string[] = [];
  let owner: ts.Node | undefined = node.parent;
  while (owner !== undefined && !ts.isSourceFile(owner)) {
    if (ts.isFunctionDeclaration(owner) && owner.name) {
      names.push(owner.name.text);
    } else if (ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name)) {
      names.push(owner.name.text);
    }
    owner = owner.parent;
  }
  return names;
}

function scanApp(): AppScan {
  const ownedCalls = new Set<ts.CallExpression>();
  const allCalls: LocatedReadCall[] = [];
  const freshnessViolations: string[] = [];
  const hostDefinitionFactories = new Set<string>();
  const modules = collectSourceFiles(appRoot).flatMap((filePath) => {
    const module = parseModule(filePath);
    return module === null ? [] : [module];
  });

  for (const module of modules) {
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const queryFn = node.properties.find(
          (property) => propertyName(property, module.sourceFile) === "queryFn",
        );
        const policyIndex = hostPolicyIndex(node, module.sourceFile);
        if (queryFn !== undefined && policyIndex >= 0) {
          for (const problem of freshnessProblems(
            node,
            module.sourceFile,
            policyIndex,
          )) {
            freshnessViolations.push(`${lineOf(module, node)} ${problem}`);
          }
          for (const call of collectReadCalls(module, queryFn, new Set())) {
            ownedCalls.add(call.node);
          }
          for (const name of enclosingDeclarationNames(node)) {
            hostDefinitionFactories.add(name);
          }
        }
      }
      if (ts.isCallExpression(node)) {
        const read = readOfCall(module, node);
        if (read !== null) {
          allCalls.push({ location: lineOf(module, node), read, node });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }

  for (const module of modules) {
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        const spreadIndex = node.properties.findIndex(
          (property) =>
            ts.isSpreadAssignment(property) &&
            ts.isCallExpression(property.expression) &&
            ts.isIdentifier(property.expression.expression) &&
            hostDefinitionFactories.has(property.expression.expression.text),
        );
        if (spreadIndex >= 0) {
          for (const problem of freshnessProblems(
            node,
            module.sourceFile,
            spreadIndex,
          )) {
            freshnessViolations.push(`${lineOf(module, node)} ${problem}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(module.sourceFile);
  }
  return { ownedCalls, allCalls, freshnessViolations };
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  let current = node.parent;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function declaresIdentifier(scope: ts.Node, name: string): boolean {
  let found = false;
  scope.forEachChild(function visit(child) {
    if (found || (ts.isFunctionLike(child) && child !== scope)) return;
    if (
      (ts.isVariableDeclaration(child) || ts.isParameter(child)) &&
      ts.isIdentifier(child.name) &&
      child.name.text === name
    ) {
      found = true;
      return;
    }
    child.forEachChild(visit);
  });
  return found;
}

function collectPluginHostStateStores(hostStateReads: Set<string>): string[] {
  const violations: string[] = [];
  for (const pluginName of readdirSync(pluginsRoot)) {
    const pluginDir = path.join(pluginsRoot, pluginName);
    if (!statSync(pluginDir).isDirectory()) continue;
    for (const filePath of collectSourceFiles(pluginDir)) {
      const sourceFile = parseFile(filePath);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node)) {
          const read = /(?:^|\.)sdk\.([\w.]+)$/.exec(
            node.expression.getText(sourceFile),
          )?.[1];
          if (read !== undefined && hostStateReads.has(read)) {
            let value: ts.Node = node;
            while (
              ts.isAwaitExpression(value.parent) ||
              ts.isParenthesizedExpression(value.parent)
            ) {
              value = value.parent;
            }
            const parent = value.parent;
            const stored =
              ts.isBinaryExpression(parent) &&
              parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
                ? parent.left.getText(sourceFile)
                : null;
            const scope = enclosingFunction(node);
            if (
              stored !== null &&
              (scope === undefined || !declaresIdentifier(scope, stored))
            ) {
              const line =
                sourceFile.getLineAndCharacterOfPosition(node.getStart()).line +
                1;
              const relativePath = path
                .relative(repoRoot, filePath)
                .split(path.sep)
                .join("/");
              violations.push(`${relativePath}:${line} ${read} -> ${stored}`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }
  }
  return violations;
}

const appScan = scanApp();
const hostStateReads = new Set<string>(HOST_STATE_READS);

describe("host-derived state freshness", () => {
  it("classifies every SDK and host-daemon call the app makes", () => {
    expect(
      appScan.allCalls
        .filter(({ read }) => !CALL_SOURCES.has(read))
        .map(({ location, read }) => `${location} ${read}`),
    ).toEqual([]);
  });

  it("lists only calls the app makes", () => {
    const made = new Set(appScan.allCalls.map(({ read }) => read));
    expect([...CALL_SOURCES.keys()].filter((call) => !made.has(call))).toEqual(
      [],
    );
  });

  it("reads host state only in queries the host-derived owner invalidates", () => {
    expect(
      appScan.allCalls
        .filter(
          ({ read, node }) =>
            hostStateReads.has(read) && !appScan.ownedCalls.has(node),
        )
        .map(({ location, read }) => `${location} ${read}`),
    ).toEqual([]);
  });

  it("keeps host-derived queries refetchable after invalidation", () => {
    expect(appScan.freshnessViolations).toEqual([]);
  });

  it("keeps plugins from storing host state beyond the reading call", () => {
    expect(collectPluginHostStateStores(hostStateReads)).toEqual([]);
  });
});
