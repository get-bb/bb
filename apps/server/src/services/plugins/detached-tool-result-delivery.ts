import { getThread } from "@bb/db";
import type {
  PromptInput,
  SystemMessageSubject,
  ToolCallResponse,
} from "@bb/domain";
import type { PluginAgentToolPresentation } from "@get-bb/plugin-sdk";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { queueParentSystemMessage } from "../threads/parent-system-messages.js";

export interface DeliverDetachedToolResultArgs {
  threadId: string;
  toolName: string;
  callId: string;
  presentation: PluginAgentToolPresentation | null;
  response: ToolCallResponse;
}

export function buildDetachedToolResultInput(args: {
  toolName: string;
  response: ToolCallResponse;
}): PromptInput[] {
  const lead = args.response.success
    ? `Your earlier ${args.toolName} tool call has finished. Its result:`
    : `Your earlier ${args.toolName} tool call failed:`;
  const text = args.response.contentItems
    .flatMap((item) => (item.type === "inputText" ? [item.text] : []))
    .join("\n");
  const images = args.response.contentItems.flatMap((item) =>
    item.type === "inputImage"
      ? [{ type: "image" as const, url: item.imageUrl }]
      : [],
  );
  return [
    {
      type: "text",
      text: text.length > 0 ? `${lead}\n\n${text}` : lead,
      mentions: [],
    },
    ...images,
  ];
}

export function buildDetachedToolResultSubject(args: {
  toolName: string;
  callId: string;
  presentation: PluginAgentToolPresentation | null;
}): SystemMessageSubject {
  return {
    kind: "tool-call",
    toolName: args.toolName,
    callId: args.callId,
    label: args.presentation?.label?.completed ?? `Ran ${args.toolName}`,
    suppress: args.presentation?.suppress ?? false,
  };
}

/**
 * Hands a plugin tool result to the agent after the tool call's round trip is
 * gone. A successful result steers a running turn or starts one on an idle
 * thread. A failed result only steers a running turn: a card the person
 * dismissed after the turn ended, or a tool that gave up, is not worth waking
 * the thread for.
 */
export async function deliverDetachedToolResult(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: DeliverDetachedToolResultArgs,
): Promise<boolean> {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.deletedAt !== null || thread.archivedAt !== null) {
    return false;
  }
  if (!args.response.success && thread.status !== "active") {
    return false;
  }
  return queueParentSystemMessage(deps, {
    input: buildDetachedToolResultInput({
      toolName: args.toolName,
      response: args.response,
    }),
    parentThreadId: thread.id,
    systemMessageKind: "tool-result-delivered",
    systemMessageSubject: buildDetachedToolResultSubject({
      toolName: args.toolName,
      callId: args.callId,
      presentation: args.presentation,
    }),
  });
}
