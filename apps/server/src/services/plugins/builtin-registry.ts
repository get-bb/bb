import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BundledPluginDefinition {
  /**
   * Directory name under the repo directory and under the packaged
   * builtin-plugins dir; also the `builtin:<name>` source name.
   */
  name: string;
  /** derivePluginId(packageName); declared statically so ids are reservable without manifest reads. */
  pluginId: string;
  /** true = reconcile installs when missing; false = store-only, installed on demand. */
  autoInstall: boolean;
  /** enabled value on first install (auto or store). */
  defaultEnabled: boolean;
  /** Repo directory holding the plugin source in dev checkouts. */
  repoDirectory: "plugins" | "official-plugins";
  /** Browse-tab grouping; only meaningful for store entries. */
  category?: string;
}

export interface BundledPluginRegistration extends BundledPluginDefinition {
  rootDir: string;
}

interface ResolveBuiltinPluginRootPathArgs {
  moduleDir: string;
  name: string;
  repoDirectory?: "plugins" | "official-plugins";
}

export const BUILTIN_PLUGINS_DIRECTORY_NAME = "builtin-plugins";
export const BUILTIN_PLUGINS = [
  { name: "automations", pluginId: "automations", defaultEnabled: true },
  { name: "connect", pluginId: "connect", defaultEnabled: true },
  {
    name: "custom-instructions",
    pluginId: "custom-instructions",
    defaultEnabled: true,
  },
  { name: "inline-vis", pluginId: "inline-vis", defaultEnabled: true },
  { name: "secrets", pluginId: "secrets", defaultEnabled: true },
  { name: "workflows", pluginId: "workflows", defaultEnabled: false },
].map(
  (plugin): BundledPluginDefinition => ({
    ...plugin,
    autoInstall: true,
    repoDirectory: "plugins",
  }),
);

/**
 * Official plugins ship bundled with the app like builtins, but are not
 * auto-installed: they appear in the plugin store and install on demand.
 */
export const OFFICIAL_PLUGINS = [
  {
    name: "github",
    pluginId: "github",
    defaultEnabled: true,
    category: "Developer tools",
  },
  {
    name: "docs",
    pluginId: "simple-notes",
    defaultEnabled: true,
    category: "Productivity",
  },
  {
    name: "memory",
    pluginId: "memory",
    defaultEnabled: true,
    category: "Productivity",
  },
  {
    name: "tasks",
    pluginId: "tasks",
    defaultEnabled: true,
    category: "Productivity",
  },
].map(
  (plugin): BundledPluginDefinition => ({
    ...plugin,
    autoInstall: false,
    repoDirectory: "official-plugins",
  }),
);

export const BUNDLED_PLUGINS: readonly BundledPluginDefinition[] = [
  ...BUILTIN_PLUGINS,
  ...OFFICIAL_PLUGINS,
];

export const BUILTIN_PLUGIN_NAMES = BUILTIN_PLUGINS.map(
  (plugin) => plugin.name,
);

const builtinPluginsModuleDir = path.dirname(fileURLToPath(import.meta.url));

export function builtinPluginSource(name: string): string {
  return `builtin:${name}`;
}

export function findBundledPlugin(
  name: string,
): BundledPluginDefinition | undefined {
  return BUNDLED_PLUGINS.find((plugin) => plugin.name === name);
}

/**
 * Bundled plugin roots live in three layouts:
 * - packaged server: <server dist>/builtin-plugins/<name> (written at packaging)
 * - built-from-source server (bundle at apps/server/dist): <repoRoot>/<repoDirectory>/<name>
 * - source checkout (module at apps/server/src/services/plugins): <repoRoot>/<repoDirectory>/<name>
 */
export function resolveBuiltinPluginRootPathForModuleDir(
  args: ResolveBuiltinPluginRootPathArgs,
): string {
  const repoDirectory =
    args.repoDirectory ??
    findBundledPlugin(args.name)?.repoDirectory ??
    "plugins";
  const packagedCandidate = path.resolve(
    args.moduleDir,
    BUILTIN_PLUGINS_DIRECTORY_NAME,
    args.name,
  );
  if (existsSync(packagedCandidate)) return packagedCandidate;

  // apps/server/dist → repo root is three levels up.
  const builtCheckoutCandidate = path.resolve(
    args.moduleDir,
    "../../..",
    repoDirectory,
    args.name,
  );
  if (existsSync(builtCheckoutCandidate)) return builtCheckoutCandidate;

  return path.resolve(
    args.moduleDir,
    "../../../../..",
    repoDirectory,
    args.name,
  );
}

export function resolveBuiltinPluginRootPath(name: string): string {
  return resolveBuiltinPluginRootPathForModuleDir({
    moduleDir: builtinPluginsModuleDir,
    name,
  });
}

export function listBundledPluginRegistrations(): BundledPluginRegistration[] {
  return BUNDLED_PLUGINS.map((plugin) => ({
    ...plugin,
    rootDir: resolveBuiltinPluginRootPath(plugin.name),
  }));
}
