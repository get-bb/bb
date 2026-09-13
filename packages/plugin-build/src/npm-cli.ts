import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function resolvePluginNpmCli(): string {
  const require = createRequire(import.meta.url);
  return join(
    dirname(require.resolve("npm/package.json")),
    "bin",
    "npm-cli.js",
  );
}
