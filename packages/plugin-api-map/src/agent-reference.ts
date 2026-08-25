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
  return {
    provider: PLUGIN_GUIDE_SURFACE_PROVIDER_ID,
    id: surface.id,
    label: surface.title,
  };
}

export interface PluginSurfaceAgentClipboardContent {
  /** Plain fallback for pasting outside bb. */
  text: string;
  /** bb's existing structured mention markup, consumed by composer paste. */
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Serialize one Guide surface with bb's existing composer-pill clipboard
 * contract. This is private first-party integration, not a Plugin SDK API.
 */
export function pluginSurfaceAgentClipboardContent(
  surface: PluginSurface,
): PluginSurfaceAgentClipboardContent {
  const mention = pluginSurfaceAgentMention(surface);
  const serializedText = `@${mention.label}`;
  const resource = {
    kind: "plugin",
    pluginId: PLUGIN_GUIDE_PLUGIN_ID,
    icon: null,
    itemId: `${mention.provider}:${mention.id}`,
    label: mention.label,
  };
  return {
    text: `${serializedText} `,
    html: `<span data-prompt-mention="true" data-prompt-mention-resource="${escapeHtml(JSON.stringify(resource))}" data-prompt-mention-serialized-text="${escapeHtml(serializedText)}">${escapeHtml(serializedText)}</span> `,
  };
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
  return [
    `bb Plugin Guide surface: ${surface.title} (${surface.id}).`,
    `Relevant @get-bb/plugin-sdk symbols: ${surface.apiSymbols.join(", ")}.`,
    "Use the bb-plugin-authoring skill and the authoritative @get-bb/plugin-sdk declarations to build a similar plugin capability.",
  ].join("\n");
}
