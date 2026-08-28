declare const __BB_PLUGIN_ID__: string | undefined;

interface PortalScopeProps {
  "data-bb-portaled-overlay": "";
  "data-bb-plugin-root"?: "";
  "data-bb-plugin"?: string;
}

function readPluginId(): string | undefined {
  try {
    return __BB_PLUGIN_ID__;
  } catch {
    return undefined;
  }
}

export function usePortalScopeProps(): PortalScopeProps {
  const props: PortalScopeProps = {
    "data-bb-portaled-overlay": "",
    "data-bb-plugin-root": "",
  };
  const pluginId = readPluginId();
  if (pluginId !== undefined) props["data-bb-plugin"] = pluginId;
  return props;
}
