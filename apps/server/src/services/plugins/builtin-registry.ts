import { existsSync, readFileSync } from "node:fs";
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

/**
 * Work Together cell profile. Stock bb enables connect / automations /
 * secrets / side-chat and leaves ask-user-question / provider-retry off;
 * those defaults are wrong for isolated cells. Official store plugins stay
 * opt-in (`autoInstall: false`). `workflows` stays disabled.
 *
 * Changing `defaultEnabled` only affects first install. Existing cells are
 * one-shot reconciled in `reconcileBundled` for
 * `WORK_TOGETHER_BUILTIN_ENABLED_RECONCILE_NAMES`.
 */
export const BUILTIN_PLUGINS = [
  {
    name: "ask-user-question",
    pluginId: "ask-user-question",
    defaultEnabled: true,
    category: "Agent interaction",
  },
  {
    name: "automations",
    pluginId: "automations",
    defaultEnabled: false,
    category: "Workflow management",
  },
  {
    name: "connect",
    pluginId: "connect",
    defaultEnabled: false,
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
    name: "provider-retry",
    pluginId: "provider-retry",
    defaultEnabled: true,
    category: "Agent interaction",
  },
  {
    name: "secrets",
    pluginId: "secrets",
    defaultEnabled: false,
    category: "Developer tools",
  },
  {
    name: "side-chat",
    pluginId: "side-chat",
    defaultEnabled: false,
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
 * Named builtins whose `defaultEnabled` flipped for the Work Together
 * profile. Stock reconcile keeps `existing.enabled`, so those flips would
 * otherwise leave running cells on the old flags. `custom-instructions` and
 * `inline-vis` stay off this list: their defaults did not change, and
 * including them would only re-enable an operator who already turned them
 * off. Tombstoned or non-builtin rows are skipped; later operator changes
 * are not overwritten.
 */
export const WORK_TOGETHER_BUILTIN_ENABLED_RECONCILE_NAMES = [
  "ask-user-question",
  "automations",
  "connect",
  "provider-retry",
  "secrets",
  "side-chat",
] as const;

export const WORK_TOGETHER_BUILTIN_ENABLED_RECONCILE_ID =
  "work-together-builtin-defaults-v1" as const;

export function workTogetherBuiltinDefaultsMarkerPath(dataDir: string): string {
  return path.join(
    dataDir,
    "plugins",
    `.${WORK_TOGETHER_BUILTIN_ENABLED_RECONCILE_ID}`,
  );
}

/** True only when the marker file exists and contains the expected id. */
export function workTogetherBuiltinDefaultsMarkerApplied(
  dataDir: string,
): boolean {
  try {
    return readFileSync(
      workTogetherBuiltinDefaultsMarkerPath(dataDir),
      "utf8",
    ).includes(WORK_TOGETHER_BUILTIN_ENABLED_RECONCILE_ID);
  } catch {
    return false;
  }
}

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

export function findBundledPlugin(
  name: string,
): BundledPluginDefinition | undefined {
  return BUNDLED_PLUGINS.find((plugin) => plugin.name === name);
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
