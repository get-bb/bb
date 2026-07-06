import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BuiltinPluginRegistration {
  name: string;
  rootDir: string;
}

interface ResolveBuiltinPluginRootPathArgs {
  moduleDir: string;
  name: string;
}

export const BUILTIN_PLUGINS_DIRECTORY_NAME = "builtin-plugins";
export const BUILTIN_PLUGIN_NAMES = ["automations"] as const satisfies readonly string[];

const builtinPluginsModuleDir = path.dirname(fileURLToPath(import.meta.url));

export function builtinPluginSource(name: string): string {
  return `builtin:${name}`;
}

/**
 * Builtin plugin roots live in two layouts:
 * - source checkout: <repoRoot>/plugins/<name>
 * - packaged server: <server dist>/builtin-plugins/<name>
 */
export function resolveBuiltinPluginRootPathForModuleDir(
  args: ResolveBuiltinPluginRootPathArgs,
): string {
  const packagedCandidate = path.resolve(
    args.moduleDir,
    BUILTIN_PLUGINS_DIRECTORY_NAME,
    args.name,
  );
  if (existsSync(packagedCandidate)) return packagedCandidate;

  return path.resolve(args.moduleDir, "../../../../..", "plugins", args.name);
}

export function resolveBuiltinPluginRootPath(name: string): string {
  return resolveBuiltinPluginRootPathForModuleDir({
    moduleDir: builtinPluginsModuleDir,
    name,
  });
}

export function listBuiltinPluginRegistrations(): BuiltinPluginRegistration[] {
  return BUILTIN_PLUGIN_NAMES.map((name) => ({
    name,
    rootDir: resolveBuiltinPluginRootPath(name),
  }));
}
