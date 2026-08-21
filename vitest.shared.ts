import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { mergeConfig, type ViteUserConfig } from "vitest/config";

/**
 * Wraps a package's Vitest config so workspace imports (`@bb/*`) resolve to
 * package sources instead of built `dist/` output.
 *
 * Every workspace package's export map carries a `source` condition pointing
 * at `src/` — the same condition used by `node --conditions=source` in dev,
 * esbuild bundling (`scripts/build-utils.mjs`), and tsc (`customConditions`
 * in `packages/tsconfig/typecheck-overrides.json`). Vitest resolves test
 * imports through Vite's server environment, which only honors conditions
 * under `ssr.resolve`, so a plain `resolve.conditions` entry has no effect on
 * tests. Only `source` is listed here: Vitest contributes its own default
 * conditions through a config plugin, and Vite concatenates these arrays
 * with them during config merge.
 */
/**
 * Vitest APIs that mutate worker-global state (the module registry, globals,
 * or `process.env`). Files calling any of these need their own isolated
 * worker; running them with `isolate: false` makes mocks bleed across files
 * or silently fail to apply when the target module is already loaded.
 */
const ISOLATION_REQUIRING_API =
  /\bvi\.(mock|doMock|unmock|doUnmock|resetModules|stubGlobal|stubEnv)\(/;

const TEST_FILE = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist"]);

/**
 * Finds test files under `roots` (relative to `pkgDir`) that use
 * worker-global vitest APIs and therefore must keep the default isolated
 * worker. Everything else can run in a shared worker context
 * (`isolate: false`), which skips re-importing the module graph for every
 * file — by far the dominant cost of the big suites in CI.
 *
 * Returns package-relative posix paths, usable directly as vitest
 * `include`/`exclude` entries.
 */
export function findIsolationRequiringTests(
  pkgDir: string,
  roots: string[],
): string[] {
  const matches: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(fullPath);
      } else if (
        TEST_FILE.test(entry.name) &&
        ISOLATION_REQUIRING_API.test(readFileSync(fullPath, "utf8"))
      ) {
        matches.push(path.relative(pkgDir, fullPath).split(path.sep).join("/"));
      }
    }
  };
  for (const root of roots) walk(path.join(pkgDir, root));
  return matches.sort();
}

export function defineWorkspaceTestConfig(
  config: ViteUserConfig,
): ViteUserConfig {
  return mergeConfig(
    {
      resolve: {
        conditions: ["source"],
      },
      test: {
        coverage: {
          provider: "v8",
          include: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
          exclude: [
            "**/*.d.ts",
            "**/*.test.{ts,tsx,js,jsx,mjs,cjs}",
            "**/*.spec.{ts,tsx,js,jsx,mjs,cjs}",
            "**/*.stories.{ts,tsx,js,jsx}",
            "**/*.gen.{ts,tsx,js,jsx}",
            "**/__fixtures__/**",
            "**/__tests__/**",
            "**/generated/**",
            ".turbo/**",
            "coverage/**",
            "dist/**",
            "node_modules/**",
            "scripts/**",
            "test/**",
            "tests/**",
            "*.config.{ts,js,mts,mjs}",
            "vite.{ts,js,mts,mjs}",
            "vitest.{ts,js,mts,mjs}",
          ],
          reporter: ["text-summary", "json-summary"],
        },
      },
      ssr: {
        resolve: {
          conditions: ["source"],
          externalConditions: ["source"],
        },
      },
    },
    config,
  );
}
