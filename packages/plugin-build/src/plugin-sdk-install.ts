import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { isRecord } from "./plugin-manifest.js";

export const PLUGIN_SDK_PACKAGE_NAME = "@get-bb/plugin-sdk";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function installedPluginSdkDirectory(
  fromDir: string,
): Promise<string | null> {
  let directory = fromDir;
  while (true) {
    const candidate = join(directory, "node_modules", PLUGIN_SDK_PACKAGE_NAME);
    if (await pathExists(join(candidate, "package.json"))) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export async function installedPluginSdkExportTarget(
  packageDir: string,
  subpath: string,
): Promise<string | null> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  } catch {
    return null;
  }
  if (!isRecord(json) || !isRecord(json.exports)) return null;
  let target: unknown = json.exports[subpath];
  while (isRecord(target)) {
    target = target.import ?? target.node ?? target.default ?? target.require;
  }
  return typeof target === "string" ? target : null;
}

export async function describeUnresolvedSdkImport(args: {
  specifier: string;
  resolveDir: string;
  need: string;
  esbuildErrors: readonly { text: string }[];
}): Promise<string> {
  const packageDir = await installedPluginSdkDirectory(args.resolveDir);
  if (packageDir === null) {
    return `"${args.specifier}" is not installed for this plugin (no node_modules/${PLUGIN_SDK_PACKAGE_NAME}); ${args.need} the SDK as a dependency`;
  }
  const subpath = `.${args.specifier.slice(PLUGIN_SDK_PACKAGE_NAME.length)}`;
  const target = await installedPluginSdkExportTarget(packageDir, subpath);
  if (target === null) {
    return `"${args.specifier}" is not exported by the ${PLUGIN_SDK_PACKAGE_NAME} installed at ${packageDir}; ${args.need} an SDK version that ships it`;
  }
  const targetPath = resolve(packageDir, target);
  if (!(await pathExists(targetPath))) {
    return `"${args.specifier}" is installed for this plugin but its dist is not built: run the SDK build (${targetPath} is missing); ${args.need} the built SDK`;
  }
  return `"${args.specifier}" could not be resolved from ${packageDir}: ${args.esbuildErrors.map((error) => error.text).join("; ")}`;
}
