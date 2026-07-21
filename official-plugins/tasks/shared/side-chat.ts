/**
 * During the BB-70 coexistence window a side chat has one of two shapes:
 * a legacy `originKind`/`childOrigin: "side-chat"` thread, or the builtin
 * side-chat plugin's hidden fork (`originKind: "fork"` + `originPluginId:
 * "side-chat"` + `visibility: "hidden"`). Steering privacy and title
 * suppression must treat both the same.
 */

/** pluginId of the builtin side-chat plugin (bb's builtin registry). */
const SIDE_CHAT_PLUGIN_ID = "side-chat";

export interface SideChatShapeThread {
  originKind: string | null;
  /** @deprecated legacy field mirrored by originKind. */
  childOrigin: string | null;
  originPluginId: string | null;
  visibility: string;
}

export function isSideChatShapedThread(thread: SideChatShapeThread): boolean {
  return (
    thread.originKind === "side-chat" ||
    thread.childOrigin === "side-chat" ||
    (thread.originKind === "fork" &&
      thread.originPluginId === SIDE_CHAT_PLUGIN_ID &&
      thread.visibility === "hidden")
  );
}
