import { z } from "zod";

export const threadTimelineActiveTurnPhaseValues = [
  "provider",
  "model",
  "command",
  "tool",
  "compaction",
  "subagent",
  "workflow",
] as const;

export const threadTimelineActiveTurnPhaseSchema = z.enum(
  threadTimelineActiveTurnPhaseValues,
);
export type ThreadTimelineActiveTurnPhase = z.infer<
  typeof threadTimelineActiveTurnPhaseSchema
>;

/**
 * The latest material activity in an active provider turn. The server derives
 * this from the same event projection that renders the timeline, so app and
 * CLI consumers do not need to reinterpret provider-specific events.
 */
export const threadTimelineActiveTurnActivitySchema = z
  .object({
    phase: threadTimelineActiveTurnPhaseSchema,
    detail: z.string().nullable(),
    startedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    lastProgressSequence: z.number().int().nonnegative(),
    quietThresholdMs: z.number().int().positive(),
  })
  .strict();

export type ThreadTimelineActiveTurnActivity = z.infer<
  typeof threadTimelineActiveTurnActivitySchema
>;
