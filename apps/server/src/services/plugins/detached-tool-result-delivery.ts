import { getThread } from "@bb/db";
import type {
  PromptInput,
  SystemMessageSubject,
  ToolCallResponse,
} from "@bb/domain";
import type { PluginRowPresentation } from "@get-bb/plugin-sdk";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { queueParentSystemMessage } from "../threads/parent-system-messages.js";

interface DeliverDetachedToolResultArgs {
  threadId: string;
  toolName: string;
  presentation: PluginRowPresentation | null;
  response: ToolCallResponse;
}

function buildDetachedToolResultInput(args: {
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

function buildDetachedToolResultSubject(args: {
  toolName: string;
  presentation: PluginRowPresentation | null;
}): SystemMessageSubject {
  return {
    kind: "tool-call",
    toolName: args.toolName,
    suppress: args.presentation?.suppress ?? false,
  };
}

export async function deliverDetachedToolResult(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: DeliverDetachedToolResultArgs,
): Promise<void> {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.deletedAt !== null || thread.archivedAt !== null) {
    return;
  }
  if (!args.response.success && thread.status !== "active") {
    return;
  }
  await queueParentSystemMessage(deps, {
    input: buildDetachedToolResultInput({
      toolName: args.toolName,
      response: args.response,
    }),
    parentThreadId: thread.id,
    systemMessageKind: "tool-result-delivered",
    systemMessageSubject: buildDetachedToolResultSubject({
      toolName: args.toolName,
      presentation: args.presentation,
    }),
  });
}
