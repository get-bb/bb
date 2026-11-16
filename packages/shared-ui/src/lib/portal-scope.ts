declare const __BB_PLUGIN_ID__: string | undefined;

export function usePortalScopeProps(): {
  "data-bb-portaled-overlay": "";
  "data-bb-plugin-root"?: "";
  "data-bb-plugin"?: string;
  [scope: `data-bb-plugin-scope-${string}`]: "";
} {
  const pluginId =
    typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : undefined;
  return {
    "data-bb-portaled-overlay": "",
    "data-bb-plugin-root": "",
    ...(pluginId !== undefined
      ? {
          "data-bb-plugin": pluginId,
          [`data-bb-plugin-scope-${pluginId}`]: "",
        }
      : {}),
  };
}
