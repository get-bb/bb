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
export function defineWorkspaceTestConfig(
  config: ViteUserConfig,
): ViteUserConfig {
  return mergeConfig(
    {
      resolve: {
        conditions: ["source"],
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
