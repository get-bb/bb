import type {
  ApprovalPendingInteractionResolution,
  PendingInteractionApprovalSubject,
} from "@bb/domain";
import { z } from "zod";

export const PLAN_MAX_LENGTH = 64_000;
export const PLAN_COMMENT_MAX_LENGTH = 4096;

const planTextSchema = z
  .string()
  .min(1)
  .max(PLAN_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, {
    message: "Plan content cannot be blank",
  });

const planApprovalParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    toolCallId: z.string().min(1),
    planContent: planTextSchema.optional(),
    plan: planTextSchema.optional(),
    input: z.object({ plan: planTextSchema }).optional(),
  })
  .passthrough()
  .transform((value) => {
    const planContent = value.planContent ?? value.plan ?? value.input?.plan;
    if (planContent === undefined) {
      throw new Error("Grok plan approval request has no plan content");
    }
    return {
      sessionId: value.sessionId,
      toolCallId: value.toolCallId,
      planContent,
    };
  });

export type GrokPlanApprovalParams = z.infer<typeof planApprovalParamsSchema>;

export type GrokPlanApprovalResolution = ApprovalPendingInteractionResolution;

export function decodeGrokPlanApprovalParams(
  params: unknown,
): GrokPlanApprovalParams {
  return planApprovalParamsSchema.parse(params);
}

export function grokPlanApprovalSubject(
  request: GrokPlanApprovalParams,
): Extract<PendingInteractionApprovalSubject, { kind: "plan" }> {
  return {
    kind: "plan",
    itemId: request.toolCallId,
    plan: request.planContent,
    planFilePath: null,
  };
}

export function grokPlanApprovalResponse(
  resolution: GrokPlanApprovalResolution,
): Record<string, unknown> {
  if (resolution.decision !== "deny") {
    return { outcome: "approved" };
  }
  if (resolution.comments === undefined) {
    return { outcome: "cancelled" };
  }
  const comments = z
    .string()
    .min(1)
    .max(PLAN_COMMENT_MAX_LENGTH)
    .refine((value) => value.trim().length > 0, {
      message: "Plan comments cannot be blank",
    })
    .parse(resolution.comments);
  return { outcome: "cancelled", comments };
}

export function grokPlanApprovalCancellation(): Record<string, unknown> {
  return { outcome: "cancelled" };
}
