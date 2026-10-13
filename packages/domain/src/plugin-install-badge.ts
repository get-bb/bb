export const PLUGIN_INSTALL_COUNT_DISPLAY_MINIMUM = 25;

export const PLUGIN_NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type PluginInstallBadge =
  | { kind: "builtin" }
  | { kind: "new" }
  | { kind: "count"; installs: number };

export function pluginInstallBadge(
  plugin: {
    installs: number | null;
    installedByDefault: boolean;
    publishedAt?: string;
  },
  now: number,
): PluginInstallBadge | null {
  if (plugin.installedByDefault) return { kind: "builtin" };
  const { installs } = plugin;
  if (installs !== null && installs >= PLUGIN_INSTALL_COUNT_DISPLAY_MINIMUM) {
    return { kind: "count", installs };
  }
  const publishedAt =
    plugin.publishedAt === undefined ? NaN : Date.parse(plugin.publishedAt);
  if (now - publishedAt < PLUGIN_NEW_WINDOW_MS) return { kind: "new" };
  return installs === null ? null : { kind: "count", installs };
}
