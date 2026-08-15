/**
 * Side chats are hidden forks owned by the builtin side-chat plugin. Steering
 * privacy and title suppression use that canonical shape.
 */

/** pluginId of the builtin side-chat plugin (bb's builtin registry). */
const SIDE_CHAT_PLUGIN_ID = "side-chat";

export interface SideChatShapeThread {
  originKind: string | null;
  originPluginId: string | null;
  visibility: string;
}

export function isSideChatShapedThread(thread: SideChatShapeThread): boolean {
  return (
    thread.originKind === "fork" &&
    thread.originPluginId === SIDE_CHAT_PLUGIN_ID &&
    thread.visibility === "hidden"
  );
}
