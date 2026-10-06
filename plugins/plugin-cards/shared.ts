export const TOOL_NAME = "show_plugin_card";
export const DIRECTIVE_ID = "plugin-card";
export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;

export function pluginCardDirective(pluginId: string): string {
  return `::${DIRECTIVE_ID}{id=${JSON.stringify(pluginId)}}`;
}
