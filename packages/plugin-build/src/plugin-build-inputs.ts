import { resolve } from "node:path";
import type { Metafile } from "esbuild";

export function pluginBuildInputPaths(
  metafile: Metafile | undefined,
  cwd: string,
): string[] {
  if (metafile === undefined)
    throw new Error("Plugin build did not report its inputs");
  return Object.keys(metafile.inputs)
    .filter((input) => !input.startsWith("(") && !/^[a-z-]+:/u.test(input))
    .map((input) => resolve(cwd, input));
}
