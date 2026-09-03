import { z } from "zod";
import { codexSubAgentActivityItemSchema } from "./schemas.js";
import type { CodexSubAgentHistoryEntry } from "./translator.js";

const historyTurnSchema = z
  .object({
    id: z.string().min(1),
    items: z.array(z.unknown()).default([]),
  })
  .passthrough();

export const codexThreadIdentityResultSchema = z
  .object({
    thread: z
      .object({
        id: z.string().min(1),
        turns: z.array(historyTurnSchema).default([]),
      })
      .passthrough(),
  })
  .passthrough();

export type CodexThreadIdentityResult = z.infer<
  typeof codexThreadIdentityResultSchema
>;

export function extractCodexSubAgentHistory(
  thread: CodexThreadIdentityResult["thread"],
): CodexSubAgentHistoryEntry[] {
  const entriesByChildThreadId = new Map<string, CodexSubAgentHistoryEntry>();
  for (const turn of thread.turns) {
    for (const candidate of turn.items) {
      if (
        typeof candidate !== "object" ||
        candidate === null ||
        !("type" in candidate) ||
        candidate.type !== "subAgentActivity" ||
        !("kind" in candidate) ||
        candidate.kind !== "started"
      ) {
        continue;
      }
      const item = codexSubAgentActivityItemSchema.safeParse(candidate);
      if (!item.success) {
        continue;
      }
      if (!entriesByChildThreadId.has(item.data.agentThreadId)) {
        entriesByChildThreadId.set(item.data.agentThreadId, {
          agentPath: item.data.agentPath,
          agentThreadId: item.data.agentThreadId,
          callId: item.data.id,
          parentProviderThreadId: thread.id,
          parentTurnId: turn.id,
        });
      }
    }
  }
  return [...entriesByChildThreadId.values()];
}
