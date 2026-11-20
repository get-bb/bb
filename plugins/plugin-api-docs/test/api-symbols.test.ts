import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { SURFACE_GROUPS } from "../src/surfaces";

const pluginDir = path
  .dirname(path.dirname(fileURLToPath(import.meta.url)))
  .replaceAll("\\", "/");
const sdkManifestPath = path.posix.join(
  pluginDir,
  "node_modules/@get-bb/plugin-sdk/package.json",
);
const sdkManifest: { exports: Record<string, unknown> } = JSON.parse(
  readFileSync(sdkManifestPath, "utf8"),
);

const PUBLIC_SUBPATHS = Object.keys(sdkManifest.exports)
  .filter((subpath) => !subpath.startsWith("./internal/"))
  .map((subpath) =>
    subpath === "."
      ? "@get-bb/plugin-sdk"
      : `@get-bb/plugin-sdk/${subpath.slice(2)}`,
  );

function createSdkResolver() {
  const probePath = path.posix.join(
    pluginDir,
    "test",
    "__api-symbols-probe__.ts",
  );
  const probeSource = PUBLIC_SUBPATHS.map(
    (specifier, index) => `import * as m${index} from "${specifier}";`,
  ).join("\n");
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    skipLibCheck: true,
    types: ["node"],
  };
  const host = ts.createCompilerHost(options);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === probePath
      ? ts.createSourceFile(fileName, probeSource, languageVersion, true)
      : readSourceFile(fileName, languageVersion, ...rest);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) =>
    fileName === probePath || fileExists(fileName);
  const program = ts.createProgram([probePath], options, host);
  const checker = program.getTypeChecker();
  const probe = program.getSourceFile(probePath);
  if (probe === undefined) throw new Error("API symbol probe did not load");

  const exportsByName = new Map<string, ts.Symbol>();
  const unresolvedSubpaths: string[] = [];
  for (const statement of probe.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier)) continue;
    const moduleSymbol = checker.getSymbolAtLocation(specifier);
    if (moduleSymbol === undefined) {
      unresolvedSubpaths.push(specifier.text);
      continue;
    }
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      if (!exportsByName.has(exported.name))
        exportsByName.set(exported.name, exported);
    }
  }

  const memberType = (symbol: ts.Symbol): ts.Type => {
    const target =
      symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    return target.flags &
      (ts.SymbolFlags.Interface |
        ts.SymbolFlags.TypeAlias |
        ts.SymbolFlags.Class) && !(target.flags & ts.SymbolFlags.Value)
      ? checker.getDeclaredTypeOfSymbol(target)
      : checker.getTypeOfSymbol(target);
  };

  const resolves = (apiSymbol: string): boolean => {
    const [head, ...members] = apiSymbol.split(".");
    let symbol = head === undefined ? undefined : exportsByName.get(head);
    for (const member of members) {
      if (symbol === undefined) return false;
      const type = checker.getNonNullableType(memberType(symbol));
      const candidates = type.isUnion() ? type.types : [type];
      symbol = candidates
        .map(
          (candidate) =>
            checker.getPropertyOfType(candidate, member) ??
            checker.getPropertyOfType(
              checker.getApparentType(candidate),
              member,
            ),
        )
        .find((property) => property !== undefined);
    }
    return symbol !== undefined;
  };

  return { exportCount: exportsByName.size, resolves, unresolvedSubpaths };
}

describe("Plugin Guide SDK symbols", () => {
  it("names only symbols the public SDK exports", { timeout: 60_000 }, () => {
    const resolver = createSdkResolver();
    expect(resolver.unresolvedSubpaths).toEqual([]);
    expect(resolver.exportCount).toBeGreaterThan(500);

    const missing = SURFACE_GROUPS.flatMap((group) =>
      group.surfaces.flatMap((surface) =>
        surface.apiSymbols
          .filter((apiSymbol) => !resolver.resolves(apiSymbol))
          .map((apiSymbol) => `${surface.id}: ${apiSymbol}`),
      ),
    );
    expect(missing).toEqual([]);
  });
});
