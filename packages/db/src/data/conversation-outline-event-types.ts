import type { ThreadEventItemType, ThreadEventType } from "@bb/domain";

export const conversationOutlineLifecycleTypes = [
  "client/turn/requested",
  "turn/input/accepted",
  "turn/started",
  "turn/completed",
  "system/manager/user_message",
  "system/thread/interrupted",
  "system/error",
  "provider/error",
  "item/agentMessage/delta",
  "item/plan/delta",
] satisfies ThreadEventType[];
export const conversationOutlineItemKinds = [
  "agentMessage",
  "plan",
] satisfies ThreadEventItemType[];
export const conversationOutlineStructuralItemKinds = [
  "backgroundTask",
  "toolCall",
] satisfies ThreadEventItemType[];
export const conversationOutlineStructuralLifecycleTypes = [
  "item/started",
  "item/completed",
  "item/backgroundTask/progress",
  "item/backgroundTask/completed",
] satisfies ThreadEventType[];

const conversationOutlineEventTypes = new Set<ThreadEventType>([
  ...conversationOutlineLifecycleTypes,
  ...conversationOutlineStructuralLifecycleTypes,
]);

export function isConversationOutlineEventType(type: ThreadEventType): boolean {
  return conversationOutlineEventTypes.has(type);
}
