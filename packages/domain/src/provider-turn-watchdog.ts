import { z } from "zod";
import type { ThreadEventType } from "./provider-event.js";
import { threadEventScopePolicyByType } from "./thread-event-scope.js";
import type { ThreadOnlyThreadEventType } from "./thread-event-scope.js";

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
  "item/backgroundTask/completed",
  "turn/plan/updated",
  "turn/diff/updated",
  "provider/error",
  "provider/warning",
] as const satisfies readonly ThreadEventType[];
export const providerTurnWatchdogActivityEventTypeSchema = z.enum(
  providerTurnWatchdogActivityEventTypeValues,
);
export type ProviderTurnWatchdogActivityEventType = z.infer<
  typeof providerTurnWatchdogActivityEventTypeSchema
>;

export type ProviderTurnWatchdogThreadScopedActivityEventType = Extract<
  ProviderTurnWatchdogActivityEventType,
  ThreadOnlyThreadEventType
>;

/**
 * Activity event types the watchdog also counts when persisted thread-scoped
 * (turn_id NULL): exactly the activity event types whose scope policy is
 * "thread". Derived from the scope-policy map rather than restated so a new
 * thread-scoped liveness event type added to the activity list can never be
 * silently invisible to the SQL NULL-turn arm in @bb/db — the divergence that
 * previously let the watchdog kill healthy workflow turns.
 *
 * Today this is the background task family: tasks outlive their spawning turn
 * (thread-scoped by policy), yet they are the only liveness signal while a
 * workflow runs — ignoring them stops healthy workflow turns mid-flight.
 * provider/error and provider/warning stay excluded automatically because
 * their policy is "thread-or-turn", not "thread": thread-scoped provider
 * noise must not defer reaping a genuinely wedged turn.
 * item/backgroundTask/completed is load-bearing here, not cosmetic — progress
 * events are pruned the moment the completed event lands, so completed must
 * take over as the activity anchor or the watchdog false-fires right after a
 * successful workflow.
 */
export const providerTurnWatchdogThreadScopedActivityEventTypeValues: readonly ProviderTurnWatchdogThreadScopedActivityEventType[] =
  providerTurnWatchdogActivityEventTypeValues.filter(
    (
      eventType,
    ): eventType is ProviderTurnWatchdogThreadScopedActivityEventType =>
      threadEventScopePolicyByType[eventType] === "thread",
  );

export const systemProviderTurnWatchdogEventDataSchema = z.object({
  reason: providerTurnWatchdogReasonSchema,
  thresholdMs: z.number().int().positive(),
  elapsedMs: z.number().int().nonnegative(),
  activeTurnId: z.string().min(1),
  activeTurnStartedAt: z.number().int().nonnegative(),
  lastActivityEventSequence: z.number().int().positive(),
  /**
   * Diagnostic label only (the UI interpolates it verbatim). A plain string —
   * not the activity enum — so editing the activity list never makes
   * previously persisted watchdog events unparseable.
   */
  lastActivityEventType: z.string().min(1),
  lastActivityEventAt: z.number().int().nonnegative(),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1).nullable(),
  firedAt: z.number().int().nonnegative(),
});
export type SystemProviderTurnWatchdogEventData = z.infer<
  typeof systemProviderTurnWatchdogEventDataSchema
>;
