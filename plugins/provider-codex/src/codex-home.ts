import path from "node:path";

/**
 * Where codex keeps its home: `$CODEX_HOME` or `~/.codex` — the same
 * resolution as `@bb/config/codex-home`, which this plugin cannot import (it
 * depends on the plugin SDK only). The result is resolved to an absolute path
 * without dot segments because the native-roots resolver contract requires
 * that form; the `auth.json` readers name the same file either way.
 */
export function resolveCodexHome(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  return path.resolve(env.CODEX_HOME?.trim() || path.join(homeDir, ".codex"));
}
