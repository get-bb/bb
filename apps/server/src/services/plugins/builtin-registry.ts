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
    name: "provider-retry",
    pluginId: "provider-retry",
    defaultEnabled: false,
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

/**
 * An official catalog entry that installs from an external git repository
 * instead of a bundled copy. There is no local rootDir to read a manifest
 * from, so display metadata and engine ranges are declared statically.
 */
export interface GitOfficialPluginDefinition {
  /** Catalog entry id; installs stamp `{kind:"catalog", entryId: name}`. */
  name: string;
  /** derivePluginId(packageName) of the plugin at the git source. */
  pluginId: string;
  /** Browse-tab grouping; one of {@link PLUGIN_CATALOG_CATEGORIES}. */
  category: string;
  /** Full install source, `git:<url>@<ref>`. */
  gitSource: string;
  displayName: string;
  description: string;
  /** Declared icon name (the plugin's `bb.branding.icon`). */
  icon: string;
  /** `engines.bb` range mirrored from the plugin's package.json. */
  bbEngineRange: string;
  /** `engines.bbPluginSdk` range mirrored from the plugin's package.json. */
  bbPluginSdkRange: string;
}

/**
 * Official plugins that live in github.com/brsbl/bb-plugins rather than this
 * repo. That repo is the source of truth: when a plugin's package.json changes
 * (bb.name, bb.description, bb.branding.icon, engines), mirror the new values
 * here — the store renders these static fields, not the remote manifest.
 * Install refs are the repo's published per-plugin branches.
 */
export const GIT_OFFICIAL_PLUGINS: readonly GitOfficialPluginDefinition[] = [
  {
    name: "thread-hover-cards",
    pluginId: "thread-hover-cards",
    category: "Interface",
    gitSource:
      // Pinned to a reviewed commit of bb-plugins plugin/thread-hover-cards.
      "git:https://github.com/brsbl/bb-plugins.git@30f91fd977ba1ce60532af27a68534464fb62516",
    displayName: "Thread Hover Cards",
    description:
      "Preview thread status, the latest agent update, and repository or PR context from the sidebar.",
    icon: "ZoomIn",
    bbEngineRange: ">=0.0.34",
    bbPluginSdkRange: "^0.5.0",
  },
  {
    name: "improve-prompt",
    pluginId: "prompt-shaper",
    category: "Agent interaction",
    gitSource:
      // Pinned to a reviewed commit of bb-plugins plugin/improve-prompt.
      "git:https://github.com/brsbl/bb-plugins.git@1c6bb2e8ad3551466981e7eb027cc4b1f3428cac",
    displayName: "Prompt Improver",
    description:
      "Adds an Improve prompt action to the composer that sends your rough draft to a hidden helper agent, which applies the prompt-shaper skill to rewrite it into a clear, complete prompt and returns it in place for review before you send.",
    icon: "AiContentGenerator01",
    bbEngineRange: ">=0.0.34",
    bbPluginSdkRange: "^0.5.0",
  },
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
