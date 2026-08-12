/**
 * Portaled content leaves the plugin mount. These attributes restore the
 * plugin style scope and mark the content as an interactive overlay.
 */
declare const __BB_PLUGIN_ID__: string | undefined;

export function usePortalScopeProps(): {
  "data-bb-portaled-overlay": "";
  "data-bb-plugin-root": "";
  "data-bb-plugin"?: string;
} {
  const pluginId =
    typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : undefined;
  return {
    "data-bb-portaled-overlay": "",
    "data-bb-plugin-root": "",
    ...(pluginId === undefined ? {} : { "data-bb-plugin": pluginId }),
  };
}
