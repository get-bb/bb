import { z } from "zod";
import { pluginInputsSchema } from "./dispatch-gate.js";
import { pluginIdSchema } from "./plugin-id.js";
import { clientTurnRequestIdSchema } from "./protocol-ids.js";
import {
  promptInputSchema,
  resolvedThreadExecutionOptionsSchema,
} from "./shared-types.js";

/**
 * A hold is a durable deferred dispatch: a turn that would have run now but
 * waits for a timer, a plugin owner, or the user. `turn` is the only kind —
 * an `environment-provision` kind was cut with the environment gate and can
 * return additively.
 */
export const dispatchHoldKindValues = ["turn"] as const;
export const dispatchHoldKindSchema = z.enum(dispatchHoldKindValues);
export type DispatchHoldKind = z.infer<typeof dispatchHoldKindSchema>;

/**
 * Core mechanisms that park a dispatch for a user-visible reason. `core:`
 * holders are exempt from orphan release and are never user-releasable, so
 * the set is closed rather than a free-form string.
 */
export const coreDispatchHoldMechanismValues = [
  "reprovision",
  "host-offline",
] as const;
export const coreDispatchHoldMechanismSchema = z.enum(
  coreDispatchHoldMechanismValues,
);
export type CoreDispatchHoldMechanism = z.infer<
  typeof coreDispatchHoldMechanismSchema
>;

export const DISPATCH_HOLD_USER_HOLDER = "user";
export const DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX = "plugin:";
export const DISPATCH_HOLD_CORE_HOLDER_PREFIX = "core:";

/**
 * Who owns the hold and therefore who may release it. Modelled as a prefixed
 * string because that is what the `dispatch_holds.holder` column stores; the
 * template-literal arms keep the prefix discriminable at the type level
 * (`holder.startsWith(DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX)`).
 */
export const dispatchHoldHolderSchema = z.union([
  z.literal(DISPATCH_HOLD_USER_HOLDER),
  z.templateLiteral([
    DISPATCH_HOLD_PLUGIN_HOLDER_PREFIX,
    pluginIdSchema,
  ]),
  z.templateLiteral([
    DISPATCH_HOLD_CORE_HOLDER_PREFIX,
    coreDispatchHoldMechanismSchema,
  ]),
]);
export type DispatchHoldHolder = z.infer<typeof dispatchHoldHolderSchema>;

/**
 * Why a hold stopped being live. `owner` is the holding plugin releasing its
 * own hold, `timer` is core's sweep reaching `resumeAt`, `user` is an explicit
 * "Release now", `orphaned` is the sweep releasing a hold whose owner plugin is
 * gone, and `cancelled` discards the dispatch instead of running it.
 */
export const dispatchHoldReleaseKindValues = [
  "owner",
  "timer",
  "user",
  "orphaned",
  "cancelled",
] as const;
export const dispatchHoldReleaseKindSchema = z.enum(
  dispatchHoldReleaseKindValues,
);
export type DispatchHoldReleaseKind = z.infer<
  typeof dispatchHoldReleaseKindSchema
>;

/** Reasons render in a banner and a thread-list tooltip, so they stay short. */
export const DISPATCH_HOLD_REASON_MAX_LENGTH = 200;
export const dispatchHoldReasonSchema = z
  .string()
  .min(1)
  .max(DISPATCH_HOLD_REASON_MAX_LENGTH);

/**
 * What a released `turn` hold dispatches.
 *
 * `inline` carries the whole turn: the prompt blocks the user wrote, the
 * execution tuple frozen at hold time, and the plugin inputs from the request.
 * Its input is editable while the hold is live — it is a draft that has not run.
 *
 * `retry` only references a failed turn's original request. Nothing about it is
 * editable: the point of a retry is to re-submit the original faithfully, with
 * no duplicated user message.
 */
export const dispatchHoldPayloadSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("inline"),
    input: z.array(promptInputSchema),
    execution: resolvedThreadExecutionOptionsSchema,
    // The request's plugin side-channel, carried so a release re-runs the gate
    // pipeline with the same plugin input the original dispatch had.
    pluginInputs: pluginInputsSchema,
  }),
  z.object({
    kind: z.literal("retry"),
    /**
     * The ORIGINAL request, not the attempt that just failed. Retrying a retry
     * re-submits the same original blocks, so this id is carried forward
     * unchanged across attempts and `attempt` is what distinguishes them.
     */
    retryOfTurnRequestId: clientTurnRequestIdSchema,
    /** Which attempt this hold will dispatch: 2 is the first retry. */
    attempt: z.number().int().min(2),
  }),
]);
export type DispatchHoldPayload = z.infer<typeof dispatchHoldPayloadSchema>;

export type DispatchHoldInlinePayload = Extract<
  DispatchHoldPayload,
  { kind: "inline" }
>;

export type DispatchHoldRetryPayload = Extract<
  DispatchHoldPayload,
  { kind: "retry" }
>;

/**
 * One transcript step reported by a hold's owner. Mirrors the `step` half of
 * `provisioningTranscriptEntry`: `key` identifies the step so repeated reports
 * update it in place rather than appending.
 */
export const dispatchHoldReportStepSchema = z.object({
  key: z.string().min(1),
  text: z.string().min(1),
  status: z.enum(["started", "completed", "failed"]),
});
export type DispatchHoldReportStep = z.infer<
  typeof dispatchHoldReportStepSchema
>;

/** A tail of log output attached to the hold's transcript under `key`. */
export const dispatchHoldReportOutputSchema = z.object({
  key: z.string().min(1),
  text: z.string(),
});
export type DispatchHoldReportOutput = z.infer<
  typeof dispatchHoldReportOutputSchema
>;

/**
 * A progress report from a hold's owner. Every field is optional because
 * omission means "leave this as it is" — a report that only appends output
 * must not clear the reason or the ETA. Core stamps `lastReportAt` on every
 * accepted report, which is what stall detection reads.
 */
export const dispatchHoldReportUpdateSchema = z.object({
  reason: dispatchHoldReasonSchema.optional(),
  step: dispatchHoldReportStepSchema.optional(),
  output: dispatchHoldReportOutputSchema.optional(),
  expectedReleaseAt: z.number().int().nonnegative().optional(),
  staleAfterMs: z.number().int().positive().optional(),
});
export type DispatchHoldReportUpdate = z.infer<
  typeof dispatchHoldReportUpdateSchema
>;
