import {
  getLatestCompletedThreadContextClearSequence,
  listStoredEventRows,
} from "@bb/db";
import { THREAD_CONTEXT_CLEAR_OPERATION, type PromptInput } from "@bb/domain";
import { z } from "zod";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { parseStoredEvent } from "./thread-data.js";

const switchMetadataSchema = z.object({
  visibleHistoryStartSequence: z.number().int().nonnegative(),
  providerSwitch: z.object({
    fromProviderId: z.string(),
    fromModel: z.string(),
    toProviderId: z.string(),
    toModel: z.string(),
  }),
});

export function providerHandoffContextInput(
  deps: Pick<LoggedWorkSessionDeps, "db">,
  args: { threadId: string; providerId: string },
): PromptInput[] {
  const clearSequence = getLatestCompletedThreadContextClearSequence(deps.db, {
    threadId: args.threadId,
  });
  if (clearSequence === null) return [];
  const [clearRow] = listStoredEventRows(deps.db, {
    threadId: args.threadId,
    afterSequence: clearSequence - 1,
    types: ["system/operation"],
    limit: 1,
  });
  if (!clearRow) return [];
  const clearEvent = parseStoredEvent(clearRow);
  if (
    clearEvent.type !== "system/operation" ||
    clearEvent.operation !== THREAD_CONTEXT_CLEAR_OPERATION
  ) {
    return [];
  }
  const metadata = switchMetadataSchema.safeParse(clearEvent.metadata);
  if (
    !metadata.success ||
    metadata.data.providerSwitch.toProviderId !== args.providerId
  ) {
    return [];
  }

  const rows = listStoredEventRows(deps.db, {
    threadId: args.threadId,
    afterSequence: metadata.data.visibleHistoryStartSequence - 1,
    beforeSequence: clearSequence,
    types: ["client/turn/requested", "item/completed"],
    order: "desc",
    limit: 2000,
  }).reverse();
  const messages: string[] = [];
  for (const row of rows) {
    if (row.type === "item/completed" && row.itemKind !== "agentMessage") {
      continue;
    }
    const event = parseStoredEvent(row);
    if (event.type === "client/turn/requested") {
      if (event.initiator !== "user" || event.retryOfRequestId) continue;
      const text = event.input
        .filter((input) => input.visibility !== "agent-only")
        .map((input) =>
          input.type === "text"
            ? input.text
            : input.type === "image" || input.type === "localImage"
              ? "[image]"
              : `[file: ${input.name ?? input.path}]`,
        )
        .join("\n")
        .trim();
      if (text) messages.push(`User: ${text}`);
    } else if (
      event.type === "item/completed" &&
      event.item.type === "agentMessage" &&
      !event.item.parentToolCallId &&
      event.item.text.trim()
    ) {
      messages.push(`Assistant: ${event.item.text.trim()}`);
    }
  }
  const selected: string[] = [];
  let remaining = 60000;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.length > remaining) break;
    selected.unshift(message);
    remaining -= message.length + 2;
  }
  const omitted = selected.length < messages.length;
  const history = selected.join("\n\n");
  const text = [
    `You are continuing the same BB chat after its provider changed from ${metadata.data.providerSwitch.fromProviderId} (${metadata.data.providerSwitch.fromModel}) to ${metadata.data.providerSwitch.toProviderId} (${metadata.data.providerSwitch.toModel}).`,
    "Treat the conversation below as prior context, then respond to the new user message. Do not repeat this context in your reply.",
    omitted
      ? `Earlier messages are omitted here. Read the chat history with bb thread log ${args.threadId} if needed.`
      : "",
    history,
  ]
    .filter(Boolean)
    .join("\n\n");
  return [{ type: "text", text, mentions: [], visibility: "agent-only" }];
}
