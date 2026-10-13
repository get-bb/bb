import { z } from "zod";

/**
 * The Family-B system-message taxonomy.
 *
 * Its own module rather than part of `thread-events.ts` because two modules on
 * opposite sides of an import edge need it: thread events stamp it on a
 * `client/turn/requested`, and a queued row carries it while one of core's own
 * notices is queued. Leaving it in `thread-events.ts` made those two import
 * each other, which left whichever loaded second holding `undefined` schemas.
 */

// One value per Family-B system-message action, plus an explicit `unlabeled`
// for legacy/pre-taxonomy messages (rendered generically). `unlabeled` beats a
// nullable field: its meaning is self-documenting and avoids `null`-as-default.
const systemMessageKindValues = [
  "ownership-assigned",
  "ownership-removed",
  "child-needs-attention",
  "child-completed",
  "child-failed",
  "child-interrupted",
  "child-outcome-batch",
  "tool-result-delivered",
  "unlabeled",
] as const;
export const systemMessageKindSchema = z.enum(systemMessageKindValues);
export type SystemMessageKind = z.infer<typeof systemMessageKindSchema>;

export const systemThreadInterruptedReasonSchema = z.enum([
  "manual-stop",
  "host-daemon-restarted",
  "host-removed",
  "provider-turn-idle",
]);
export type SystemThreadInterruptedReason = z.infer<
  typeof systemThreadInterruptedReasonSchema
>;

export const childThreadOutcomeSchema = z.object({
  threadId: z.string(),
  status: z.enum(["completed", "failed", "interrupted"]),
  interruption: z
    .object({
      reason: systemThreadInterruptedReasonSchema,
      cause: z.literal("host-connection-lost").optional(),
    })
    .optional(),
});
export type ChildThreadOutcome = z.infer<typeof childThreadOutcomeSchema>;

export const systemMessageSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    threadId: z.string(),
    threadName: z.string(),
    outcomes: z.array(childThreadOutcomeSchema).optional(),
  }),
  z.object({
    kind: z.literal("thread-batch"),
    count: z.number(),
    outcomes: z.array(childThreadOutcomeSchema).optional(),
  }),
  z.object({
    kind: z.literal("tool-call"),
    toolName: z.string(),
    suppress: z.boolean(),
  }),
]);
export type SystemMessageSubject = z.infer<typeof systemMessageSubjectSchema>;
