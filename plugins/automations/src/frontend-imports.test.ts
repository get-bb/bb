import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the split between `src/limits.ts` and `src/rpc-types.ts`: the
 * frontend bundle (`app.tsx` and everything it reaches through value
 * imports) must never pull in zod. A single value import of `rpc-types`
 * from a view made esbuild inline the whole schema graph and tripled
 * `dist/app.js`, which the app evaluates on every boot (the bundle URL is
 * content-hashed and served immutable, so the recurring cost is
 * parse/evaluate, not download).
 *
 * Walks the source graph with a statement scanner rather than esbuild
 * (not a dependency of this plugin). It follows relative and `@/`
 * specifiers and every `@bb/*` workspace package through its `exports`
 * map under the `source` condition into `packages/<pkg>/src`; a package
 * that is not linked in this plugin's `node_modules` or has no `source`
 * export throws, so a new workspace import has to be resolved here rather
 * than slipping past the guard. `@bb/shared-ui/icon` and `@bb/plugin-sdk/app`
 * are host slots and are left out. Only third-party bare specifiers are
 * merely compared against zod.
 *
 * The scanner does not tree-shake: a root-barrel `@bb/domain` import
 * reaches every zod-backed module the barrel re-exports and fails the
 * guard even where esbuild would drop them as unused. That is deliberate:
 * import the leaf subpath (`@bb/domain/update-state`) instead.
 */

const PLUGIN_ROOT = realpathSync(resolve(import.meta.dirname, ".."));
const FRONTEND_ENTRY = join(PLUGIN_ROOT, "app.tsx");
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);

/**
 * Every `@bb/*` workspace package is bundled from source: the plugin build
 * (`RUNTIME_SLOT_BY_SPECIFIER` in @bb/plugin-build) has no host slot for
 * any of them except the legacy `@bb/plugin-sdk/app` SDK alias, which the
 * lookahead keeps bare, and `@bb/shared-ui/icon`, which is dropped after
 * resolution. Matching the whole scope rather than a fixed list means an
 * unknown package is resolved or throws instead of being compared against
 * zod like a third-party dependency and passing. Captures the package name
 * and the (possibly empty) export subpath.
 */
const BUNDLED_WORKSPACE_SPECIFIER =
  /^(@bb\/(?!plugin-sdk(?:\/|$))[^/]+)((?:\/.*)?)$/;

/**
 * shared-ui's icon module comes from the host (`RUNTIME_SLOT_BY_SPECIFIER`
 * in @bb/plugin-build) whether a plugin imports it by package specifier or
 * a shared-ui component reaches it relatively, so neither form is followed.
 */
const HOST_PROVIDED_ICON_MODULE =
  /\/shared-ui\/src\/components\/ui\/icon\.tsx$/;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Resolves `@bb/<pkg>[/<subpath>]` the way the plugin build does: through
 * the package's `exports` map under the `source` condition, which points
 * every entry at a `.ts`/`.tsx` file under `packages/<pkg>/src`. The
 * package directory is realpath'd through the plugin's `node_modules` link
 * so reached paths are canonical.
 */
function workspaceSourceFile(packageName: string, subpath: string): string {
  const link = join(PLUGIN_ROOT, "node_modules", packageName);
  if (!existsSync(link)) {
    throw new Error(
      `${packageName} is not a dependency of this plugin (no node_modules link)`,
    );
  }
  const packageDir = realpathSync(link);
  const manifest: unknown = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  );
  const entry =
    isRecord(manifest) && isRecord(manifest.exports)
      ? manifest.exports[`.${subpath}`]
      : undefined;
  const source = isRecord(entry) ? entry.source : undefined;
  if (typeof source !== "string") {
    throw new Error(
      `${packageName}${subpath} has no "source" export in its package.json`,
    );
  }
  return resolve(packageDir, source);
}

/**
 * Resolves a specifier the bundle inlines from source (relative, `@/` for
 * the plugin root per tsconfig `paths`, or a bundled workspace package)
 * the way the bundler does: `.js` specifiers name `.ts`/`.tsx` sources.
 * Returns `null` for everything the bundle does not inline: other bare
 * specifiers, the host-provided icon module, and non-script assets.
 */
function resolveLocalModule(
  fromFile: string,
  specifier: string,
): string | null {
  const workspace = BUNDLED_WORKSPACE_SPECIFIER.exec(specifier);
  const base = specifier.startsWith("@/")
    ? join(PLUGIN_ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : workspace !== null
        ? workspaceSourceFile(workspace[1], workspace[2])
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
  if (HOST_PROVIDED_ICON_MODULE.test(resolved)) return null;
  return SOURCE_EXTENSIONS.has(extname(resolved)) ? resolved : null;
}

/**
 * Every source file the frontend bundle includes, with the specifiers it
 * imports that are not inlined from source.
 */
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
    // resolution bug; these are the files the guard exists to cover,
    // including the workspace sources the bundle inlines from packages/.
    expect(reachedPaths).toEqual(
      expect.arrayContaining([
        "detail-view.tsx",
        "overview-view.tsx",
        "lib/format-schedule.ts",
        "src/limits.ts",
        "../../packages/domain/src/update-state.ts",
        "../../packages/shared-ui/src/components/ui/button.tsx",
      ]),
    );
  });

  it("never treats an unfollowed @bb package as a third-party specifier", () => {
    // A workspace package the plugin does not depend on yet must surface
    // loudly when it first appears, not be compared against "zod" and pass:
    // the build would inline it from source exactly like @bb/domain.
    expect(() =>
      resolveLocalModule(FRONTEND_ENTRY, "@bb/plugin-interaction-contracts"),
    ).toThrow(/plugin-interaction-contracts/);
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
