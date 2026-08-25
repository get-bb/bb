import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isRecord } from "./plugin-manifest.js";

/**
 * Where a plugin's own `@get-bb/plugin-sdk` install is, and what it ships.
 * Shared by the host and server builders: both bundle an SDK subpath
 * (`@get-bb/plugin-sdk/host`, `/provider-bridge/acp`, …) from the plugin's
 * installed SDK, and both name the real cause — no install, no such export,
 * unbuilt dist — when it cannot be resolved, instead of esbuild's
 * "Could not resolve" or "No matching export".
 */
export const PLUGIN_SDK_PACKAGE_NAME = "@get-bb/plugin-sdk";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The nearest `node_modules/@get-bb/plugin-sdk` above `fromDir`, if any. */
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

/**
 * The file the installed SDK's `exports[subpath]` (`"./host"`,
 * `"./provider-bridge/acp"`) names for an ESM import, or null when the
 * installed version does not export it.
 */
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
