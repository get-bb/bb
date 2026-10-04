import type { PluginRowPresentation } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const TOOL_NAME = "bb_thread_message";

export const toolParameters = z.object({
  threadId: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .describe("ID of the thread to message, such as thr_abc123."),
  message: z.string().trim().min(1).describe("The message, in Markdown."),
});

export type ToolInput = z.infer<typeof toolParameters>;

export const TOOL_DESCRIPTION =
  "Send a message to the agent working in another bb thread. It arrives there as a message from this thread, and that agent can answer with this same tool. The user never receives it; address the user in your normal response.";

export const TOOL_INSTRUCTIONS = `Messages from other agents begin with \`[bb message from thread:<thread id>]\`. Answer the agent with \`${TOOL_NAME}\` and the user in your normal response, or do both. You may answer a thread that messaged you even if the user did not ask, but message other threads only when the user asks, and do not reply to messages that need no answer. Prefer \`${TOOL_NAME}\` to \`bb thread tell\`: only the tool shows the message in this thread. Use \`bb thread tell\` only when you need its \`--mode queue\`, \`--send-at\`, \`--plan\`, or attachment options. The timeline already shows every message you send and receive, so do not announce or restate them.`;

export const TOOL_PRESENTATION: PluginRowPresentation = {
  label: { pending: "Messaging a thread", completed: "Messaged a thread" },
  icon: { glyph: "Sent" },
};
