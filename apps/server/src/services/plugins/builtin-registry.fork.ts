export interface ForkBuiltinPluginDefinition {
  name: string;
  pluginId: string;
  defaultEnabled: boolean;
}

export const FORK_BUILTIN_PLUGINS: readonly ForkBuiltinPluginDefinition[] = [
  {
    name: "git-graph",
    pluginId: "git-graph",
    defaultEnabled: true,
  },
  {
    name: "pc-control",
    pluginId: "pc-control",
    defaultEnabled: true,
  },
  {
    name: "workspace-explorer",
    pluginId: "workspace-explorer",
    defaultEnabled: true,
  },
];
