import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";

/**
 * Id of the builtin side-chat plugin (plugins/side-chat), which owns every
 * side chat. Mirrors the pluginId in the server's builtin registry.
 */
export const SIDE_CHAT_PLUGIN_ID = "side-chat";

/** The side-chat plugin's `threadPanelAction` id its panel tabs open under. */
export const SIDE_CHAT_PLUGIN_PANEL_ACTION_ID = "side-chat";

/**
 * Whether a sender thread is one of the side-chat plugin's hidden forks.
 * Promoted ("Open as full thread") forks become visible and fall back to the
 * normal named-thread affordance.
 */
export function isPluginSideChatSenderThread(
  metadata: SenderThreadMetadata | null,
): boolean {
  return (
    metadata !== null &&
    metadata.originKind === "fork" &&
    metadata.originPluginId === SIDE_CHAT_PLUGIN_ID &&
    metadata.visibility === "hidden"
  );
}
