import { z } from "zod";
import type { CodexSubAgentHistoryEntry } from "./translator.js";

const subAgentActivitySchema = z
  .object({
    agentPath: z.string(),
    agentThreadId: z.string().min(1),
    id: z.string().min(1),
    kind: z.enum(["started", "interacted", "interrupted"]),
    type: z.literal("subAgentActivity"),
  })
  .passthrough();

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
      const item = subAgentActivitySchema.safeParse(candidate);
      if (!item.success || item.data.kind !== "started") {
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
