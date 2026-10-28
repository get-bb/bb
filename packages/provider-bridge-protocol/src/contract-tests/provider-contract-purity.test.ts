import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import {
  pendingInteractionPayloadSchema,
  interactionRequestPayloadSchema,
  providerInfoSchema,
  runtimeThreadExecutionOptionsSchema,
  threadEventItemSchema,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  bridgeCapabilitiesSchema,
  bridgeExecutionOptionsSchema,
  providerRecoveryNotificationSchema,
  threadDeltaSchema,
} from "../index.js";
import { collectZodKeyPaths } from "./zod-shape.js";

const PROVIDER_NAME_SEGMENTS = new Set([
  "codex",
  "claude",
  "pi",
  "acp",
  "cursor",
]);

const allowlistSchema = z.object({
  $comment: z.string(),
  entries: z.array(
    z.object({
      path: z.string().min(1),
      removedBy: z.string().min(1),
    }),
  ),
});

const SCANNED_SCHEMAS: ReadonlyArray<readonly [string, z.ZodType]> = [
  ["bridgeExecutionOptionsSchema", bridgeExecutionOptionsSchema],
  ["runtimeThreadExecutionOptionsSchema", runtimeThreadExecutionOptionsSchema],
  ["bridgeCapabilitiesSchema", bridgeCapabilitiesSchema],
  ["threadDeltaSchema", threadDeltaSchema],
  ["threadEventItemSchema", threadEventItemSchema],
  ["providerInfoSchema", providerInfoSchema],
  ["providerRecoveryNotificationSchema", providerRecoveryNotificationSchema],
  ["pendingInteractionPayloadSchema", pendingInteractionPayloadSchema],
  ["interactionRequestPayloadSchema", interactionRequestPayloadSchema],
];

export function keySegments(key: string): string[] {
  return key
    .split(/(?=[A-Z])|[_\-.]/u)
    .map((segment) => segment.toLowerCase())
    .filter((segment) => segment.length > 0);
}

function keyNamesProvider(key: string): boolean {
  return keySegments(key).some((segment) =>
    PROVIDER_NAME_SEGMENTS.has(segment),
  );
}

function loadAllowlist(): Set<string> {
  const raw = readFileSync(
    fileURLToPath(
      new URL("./provider-contract-purity.allowlist.json", import.meta.url),
    ),
    "utf8",
  );
  const parsed = allowlistSchema.parse(JSON.parse(raw));
  const paths = parsed.entries.map((entry) => entry.path);
  expect(new Set(paths).size, "duplicate allowlist entries").toBe(paths.length);
  return new Set(paths);
}

describe("guardrail G2: the provider contract names no provider", () => {
  it("splits keys by segment so `pi` does not match inside other words", () => {
    expect(keySegments("claudeCodePermissionMode")).toEqual([
      "claude",
      "code",
      "permission",
      "mode",
    ]);
    expect(keyNamesProvider("capabilities")).toBe(false);
    expect(keyNamesProvider("expiresAt")).toBe(false);
    expect(keyNamesProvider("providerId")).toBe(false);
    expect(keyNamesProvider("acpLaunchSpec")).toBe(true);
    expect(keyNamesProvider("codex_goal")).toBe(true);
    expect(keyNamesProvider("piMode")).toBe(true);
  });

  it("flags every provider-named key and keeps the allowlist honest", () => {
    const allowlist = loadAllowlist();
    const offenders: string[] = collectProviderHomeResolutions();
    for (const [name, schema] of SCANNED_SCHEMAS) {
      for (const path of collectZodKeyPaths(schema, name)) {
        const key = path.slice(path.lastIndexOf(".") + 1);
        if (keyNamesProvider(key)) offenders.push(path);
      }
    }
    const unexpected = offenders.filter((path) => !allowlist.has(path));
    const unused = [...allowlist].filter((path) => !offenders.includes(path));

    expect(
      unexpected,
      "Provider home variables and home-relative provider paths must be resolved by the resolvers in the owning provider plugins. Provider-named contract keys belong in providerOptions.",
    ).toEqual([]);
    expect(
      unused,
      "allowlist entries that no longer match a key or provider-home resolution — delete them from provider-contract-purity.allowlist.json",
    ).toEqual([]);
  });
});

function collectProviderHomeResolutions(): string[] {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const directories = [
    "plugins/provider-claude-code/src",
    "plugins/provider-codex/src",
    "plugins/provider-pi/src",
    "plugins/provider-acp/src",
    "packages/provider-bridge-acp/src",
    "apps/host-daemon/src",
    "apps/server/src",
    "packages/config/src",
    "packages/plugin-sdk/src",
    "packages/process-utils/src",
  ];
  const offenders: string[] = [];
  for (const directory of directories) {
    for (const relative of readdirSync(path.join(root, directory), {
      recursive: true,
      encoding: "utf8",
    })) {
      if (
        !relative.endsWith(".ts") ||
        /(?:__tests__|test-support|fake-|\.test\.)/u.test(relative)
      )
        continue;
      const file = `${directory}/${relative}`;
      if (
        [
          "plugins/provider-claude-code/src/config-home.ts",
          "plugins/provider-codex/src/config-home.ts",
          "plugins/provider-pi/src/config-home.ts",
          "plugins/provider-acp/src/native-roots/omp.ts",
        ].includes(file)
      )
        continue;
      const source = ts.createSourceFile(
        file,
        readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      const osImports = new Set<string>();
      const homeImports = new Set<string>();
      for (const statement of source.statements) {
        if (
          !ts.isImportDeclaration(statement) ||
          !ts.isStringLiteral(statement.moduleSpecifier) ||
          !["node:os", "os"].includes(statement.moduleSpecifier.text)
        )
          continue;
        const clause = statement.importClause;
        if (clause?.name) osImports.add(clause.name.text);
        const bindings = clause?.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings))
          osImports.add(bindings.name.text);
        if (bindings && ts.isNamedImports(bindings)) {
          for (const binding of bindings.elements) {
            if ((binding.propertyName ?? binding.name).text === "homedir")
              homeImports.add(binding.name.text);
          }
        }
      }
      const homeVariables = new Set([
        "CLAUDE_CONFIG_DIR",
        "CODEX_HOME",
        "PI_CODING_AGENT_DIR",
      ]);
      const literals = new Map<string, string>();
      const collectLiterals = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          node.initializer &&
          ts.isStringLiteral(node.initializer)
        )
          literals.set(node.name.text, node.initializer.text);
        ts.forEachChild(node, collectLiterals);
      };
      collectLiterals(source);
      const literal = (node: ts.Node): string | undefined =>
        ts.isStringLiteral(node)
          ? node.text
          : ts.isIdentifier(node)
            ? literals.get(node.text)
            : undefined;
      const memberName = (node: ts.Node): string | undefined => {
        if (ts.isPropertyAccessExpression(node)) return node.name.text;
        if (ts.isElementAccessExpression(node))
          return literal(node.argumentExpression);
        return undefined;
      };
      const isHome = (node: ts.Node): boolean => {
        if (ts.isIdentifier(node))
          return /^(?:home|homeDir|userProfile)$/u.test(node.text);
        if (ts.isPropertyAccessExpression(node))
          return node.name.text === "homeDir";
        if (!ts.isCallExpression(node)) return false;
        const callee = node.expression;
        return (
          (ts.isIdentifier(callee) && homeImports.has(callee.text)) ||
          (ts.isPropertyAccessExpression(callee) &&
            ts.isIdentifier(callee.expression) &&
            osImports.has(callee.expression.text) &&
            callee.name.text === "homedir")
        );
      };
      const counts = new Map<string, number>();
      const visit = (node: ts.Node): void => {
        let read = memberName(node);
        if (ts.isBindingElement(node))
          read = (node.propertyName ?? node.name).getText(source);
        if (read === undefined || !homeVariables.has(read)) read = undefined;
        if (
          ts.isCallExpression(node) &&
          node.arguments[0] &&
          isHome(node.arguments[0])
        ) {
          const segments = node.arguments.slice(1).map(literal);
          const relativePath = segments.join("/");
          const providerPath = /^(\.claude|\.codex|\.pi\/agent)(?:\/|$)/u.exec(
            relativePath,
          )?.[1];
          if (providerPath) read = `home/${providerPath}`;
        }
        if (read !== undefined) {
          const count = (counts.get(read) ?? 0) + 1;
          counts.set(read, count);
          offenders.push(`${file}:${read}:${count}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return offenders;
}
