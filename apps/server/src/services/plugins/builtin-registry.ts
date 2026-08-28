import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface BundledPluginDefinition {
  name: string;
  pluginId: string;
  autoInstall: boolean;
  defaultEnabled: boolean;
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
    name: "plugin-api-tester",
    pluginId: "plugin-api-tester",
    defaultEnabled: false,
    category: "Developer tools",
  },
  {
    name: "inline-vis",
    pluginId: "inline-vis",
    defaultEnabled: true,
    category: "Interface",
  },
  {
    name: "monaco-editor",
    pluginId: "monaco-editor",
    defaultEnabled: false,
    category: "Interface",
  },
  {
    name: "pdf-preview",
    pluginId: "pdf-preview",
    defaultEnabled: true,
    category: "Interface",
  },
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
    name: "plugin-api-docs",
    pluginId: "plugin-api-docs",
    defaultEnabled: false,
    category: "Developer tools",
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
].map((plugin): BundledPluginDefinition => ({
  ...plugin,
  autoInstall: true,
}));

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
].map((plugin): BundledPluginDefinition => ({
  ...plugin,
  autoInstall: false,
}));

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

export function resolveBuiltinPluginRootPathForModuleDir(
  args: ResolveBuiltinPluginRootPathArgs,
): string {
  const packagedCandidate = path.resolve(
    args.moduleDir,
    BUILTIN_PLUGINS_DIRECTORY_NAME,
    args.name,
  );
  if (existsSync(packagedCandidate)) return packagedCandidate;

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
