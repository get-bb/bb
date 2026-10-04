import type {
  BbPluginApi,
  PluginAgentToolContext,
  PluginAgentToolResult,
} from "@get-bb/plugin-sdk";
import {
  TOOL_DESCRIPTION,
  TOOL_INSTRUCTIONS,
  TOOL_NAME,
  TOOL_PRESENTATION,
  toolParameters,
  type ToolInput,
} from "./tool-definition.js";

const PERMISSION_MODES = ["accept-edits", "auto", "full"];

function errorResult(text: string): PluginAgentToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

async function sendThreadMessage(
  bb: BbPluginApi,
  { threadId, message }: ToolInput,
  ctx: PluginAgentToolContext,
): Promise<PluginAgentToolResult> {
  if (threadId === ctx.threadId) {
    return errorResult(
      "That is your own thread. Address the user in your normal response instead.",
    );
  }
  try {
    const recipient = await bb.sdk.threads.get({ threadId });
    if (
      recipient.originPluginId === "side-chat" &&
      recipient.visibility === "hidden"
    ) {
      return errorResult(
        "That thread is a side chat; the user forwarded its message to you. Answer the user in your normal response instead.",
      );
    }
    const [sender, receiver] = await Promise.all([
      bb.sdk.threads.defaultExecutionOptions({ threadId: ctx.threadId }),
      bb.sdk.threads.defaultExecutionOptions({ threadId }),
    ]);
    if (
      sender === null ||
      receiver === null ||
      PERMISSION_MODES.indexOf(receiver.permissionMode) >
        PERMISSION_MODES.indexOf(sender.permissionMode)
    ) {
      return errorResult(
        "That thread runs with broader permissions than this one, so it can't take messages from here. Ask the user to relay the message instead.",
      );
    }
    const { delivery } = await bb.sdk.threads.send({
      threadId,
      input: [{ type: "text", text: message, mentions: [] }],
      mode: "steer-if-active",
      senderThreadId: ctx.threadId,
    });
    return delivery === "queued"
      ? `Queued for ${threadId}; it is delivered once that thread can take it.`
      : `Delivered to ${threadId}.`;
  } catch (error) {
    return errorResult(
      `The message was not delivered: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export default function plugin(bb: BbPluginApi) {
  bb.agents.registerTool({
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    instructions: TOOL_INSTRUCTIONS,
    presentation: TOOL_PRESENTATION,
    parameters: toolParameters,
    execute: (input, ctx) => sendThreadMessage(bb, input, ctx),
  });
}
