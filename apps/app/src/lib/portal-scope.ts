import { useContext } from "react";
import { PluginContext } from "@/components/plugin/plugin-context";

/**
 * Scope attributes for portaled UI content. Overlay content (dialog, select,
 * popover, …) portals into document.body — outside every
 * `[data-bb-plugin-root]` mount — so a plugin's compiled stylesheet
 * (`@scope ([data-bb-plugin-root])`, see PluginSlotMount) would not style it.
 * Spreading these props on the portaled element re-attaches the plugin scope
 * inside a plugin slot; in the host tree they are empty, so host portals stay
 * out of plugin scopes and plugin CSS cannot leak onto them.
 *
 * The registry-vendored copy of this file in a plugin returns the attribute
 * unconditionally (everything a plugin renders is plugin-scoped) — component
 * files stay byte-identical between the app and the component registry.
 */
export function usePortalScopeProps(): { "data-bb-plugin-root"?: "" } {
  const pluginId = useContext(PluginContext);
  return pluginId === null ? {} : { "data-bb-plugin-root": "" };
}
