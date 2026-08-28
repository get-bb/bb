import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { jsonObjectSchema, type JsonObject, type JsonValue } from "@bb/domain";
import { isRecord } from "./plugin-manifest.js";

export const PLUGIN_SDK_PACKAGE_NAME = "@get-bb/plugin-sdk";

type PluginExportTarget = string | JsonObject;

function isPluginExportObject(value: PluginExportTarget): value is JsonObject {
  return isRecord(value);
}

function parsePluginExportTarget(
  value: JsonValue | undefined,
): PluginExportTarget | null {
  if (value === undefined || value === null || Array.isArray(value)) {
    return null;
  }
  if (isRecord(value)) {
    const parsedObject = jsonObjectSchema.safeParse(value);
    if (!parsedObject.success) return null;
    return parsedObject.data;
  }
  const text = String(value);
  return text === value ? text : null;
}

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
  const parsedExports = jsonObjectSchema.safeParse(json.exports);
  if (!parsedExports.success) return null;
  let target = parsePluginExportTarget(parsedExports.data[subpath]);
  if (target === null) return null;
  while (isPluginExportObject(target)) {
    target = parsePluginExportTarget(
      target.import ?? target.node ?? target.default ?? target.require,
    );
    if (target === null) return null;
  }
  return target;
}
