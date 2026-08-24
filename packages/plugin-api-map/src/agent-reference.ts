import { SURFACES_BY_ID, type PluginSurface } from "./surfaces";

/** Stable mention-provider identity owned by the Plugin Guide plugin. */
export const PLUGIN_GUIDE_SURFACE_PROVIDER_ID = "surface";

/** The app-side input for one structured Plugin Guide surface reference. */
export interface PluginSurfaceAgentMention {
  provider: typeof PLUGIN_GUIDE_SURFACE_PROVIDER_ID;
  id: string;
  label: string;
}

export function pluginSurfaceAgentMention(
  surface: PluginSurface,
): PluginSurfaceAgentMention {
  return {
    provider: PLUGIN_GUIDE_SURFACE_PROVIDER_ID,
    id: surface.id,
    label: surface.title,
  };
}

/**
 * Resolve a stable surface id into only the pointers an agent needs. The
 * installed authoring skill owns workflow guidance; references stay compact
 * and composable instead of embedding a tutorial per pill.
 */
export function pluginSurfaceAgentContext(surfaceId: string): string | null {
  const surface = SURFACES_BY_ID.get(surfaceId);
  if (!surface) return null;
  return [
    `bb Plugin Guide surface: ${surface.title} (${surface.id}).`,
    `Relevant @get-bb/plugin-sdk symbols: ${surface.apiSymbols.join(", ")}.`,
    "Use the bb-plugin-authoring skill and the authoritative @get-bb/plugin-sdk declarations to build a similar plugin capability.",
  ].join("\n");
}
