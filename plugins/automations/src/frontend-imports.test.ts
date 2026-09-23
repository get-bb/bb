import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const PLUGIN_ROOT = realpathSync(resolve(import.meta.dirname, ".."));
const FRONTEND_ENTRY = join(PLUGIN_ROOT, "app.tsx");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

const IMPORT_STATEMENT =
  /^[ \t]*(import|export)\s+([^;'"]*?)\s*from\s*["']([^"']+)["']|^[ \t]*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;

const tsconfigSchema = z.object({
  compilerOptions: z.object({
    paths: z.record(z.string(), z.array(z.string()).min(1)),
  }),
});

const PATH_ALIASES = Object.entries(
  tsconfigSchema.parse(
    JSON.parse(readFileSync(join(PLUGIN_ROOT, "tsconfig.json"), "utf8")),
  ).compilerOptions.paths,
).map(([pattern, [target]]): [string, string] => [
  pattern,
  resolve(PLUGIN_ROOT, target),
]);

interface ImportEdge {
  specifier: string;
  typeOnly: boolean;
}

function isTypeOnlyClause(clause: string): boolean {
  const trimmed = clause.trim();
  if (/^type\s/.test(trimmed)) return true;
  const named = /^\{([^}]*)\}$/.exec(trimmed);
  if (named === null) return false;
  const specifiers = named[1]
    .split(",")
    .map((specifier) => specifier.trim())
    .filter((specifier) => specifier.length > 0);
  return (
    specifiers.length > 0 &&
    specifiers.every((specifier) => /^type\s/.test(specifier))
  );
}

function importEdges(source: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  for (const match of source.matchAll(IMPORT_STATEMENT)) {
    const [, , clause, fromSpecifier, sideEffectSpecifier, dynamicSpecifier] =
      match;
    if (fromSpecifier !== undefined) {
      edges.push({
        specifier: fromSpecifier,
        typeOnly: isTypeOnlyClause(clause ?? ""),
      });
    } else {
      const specifier = sideEffectSpecifier ?? dynamicSpecifier;
      if (specifier !== undefined) edges.push({ specifier, typeOnly: false });
    }
  }
  return edges;
}

function aliasedPath(specifier: string): string | null {
  const exact = PATH_ALIASES.find(([pattern]) => pattern === specifier);
  if (exact !== undefined) return exact[1];
  const [wildcard] = PATH_ALIASES.filter(
    ([pattern]) =>
      pattern.endsWith("*") && specifier.startsWith(pattern.slice(0, -1)),
  ).sort(([left], [right]) => right.length - left.length);
  return wildcard === undefined
    ? null
    : wildcard[1].replace("*", specifier.slice(wildcard[0].length - 1));
}

function resolveLocalModule(
  fromFile: string,
  specifier: string,
): string | null {
  const base = specifier.startsWith(".")
    ? resolve(dirname(fromFile), specifier)
    : aliasedPath(specifier);
  if (base === null) return null;
  const stem = base.replace(/\.js$/, "");
  const candidates = [
    `${stem}.ts`,
    `${stem}.tsx`,
    base,
    join(stem, "index.ts"),
    join(stem, "index.tsx"),
  ];
  const resolved = candidates.find(
    (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
  );
  if (resolved === undefined) {
    throw new Error(
      `cannot resolve ${specifier} from ${relative(PLUGIN_ROOT, fromFile)}`,
    );
  }
  return SOURCE_EXTENSIONS.has(extname(resolved)) ? resolved : null;
}

function collectFrontendModules(entry: string): Map<string, string[]> {
  const reached = new Map<string, string[]>();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || reached.has(file)) continue;
    const bareSpecifiers: string[] = [];
    reached.set(file, bareSpecifiers);
    for (const edge of importEdges(readFileSync(file, "utf8"))) {
      if (edge.typeOnly) continue;
      const local = resolveLocalModule(file, edge.specifier);
      if (local === null) bareSpecifiers.push(edge.specifier);
      else pending.push(local);
    }
  }
  return reached;
}

describe("automations frontend bundle", () => {
  const reached = collectFrontendModules(FRONTEND_ENTRY);
  const reachedPaths = [...reached.keys()].map((file) =>
    relative(PLUGIN_ROOT, file),
  );

  it("walks the real frontend graph", () => {
    expect(reachedPaths).toEqual(
      expect.arrayContaining([
        "detail-view.tsx",
        "overview-view.tsx",
        "lib/format-schedule.ts",
        "lib/edit-prompt.ts",
      ]),
    );
  });

  it("follows every registry component import", () => {
    const unfollowed = [...reached.values()]
      .flat()
      .filter((specifier) => specifier.startsWith("@/"));
    expect(unfollowed).toEqual([]);
  });

  it("never reaches the zod schema module through a value import", () => {
    expect(reachedPaths).not.toContain("src/rpc-types.ts");
  });

  it("imports nothing from zod", () => {
    const offenders = [...reached]
      .filter(([, specifiers]) =>
        specifiers.some(
          (specifier) => specifier === "zod" || specifier.startsWith("zod/"),
        ),
      )
      .map(([file]) => relative(PLUGIN_ROOT, file));
    expect(offenders).toEqual([]);
  });
});
