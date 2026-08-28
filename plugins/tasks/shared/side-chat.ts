const SIDE_CHAT_PLUGIN_ID = "side-chat";

interface SideChatThread {
  originKind: string | null;
  originPluginId: string | null;
  visibility: string;
}

function isSideChatThread(thread: SideChatThread): boolean {
  return (
    thread.originKind === "fork" &&
    thread.originPluginId === SIDE_CHAT_PLUGIN_ID &&
    thread.visibility === "hidden"
  );
}

export { isSideChatThread as "isSideChatShapedThread" };
