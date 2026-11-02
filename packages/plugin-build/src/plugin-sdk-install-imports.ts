import { readFile, realpath } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isPathWithinDirectory } from "@bb/process-utils";
import {
  isPluginSdkImportProvided,
  type PluginEntryKind,
} from "./plugin-sdk-runtime.js";
import { sourceImports } from "./source-imports.js";
import { isRecord, readPluginPackageJsonFile } from "./plugin-manifest.js";

export interface PluginSdkInstallImport {
  entry: PluginEntryKind;
  file: string;
  specifier: string;
}

const SOURCE_FILE_PATTERN = /\.[cm]?[jt]sx?$/u;
const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
];

export async function findPluginSdkInstallImports(
  rootDir: string,
): Promise<PluginSdkInstallImport[]> {
  const manifest = await readPluginPackageJsonFile(
    join(rootDir, "package.json"),
  );
  const bb = isRecord(manifest) && isRecord(manifest.bb) ? manifest.bb : {};
  const pluginRoot = await realpath(rootDir);
  const found: PluginSdkInstallImport[] = [];
  for (const entry of ["server", "host", "app"] as const) {
    const entryPath = bb[entry];
    if (typeof entryPath !== "string") continue;
    const pending = [resolve(pluginRoot, entryPath)];
    const visited = new Set<string>();
    for (const path of pending) {
      const file = await readSourceFile(pluginRoot, path);
      if (file === null || visited.has(file.path)) continue;
      visited.add(file.path);
      const relativeFile = relative(pluginRoot, file.path).split(sep).join("/");
      const reported = new Set<string>();
      for (const { specifier, names } of sourceImports(file.source)) {
        if (names.length === 0) continue;
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          pending.push(resolve(dirname(file.path), specifier));
          continue;
        }
        if (!/^@(?:get-)?bb\/plugin-sdk(?:\/|$)/u.test(specifier)) continue;
        const sdkSpecifier = specifier.replace(/^@bb\//u, "@get-bb/");
        if (
          !isPluginSdkImportProvided(entry, sdkSpecifier, names) &&
          !reported.has(specifier)
        ) {
          reported.add(specifier);
          found.push({ entry, file: relativeFile, specifier });
        }
      }
    }
  }
  return found;
}

async function readSourceFile(
  rootDir: string,
  path: string,
): Promise<{ path: string; source: string } | null> {
  for (const candidate of [
    path,
    path.replace(/\.([cm]?)jsx?$/u, ".$1ts"),
    path.replace(/\.jsx?$/u, ".tsx"),
    ...SOURCE_EXTENSIONS.map((extension) => `${path}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => join(path, `index${extension}`)),
  ]) {
    if (
      !SOURCE_FILE_PATTERN.test(candidate) ||
      !isPathWithinDirectory(rootDir, candidate)
    ) {
      continue;
    }
    const sourcePath = await realpath(candidate).catch(() => null);
    if (sourcePath === null || !isPathWithinDirectory(rootDir, sourcePath)) {
      continue;
    }
    const source = await readFile(sourcePath, "utf8").catch(() => null);
    if (source !== null) return { path: sourcePath, source };
  }
  return null;
}
