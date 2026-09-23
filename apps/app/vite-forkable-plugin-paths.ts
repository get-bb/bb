import { readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

interface ForkablePluginPaths {
  root: string;
  paths: [pattern: string, target: string][];
}

function readForkablePluginPaths(): ForkablePluginPaths[] {
  const { plugins } = JSON.parse(
    readFileSync(join(repoRoot, "scripts", "forkable-plugins.json"), "utf8"),
  ) as { plugins: string[] };
  return plugins.map((pluginDir) => {
    const root = join(repoRoot, pluginDir);
    const tsconfig = JSON.parse(
      readFileSync(join(root, "tsconfig.json"), "utf8"),
    ) as { compilerOptions?: { paths?: Record<string, string[]> } };
    const paths = Object.entries(tsconfig.compilerOptions?.paths ?? {}).map(
      ([pattern, [target]]): [string, string] => [
        pattern,
        resolve(root, target),
      ],
    );
    return { root: `${root}${sep}`, paths };
  });
}

function mapPath(
  specifier: string,
  paths: ForkablePluginPaths["paths"],
): string | null {
  const exact = paths.find(([pattern]) => pattern === specifier);
  if (exact !== undefined) return exact[1];
  const [match] = paths
    .filter(
      ([pattern]) =>
        pattern.endsWith("*") && specifier.startsWith(pattern.slice(0, -1)),
    )
    .sort(([left], [right]) => right.length - left.length);
  return match === undefined
    ? null
    : match[1].replace("*", specifier.slice(match[0].length - 1));
}

export function forkablePluginPaths(appSourceDir: string): Plugin {
  const plugins = readForkablePluginPaths();
  const appSourcePrefix = `${appSourceDir}${sep}`;
  return {
    name: "bb:forkable-plugin-paths",
    enforce: "pre",
    resolveId(source, importer, options) {
      if (importer === undefined || !source.startsWith(appSourcePrefix)) {
        return null;
      }
      const plugin = plugins.find(({ root }) => importer.startsWith(root));
      if (plugin === undefined) return null;
      const target = mapPath(
        `@/${source.slice(appSourcePrefix.length).split(sep).join("/")}`,
        plugin.paths,
      );
      return target === null
        ? null
        : this.resolve(target, importer, { ...options, skipSelf: true });
    },
  };
}
