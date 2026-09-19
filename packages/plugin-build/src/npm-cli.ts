import { createRequire } from "node:module";
import { dirname, join } from "node:path";

function bundledNpmBin(fileName: string): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("npm/package.json")), "bin", fileName);
}

export function resolveBundledNpmCli(): string {
  return bundledNpmBin("npm-cli.js");
}

export function resolveBundledNpxCli(): string {
  return bundledNpmBin("npx-cli.js");
}
