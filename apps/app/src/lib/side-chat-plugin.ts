import type { SenderThreadMetadata } from "@/hooks/useSenderThreadMetadataById";

/**
 * Id of the builtin side-chat plugin (plugins/side-chat), the plugin-owned
 * replacement for the native side chat behind the `sideChatPlugin`
 * experiment. Mirrors the pluginId in the server's builtin registry.
 */
export const SIDE_CHAT_PLUGIN_ID = "side-chat";

/** The side-chat plugin's `threadPanelAction` id its panel tabs open under. */
export const SIDE_CHAT_PLUGIN_PANEL_ACTION_ID = "side-chat";

/**
 * Whether the NATIVE side-chat creation entry points (per-message action,
 * selection-menu action, new-tab launcher) are available. The `sideChatPlugin`
 * experiment hands side chats to the builtin plugin, so every native creation
 * entry point goes inert while it is on; existing legacy side-chat tabs stay
 * openable through the deck either way.
 */
export function canStartNativeSideChat(args: {
  canSpawnChild: boolean;
  sideChatPluginEnabled: boolean;
}): boolean {
  return args.canSpawnChild && !args.sideChatPluginEnabled;
}

/**
 * Whether a sender thread is one of the side-chat plugin's hidden forks — the
 * plugin-era equivalent of `childOrigin === "side-chat"`. Promoted ("Open as
 * full thread") forks become visible and fall back to the normal named-thread
 * affordance.
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
