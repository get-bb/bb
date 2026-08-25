import {
  dispatchHoldHolderSchema,
  dispatchHoldKindSchema,
  dispatchHoldReleaseKindSchema,
  promptInputSchema,
  resolvedThreadExecutionOptionsSchema,
} from "@bb/domain";
import { z } from "zod";
import { clientTurnRequestIdSchema } from "@bb/domain";

/**
 * What a released hold will dispatch, as the UI needs to render it.
 *
 * `inline` is a turn the user (or a plugin) already composed: the card shows
 * its prompt blocks and the execution tuple frozen when the hold was created.
 * `editable` is server-derived rather than inferred by the client — only a
 * live inline hold can be rewritten, and a client that guessed from
 * `releasedAt` would have to duplicate that rule.
 *
 * `retry` references a failed turn instead of carrying one, so there is
 * nothing to preview and nothing to edit.
 */
export const dispatchHoldPayloadResponseSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("inline"),
    input: z.array(promptInputSchema),
    execution: resolvedThreadExecutionOptionsSchema,
    editable: z.boolean(),
  }),
  z.object({
    kind: z.literal("retry"),
    retryOfTurnRequestId: clientTurnRequestIdSchema,
  }),
]);
export type DispatchHoldPayloadResponse = z.infer<
  typeof dispatchHoldPayloadResponseSchema
>;

/**
 * A dispatch hold on the wire. Everything a pending-region card, a banner and
 * a `bb thread holds` row need is here, including the stall inputs
 * (`lastReportAt` + `staleAfterMs`): staleness is a clock comparison, so it is
 * computed client-side and never goes stale in a cached response.
 */
export const dispatchHoldResponseSchema = z.object({
  id: z.string().min(1),
  kind: dispatchHoldKindSchema,
  threadId: z.string().min(1),
  holder: dispatchHoldHolderSchema,
  /** False when there is nothing to release into yet; Cancel always works. */
  userReleasable: z.boolean(),
  reason: z.string(),
  payload: dispatchHoldPayloadResponseSchema,
  /** Non-null when core's timer sweep will auto-release the hold. */
  resumeAt: z.number().nullable(),
  expectedReleaseAt: z.number().nullable(),
  staleAfterMs: z.number().nullable(),
  lastReportAt: z.number().nullable(),
  createdAt: z.number(),
  releasedAt: z.number().nullable(),
  releaseKind: dispatchHoldReleaseKindSchema.nullable(),
});
export type DispatchHoldResponse = z.infer<typeof dispatchHoldResponseSchema>;

export const dispatchHoldListResponseSchema = z.array(
  dispatchHoldResponseSchema,
);
export type DispatchHoldListResponse = z.infer<
  typeof dispatchHoldListResponseSchema
>;

/**
 * Filters for the cross-thread hold list. Both are genuinely absent by
 * default — no filter means every live hold, which is what the "what is
 * pending right now" view wants. The list is always live-only; released holds
 * are history and live in each thread's timeline.
 */
export const dispatchHoldListQuerySchema = z.object({
  threadId: z.string().min(1).optional(),
  holder: dispatchHoldHolderSchema.optional(),
});
export type DispatchHoldListQuery = z.infer<typeof dispatchHoldListQuerySchema>;

/**
 * Edits to a live hold. Each field is a genuine partial update: omitting
 * `input` reschedules without touching the draft, and omitting `resumeAt`
 * edits the draft without moving the timer.
 */
export const updateDispatchHoldRequestSchema = z
  .object({
    input: z.array(promptInputSchema).min(1).optional(),
    resumeAt: z.number().int().nonnegative().optional(),
  })
  .refine(
    (value) => value.input !== undefined || value.resumeAt !== undefined,
    { message: "input or resumeAt is required" },
  );
export type UpdateDispatchHoldRequest = z.infer<
  typeof updateDispatchHoldRequestSchema
>;
