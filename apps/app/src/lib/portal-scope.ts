import { useContext } from "react";
import { PluginContext } from "@/components/plugin/plugin-context";

/**
 * Shared DOM attributes for portaled UI content. Overlay content (dialog,
 * select, popover, …) portals into document.body — outside every
 * `[data-bb-plugin-root]` mount — so a plugin's compiled stylesheet
 * (prefixed with `:where([data-bb-plugin="<id>"], …)`, see PluginSlotMount) would not
 * style it.
 * Spreading these props on the portaled element re-attaches the plugin scope
 * inside a plugin slot. Every portal also carries a stable overlay marker so
 * the desktop stylesheet can carve interactive portal content out of Electron
 * window-drag regions. This is native hit-test policy, not CSS pointer-event
 * suppression: visible overlay controls remain the actual pointer target.
 *
 * The registry-vendored copy of this file in a plugin returns the attribute
 * unconditionally (everything a plugin renders is plugin-scoped) — component
 * files stay byte-identical between the app and the component registry.
 */
export function usePortalScopeProps(): {
  "data-bb-portaled-overlay": "";
  "data-bb-plugin-root"?: "";
  "data-bb-plugin"?: string;
} {
  const pluginId = useContext(PluginContext);
  return pluginId === null
    ? { "data-bb-portaled-overlay": "" }
    : {
        "data-bb-portaled-overlay": "",
        "data-bb-plugin-root": "",
        "data-bb-plugin": pluginId,
      };
}
