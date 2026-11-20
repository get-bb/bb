import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const pluginDir = path
  .dirname(fileURLToPath(import.meta.url))
  .replaceAll("\\", "/");
const skillDir = path.posix.join(pluginDir, "skills", "bb-plugin-authoring");
const virtualDir = path.posix.join(pluginDir, "__skill-examples__");

const UNDECLARED_LOCAL_CODES = new Set([2304, 2552, 18004]);
const PLACEHOLDER = /(?<![\w\])])(?:\.\.\.|…)(?=\s*[}\])>,;\n])/g;
const FENCE_OPEN = /^(\s*)```(ts|tsx|typescript)\s*$/;

interface SkillExample {
  file: string;
  line: number;
  fileName: string;
  source: string;
}

function skillMarkdownFiles(): string[] {
  const references = readdirSync(path.posix.join(skillDir, "references"))
    .filter((name) => name.endsWith(".md") && !name.endsWith("-api-index.md"))
    .map((name) => path.posix.join("references", name));
  return ["SKILL.md", ...references];
}

function extractExamples(): SkillExample[] {
  const examples: SkillExample[] = [];
  for (const file of skillMarkdownFiles()) {
    const lines = readFileSync(path.posix.join(skillDir, file), "utf8").split(
      "\n",
    );
    for (let index = 0; index < lines.length; index += 1) {
      const open = FENCE_OPEN.exec(lines[index] ?? "");
      if (open === null) continue;
      const indent = open[1]?.length ?? 0;
      const close = new RegExp(`^\\s{0,${indent}}\`\`\`\\s*$`);
      const start = index + 1;
      let end = start;
      while (end < lines.length && !close.test(lines[end] ?? "")) end += 1;
      const body = lines
        .slice(start, end)
        .map((line) =>
          line.slice(Math.min(indent, line.length - line.trimStart().length)),
        )
        .join("\n");
      examples.push({
        file,
        line: start,
        fileName: path.posix.join(
          virtualDir,
          `example-${examples.length}.${open[2] === "tsx" ? "tsx" : "ts"}`,
        ),
        source: `${body.replace(PLACEHOLDER, "/*…*/")}\nexport {};\n`,
      });
      index = end;
    }
  }
  return examples;
}

const compilerOptions: ts.CompilerOptions = {
  strict: true,
  noImplicitAny: false,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  noEmit: true,
  skipLibCheck: true,
  types: ["node"],
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
};

function createProgram(files: ReadonlyMap<string, string>): ts.Program {
  const host = ts.createCompilerHost(compilerOptions);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const source = files.get(fileName);
    return source === undefined
      ? getSourceFile(fileName, languageVersion, ...rest)
      : ts.createSourceFile(
          fileName,
          source,
          languageVersion,
          true,
          fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
  };
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => files.has(fileName) || fileExists(fileName);
  const readFile = host.readFile.bind(host);
  host.readFile = (fileName) => files.get(fileName) ?? readFile(fileName);
  return ts.createProgram([...files.keys()], compilerOptions, host);
}

const SDK_MODULES = [
  { alias: "App", specifier: "@get-bb/plugin-sdk/app" },
  { alias: "Root", specifier: "@get-bb/plugin-sdk" },
] as const;

function sdkRuntimeGlobals(): string {
  const probePath = path.posix.join(virtualDir, "probe.ts");
  const probe = SDK_MODULES.map(
    ({ alias, specifier }) => `import * as ${alias} from "${specifier}";`,
  ).join("\n");
  const program = createProgram(new Map([[probePath, `${probe}\n`]]));
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(probePath);
  if (sourceFile === undefined) throw new Error("SDK probe did not load");
  const declared = new Set<string>();
  const lines = [
    ...SDK_MODULES.map(
      ({ alias, specifier }) =>
        `import type * as ${alias} from "${specifier}";`,
    ),
    "declare global {",
    "  const bb: Root.BbPluginApi;",
    "  const api: Root.BbPluginApi;",
    "  const app: App.PluginAppBuilder;",
  ];
  sourceFile.statements.forEach((statement, index) => {
    if (!ts.isImportDeclaration(statement)) return;
    const moduleSymbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
    const alias = SDK_MODULES[index]?.alias;
    if (moduleSymbol === undefined || alias === undefined) {
      throw new Error(
        `SDK module ${statement.moduleSpecifier.getText()} did not resolve`,
      );
    }
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const target =
        exported.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      if (!(target.flags & ts.SymbolFlags.Value) || declared.has(exported.name))
        continue;
      declared.add(exported.name);
      lines.push(`  const ${exported.name}: typeof ${alias}.${exported.name};`);
    }
  });
  lines.push("}", "export {};", "");
  return lines.join("\n");
}

function isAllowedFragmentGap(diagnostic: ts.Diagnostic): boolean {
  if (UNDECLARED_LOCAL_CODES.has(diagnostic.code)) return true;
  return (
    diagnostic.code === 2307 &&
    !ts
      .flattenDiagnosticMessageText(diagnostic.messageText, "\n")
      .includes("@get-bb/")
  );
}

describe("bb-plugin-authoring skill examples", () => {
  it("typecheck against the published SDK types", { timeout: 60_000 }, () => {
    const examples = extractExamples();
    expect(examples.length).toBeGreaterThan(50);
    const files = new Map<string, string>([
      [path.posix.join(virtualDir, "sdk-globals.d.ts"), sdkRuntimeGlobals()],
      ...examples.map((example) => [example.fileName, example.source] as const),
    ]);
    const program = createProgram(files);
    const problems = examples.flatMap((example) => {
      const sourceFile = program.getSourceFile(example.fileName);
      if (sourceFile === undefined) return [`${example.file}: not loaded`];
      return [
        ...program.getSyntacticDiagnostics(sourceFile),
        ...program.getSemanticDiagnostics(sourceFile),
      ]
        .filter((diagnostic) => !isAllowedFragmentGap(diagnostic))
        .map((diagnostic) => {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            diagnostic.start ?? 0,
          );
          return `${example.file}:${example.line + line + 1} TS${diagnostic.code} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`;
        });
    });
    expect(problems).toEqual([]);
  });
});
