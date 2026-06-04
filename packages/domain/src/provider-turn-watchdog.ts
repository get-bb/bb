import { z } from "zod";

export const providerTurnWatchdogReasonValues = ["provider-turn-idle"] as const;
export const providerTurnWatchdogReasonSchema = z.enum(
  providerTurnWatchdogReasonValues,
);

export const providerTurnWatchdogActivityEventTypeValues = [
  "turn/started",
  "turn/input/accepted",
  "item/started",
  "item/completed",
  "item/agentMessage/delta",
  "item/commandExecution/outputDelta",
  "item/fileChange/outputDelta",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/textDelta",
  "item/plan/delta",
  "item/mcpToolCall/progress",
  "item/toolCall/progress",
  "item/backgroundTask/progress",
  "turn/plan/updated",
  "turn/diff/updated",
  "provider/error",
  "provider/warning",
] as const;
export const providerTurnWatchdogActivityEventTypeSchema = z.enum(
  providerTurnWatchdogActivityEventTypeValues,
);
export type ProviderTurnWatchdogActivityEventType = z.infer<
  typeof providerTurnWatchdogActivityEventTypeSchema
>;

export const systemProviderTurnWatchdogEventDataSchema = z.object({
  reason: providerTurnWatchdogReasonSchema,
  thresholdMs: z.number().int().positive(),
  elapsedMs: z.number().int().nonnegative(),
  activeTurnId: z.string().min(1),
  activeTurnStartedAt: z.number().int().nonnegative(),
  lastActivityEventSequence: z.number().int().positive(),
  lastActivityEventType: providerTurnWatchdogActivityEventTypeSchema,
  lastActivityEventAt: z.number().int().nonnegative(),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1).nullable(),
  firedAt: z.number().int().nonnegative(),
});
export type SystemProviderTurnWatchdogEventData = z.infer<
  typeof systemProviderTurnWatchdogEventDataSchema
>;
