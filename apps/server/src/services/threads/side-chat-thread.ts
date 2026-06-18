import type { Thread } from "@bb/domain";

export function isSideChatThread(thread: Thread): boolean {
  return (thread.originKind ?? thread.childOrigin) === "side-chat";
}
