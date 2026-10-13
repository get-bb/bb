import { experimental_copyToClipboard } from "@get-bb/plugin-sdk/app";
import { escapeHtmlText } from "./html-escape";
import { SURFACES_BY_ID, type PluginSurface } from "./surfaces";

export const PLUGIN_GUIDE_PLUGIN_ID = "plugin-api-docs";

export const PLUGIN_GUIDE_SURFACE_PROVIDER_ID = "surface";

export interface PluginSurfaceAgentMention {
  provider: typeof PLUGIN_GUIDE_SURFACE_PROVIDER_ID;
  id: string;
  label: string;
}

export interface PluginSurfaceAgentClipboardContent {
  text: string;
  html: string;
}

export interface PluginSurfaceAgentResource {
  kind: "plugin";
  pluginId: typeof PLUGIN_GUIDE_PLUGIN_ID;
  icon: null;
  itemId: string;
  label: string;
}

export interface PluginSurfaceAgentReference {
  identity: PluginSurfaceAgentMention;
  resource: PluginSurfaceAgentResource;
  clipboard: PluginSurfaceAgentClipboardContent;
  context: string;
}

const AGENT_REFERENCE_PREFIX = "Build a plugin that uses ";
const AGENT_REFERENCE_SUFFIX = " ";

export function createPluginSurfaceAgentReference(
  surface: PluginSurface,
): PluginSurfaceAgentReference {
  const identity: PluginSurfaceAgentMention = {
    provider: PLUGIN_GUIDE_SURFACE_PROVIDER_ID,
    id: surface.id,
    label: surface.title,
  };
  const serializedText = `@${identity.label}`;
  const resource: PluginSurfaceAgentResource = {
    kind: "plugin",
    pluginId: PLUGIN_GUIDE_PLUGIN_ID,
    icon: null,
    itemId: `${identity.provider}:${identity.id}`,
    label: identity.label,
  };
  const clipboard = {
    text: `${AGENT_REFERENCE_PREFIX}${serializedText}${AGENT_REFERENCE_SUFFIX}`,
    html: `${escapeHtmlText(AGENT_REFERENCE_PREFIX)}<span data-prompt-mention="true" data-prompt-mention-resource="${escapeHtmlText(JSON.stringify(resource))}" data-prompt-mention-serialized-text="${escapeHtmlText(serializedText)}">${escapeHtmlText(serializedText)}</span>${escapeHtmlText(AGENT_REFERENCE_SUFFIX)}`,
  };
  const context = [
    `Plugin Guide surface: ${surface.title} (${surface.id}).`,
    `Relevant @get-bb/plugin-sdk symbols: ${surface.apiSymbols.join(", ")}.`,
    "Use the bb-plugin-authoring skill and the authoritative @get-bb/plugin-sdk declarations to build a similar plugin capability.",
  ].join("\n");
  return { identity, resource, clipboard, context };
}

export function pluginSurfaceAgentClipboardContent(
  surface: PluginSurface,
): PluginSurfaceAgentClipboardContent {
  return createPluginSurfaceAgentReference(surface).clipboard;
}

export function copyPluginSurfaceAgentReference(
  surface: PluginSurface,
): Promise<boolean> {
  return experimental_copyToClipboard(
    pluginSurfaceAgentClipboardContent(surface),
  );
}

export function pluginSurfaceAgentContext(surfaceId: string): string | null {
  const surface = SURFACES_BY_ID.get(surfaceId);
  if (!surface) return null;
  return createPluginSurfaceAgentReference(surface).context;
}
