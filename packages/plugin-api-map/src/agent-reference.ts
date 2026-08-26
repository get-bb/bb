import { SURFACES_BY_ID, type PluginSurface } from "./surfaces";

/** Stable plugin identity carried by every pasted Guide reference. */
export const PLUGIN_GUIDE_PLUGIN_ID = "plugin-api-docs";

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
  return createPluginSurfaceAgentReference(surface).identity;
}

export interface PluginSurfaceAgentClipboardContent {
  /** Plain fallback for pasting outside bb. */
  text: string;
  /** bb's existing structured mention markup, consumed by composer paste. */
  html: string;
}

export interface PluginSurfaceAgentResource {
  kind: "plugin";
  pluginId: typeof PLUGIN_GUIDE_PLUGIN_ID;
  icon: null;
  itemId: string;
  label: string;
}

/** One canonical object owns every representation of a Guide reference. */
export interface PluginSurfaceAgentReference {
  identity: PluginSurfaceAgentMention;
  resource: PluginSurfaceAgentResource;
  clipboard: PluginSurfaceAgentClipboardContent;
  context: string;
}

const AGENT_REFERENCE_PREFIX = "Build a plugin that uses ";
// A single space after the pill keeps consecutive pastes and follow-on
// typing from gluing to the label; no punctuation is added, so the pasted
// text carries exactly what the source content contains.
const AGENT_REFERENCE_SUFFIX = " ";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Derive identity, clipboard bytes, and send-time context from one canonical
 * surface record. No transient UI state, timestamps, prose bullets, or random
 * ids enter the result, so equal surface data produces equal output.
 */
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
    html: `${escapeHtml(AGENT_REFERENCE_PREFIX)}<span data-prompt-mention="true" data-prompt-mention-resource="${escapeHtml(JSON.stringify(resource))}" data-prompt-mention-serialized-text="${escapeHtml(serializedText)}">${escapeHtml(serializedText)}</span>${escapeHtml(AGENT_REFERENCE_SUFFIX)}`,
  };
  const context = [
    `Plugin Guide surface: ${surface.title} (${surface.id}).`,
    `Relevant @get-bb/plugin-sdk symbols: ${surface.apiSymbols.join(", ")}.`,
    "Use the bb-plugin-authoring skill and the authoritative @get-bb/plugin-sdk declarations to build a similar plugin capability.",
  ].join("\n");
  return { identity, resource, clipboard, context };
}

/**
 * Serialize one Guide surface with bb's existing composer-pill clipboard
 * contract. This is private first-party integration, not a Plugin SDK API.
 */
export function pluginSurfaceAgentClipboardContent(
  surface: PluginSurface,
): PluginSurfaceAgentClipboardContent {
  return createPluginSurfaceAgentReference(surface).clipboard;
}

function copyWithEditingCommand(
  content: PluginSurfaceAgentClipboardContent,
): boolean {
  if (
    typeof document === "undefined" ||
    document.body === null ||
    typeof document.execCommand !== "function"
  ) {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = content.text;
  textarea.readOnly = true;
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    height: "1px",
    opacity: "0",
    pointerEvents: "none",
    position: "fixed",
    width: "1px",
  });
  document.body.append(textarea);
  let richClipboardHandled = false;
  const onCopy = (event: ClipboardEvent) => {
    if (event.clipboardData === null) return;
    event.clipboardData.setData("text/plain", content.text);
    event.clipboardData.setData("text/html", content.html);
    event.preventDefault();
    richClipboardHandled = true;
  };
  document.addEventListener("copy", onCopy, { once: true });
  try {
    textarea.select();
    return document.execCommand("copy") && richClipboardHandled;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", onCopy);
    textarea.remove();
  }
}

/** Copy one surface as a real, composable bb composer pill. */
export async function copyPluginSurfaceAgentReference(
  surface: PluginSurface,
): Promise<boolean> {
  const content = pluginSurfaceAgentClipboardContent(surface);
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.write === "function" &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([content.text], { type: "text/plain" }),
          "text/html": new Blob([content.html], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch {
      // The synchronous copy-event path also works on insecure LAN origins.
    }
  }
  return copyWithEditingCommand(content);
}

/**
 * Resolve a stable surface id into only the pointers an agent needs. The
 * installed authoring skill owns workflow guidance; references stay compact
 * and composable instead of embedding a tutorial per pill.
 */
export function pluginSurfaceAgentContext(surfaceId: string): string | null {
  const surface = SURFACES_BY_ID.get(surfaceId);
  if (!surface) return null;
  return createPluginSurfaceAgentReference(surface).context;
}
