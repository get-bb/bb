import { z } from "zod";
import type { DynamicTool, Thread } from "@bb/domain";

export const SIDE_CHAT_SEND_TO_MAIN_THREAD_TOOL_NAME = "bb_send_to_main_thread";

export const sideChatSendToMainThreadToolArgumentsSchema = z
  .object({
    message: z
      .string()
      .min(1)
      .refine((message) => message.trim().length > 0),
  })
  .strict();

const SIDE_CHAT_SEND_TO_MAIN_THREAD_TOOL: DynamicTool = {
  name: SIDE_CHAT_SEND_TO_MAIN_THREAD_TOOL_NAME,
  description:
    "Send a message from this side chat to the main thread. Use this when the user asks you to send, share, post, or relay something to the main chat/thread. The message appears in the main thread as coming from this side chat.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The exact message to send to the main thread.",
      },
    },
    required: ["message"],
    additionalProperties: false,
  },
};

export function isSideChatThread(thread: Thread): boolean {
  return (thread.originKind ?? thread.childOrigin) === "side-chat";
}

export function buildSideChatDynamicTools(thread: Thread): DynamicTool[] {
  if (!isSideChatThread(thread) || thread.sourceThreadId === null) {
    return [];
  }

  return [SIDE_CHAT_SEND_TO_MAIN_THREAD_TOOL];
}
