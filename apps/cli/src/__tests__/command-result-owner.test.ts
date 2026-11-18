import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC_ROOT = fileURLToPath(new URL("..", import.meta.url));
const OWNER = "command-result.ts";

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === "__tests__" ? [] : sourceFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

function writesJson(node: ts.Node): boolean {
  if (ts.isParenthesizedExpression(node)) return writesJson(node.expression);
  if (ts.isConditionalExpression(node)) {
    return writesJson(node.whenTrue) || writesJson(node.whenFalse);
  }
  return (
    ts.isCallExpression(node) && node.expression.getText() === "JSON.stringify"
  );
}

function isStdoutWrite(callee: string): boolean {
  return (
    callee === "console.log" ||
    callee === "console.info" ||
    callee === "process.stdout.write"
  );
}

interface Violation {
  file: string;
  line: number;
  text: string;
}

function findViolations(file: string): Violation[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const violations: Violation[] = [];
  const report = (node: ts.Node) => {
    violations.push({
      file: relative(SRC_ROOT, file).split(sep).join("/"),
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      text: node.getText().replace(/\s+/g, ""),
    });
  };
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      if (callee === "process.exit" || callee === "process.exitCode") {
        report(node);
      }
      const first = node.arguments[0];
      if (isStdoutWrite(callee) && first !== undefined && writesJson(first)) {
        report(node);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText() === "process.exitCode"
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return violations;
}

const ALLOWED_EXITS = new Map([
  [
    "commands/environment.ts",
    "retired bb environment git aliases pass the bb git plugin's exit code through",
  ],
  [
    "commands/plugin.ts",
    "bb plugin run passes the plugin command's own exit code through",
  ],
]);

describe("command result owner", () => {
  it("is the only place that writes a JSON result or chooses an exit code", () => {
    const violations = sourceFiles(join(SRC_ROOT, "commands"))
      .filter((file) => !file.endsWith(OWNER))
      .flatMap(findViolations)
      .filter(
        (violation) =>
          !(
            ALLOWED_EXITS.has(violation.file) &&
            violation.text.startsWith("process.exit(awaitrunPluginCliCommand(")
          ),
      );
    expect(violations).toEqual([]);
    for (const reason of ALLOWED_EXITS.values()) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
