import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the split between `src/limits.ts` and `src/rpc-types.ts`: the
 * frontend bundle (`app.tsx` and everything it reaches through value
 * imports) must never pull in zod. A single value import of `rpc-types`
 * from a view made esbuild inline the whole schema graph and tripled
 * `dist/app.js`, which the host serves `cache-control: no-store`.
 *
 * Walks the source graph with a statement scanner rather than esbuild
 * (not a dependency of this plugin). Only relative and `@/` specifiers
 * are followed; bare specifiers are checked against zod.
 */

const PLUGIN_ROOT = resolve(import.meta.dirname, "..");
const FRONTEND_ENTRY = join(PLUGIN_ROOT, "app.tsx");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/**
 * Top-level `import ... from`, `export ... from`, side-effect `import "x"`,
 * and dynamic `import("x")`. The clause between the keyword and `from`
 * cannot contain a quote or semicolon, which stops it from spanning
 * statements. Anchoring to the start of a line skips commented-out
 * imports and JSDoc examples.
 */
const IMPORT_STATEMENT =
  /^[ \t]*(import|export)\s+([^;'"]*?)\s*from\s*["']([^"']+)["']|^[ \t]*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/gm;

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

/**
 * Resolves a relative or `@/` (plugin root, per tsconfig `paths`) specifier
 * the way the bundler does: `.js` specifiers name `.ts`/`.tsx` sources.
 * Returns `null` for bare specifiers and for non-script assets.
 */
function resolveLocalModule(
  fromFile: string,
  specifier: string,
): string | null {
  const base = specifier.startsWith("@/")
    ? join(PLUGIN_ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
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

/** Every source file the frontend bundle includes, with its bare specifiers. */
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
    // Without this the assertions below could pass vacuously after a
    // resolution bug; these are the files the guard exists to cover.
    expect(reachedPaths).toEqual(
      expect.arrayContaining([
        "detail-view.tsx",
        "overview-view.tsx",
        "lib/format-schedule.ts",
        "src/limits.ts",
      ]),
    );
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
