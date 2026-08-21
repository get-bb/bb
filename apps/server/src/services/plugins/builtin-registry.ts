import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BundledPluginDefinition {
  /**
   * Directory name under `plugins/` and under the packaged builtin-plugins
   * dir; also the `builtin:<name>` source name.
   */
  name: string;
  /** derivePluginId(packageName); declared statically so ids are reservable without manifest reads. */
  pluginId: string;
  /** true = reconcile installs when missing; false = store-only, installed on demand. */
  autoInstall: boolean;
  /** enabled value on first install (auto or store). */
  defaultEnabled: boolean;
  /** Browse-tab grouping; only meaningful for store entries. */
  category?: string;
}

export interface BundledPluginRegistration extends BundledPluginDefinition {
  rootDir: string;
}

interface ResolveBuiltinPluginRootPathArgs {
  moduleDir: string;
  name: string;
}

export const BUILTIN_PLUGINS_DIRECTORY_NAME = "builtin-plugins";

/** Every bundled plugin's source lives under `<repoRoot>/plugins/<name>`. */
const REPO_PLUGINS_DIRECTORY_NAME = "plugins";

export const PLUGIN_CATALOG_CATEGORIES = [
  "Workflow management",
  "Agent interaction",
  "Context & knowledge",
  "Developer tools",
  "Host access",
  "Interface",
] as const;

export const BUILTIN_PLUGINS = [
  {
    name: "ask-user-question",
    pluginId: "ask-user-question",
    defaultEnabled: false,
    category: "Agent interaction",
  },
  {
    name: "automations",
    pluginId: "automations",
    defaultEnabled: true,
    category: "Workflow management",
  },
  {
    name: "connect",
    pluginId: "connect",
    defaultEnabled: true,
    category: "Host access",
  },
  {
    name: "custom-instructions",
    pluginId: "custom-instructions",
    defaultEnabled: true,
    category: "Context & knowledge",
  },
  {
    name: "inline-vis",
    pluginId: "inline-vis",
    defaultEnabled: true,
    category: "Interface",
  },
  {
    name: "pdf-preview",
    pluginId: "pdf-preview",
    defaultEnabled: true,
    category: "Interface",
  },
  // First-party agent provider plugins: each declares one of the providers
  // the core catalog used to seed. With the seed deleted these declarations
  // are the only source, so disabling one removes its provider. Their order
  // here IS the install order — the provider picker's default order and the
  // initial default provider come from it (bundled plugins rank first, in
  // this order; every other plugin ranks by install time).
  {
    name: "provider-codex",
    pluginId: "provider-codex",
    defaultEnabled: true,
    category: "Agent interaction",
  },
  {
    name: "provider-claude-code",
    pluginId: "provider-claude-code",
    defaultEnabled: true,
    category: "Agent interaction",
  },
  {
    name: "provider-pi",
    pluginId: "provider-pi",
    defaultEnabled: true,
    category: "Agent interaction",
  },
  {
    name: "provider-acp",
    pluginId: "provider-acp",
    defaultEnabled: true,
    category: "Agent interaction",
  },
  {
    name: "keep-awake",
    pluginId: "keep-awake",
    defaultEnabled: true,
    category: "Host access",
  },
  {
    name: "provider-retry",
    pluginId: "provider-retry",
    defaultEnabled: true,
    category: "Agent interaction",
  },
  {
    name: "secrets",
    pluginId: "secrets",
    defaultEnabled: true,
    category: "Developer tools",
  },
  {
    name: "side-chat",
    pluginId: "side-chat",
    defaultEnabled: true,
    category: "Agent interaction",
  },
  {
    name: "workflows",
    pluginId: "workflows",
    defaultEnabled: false,
    category: "Workflow management",
  },
].map(
  (plugin): BundledPluginDefinition => ({
    ...plugin,
    autoInstall: true,
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
    category: "Context & knowledge",
  },
  {
    name: "memory",
    pluginId: "memory",
    defaultEnabled: true,
    category: "Context & knowledge",
  },
  {
    name: "tasks",
    pluginId: "tasks",
    defaultEnabled: true,
    category: "Workflow management",
  },
].map(
  (plugin): BundledPluginDefinition => ({
    ...plugin,
    autoInstall: false,
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

/**
 * Bundled plugin roots live in three layouts:
 * - packaged server: <server dist>/builtin-plugins/<name> (written at packaging)
 * - built-from-source server (bundle at apps/server/dist): <repoRoot>/plugins/<name>
 * - source checkout (module at apps/server/src/services/plugins): <repoRoot>/plugins/<name>
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

  // apps/server/dist → repo root is three levels up.
  const builtCheckoutCandidate = path.resolve(
    args.moduleDir,
    "../../..",
    REPO_PLUGINS_DIRECTORY_NAME,
    args.name,
  );
  if (existsSync(builtCheckoutCandidate)) return builtCheckoutCandidate;

  return path.resolve(
    args.moduleDir,
    "../../../../..",
    REPO_PLUGINS_DIRECTORY_NAME,
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
