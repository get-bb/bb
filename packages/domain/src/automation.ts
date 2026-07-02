/**
 * Automations: recurring/scheduled tasks that, when due, either spawn a bb thread
 * (agent run) or execute a stored script (no-agent run). Enum value tables live
 * here so both the DB schema ($type tags) and the server contract (zod enums)
 * derive from one source.
 */

export const automationTriggerTypeValues = ["schedule", "once"] as const;
export type AutomationTriggerType = (typeof automationTriggerTypeValues)[number];

export const automationRunModeValues = ["agent", "script"] as const;
export type AutomationRunMode = (typeof automationRunModeValues)[number];

export const automationScriptInterpreterValues = [
  "bash",
  "sh",
  "node",
  "python3",
] as const;
export type AutomationScriptInterpreter =
  (typeof automationScriptInterpreterValues)[number];

/** Who created the automation. Self-declared at the boundary; surfaced for audit. */
export const automationOriginValues = ["human", "app", "agent"] as const;
export type AutomationOrigin = (typeof automationOriginValues)[number];

export const automationRunStatusValues = [
  "running",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type AutomationRunStatus = (typeof automationRunStatusValues)[number];

export const automationRunTriggerValues = ["schedule", "manual"] as const;
export type AutomationRunTrigger = (typeof automationRunTriggerValues)[number];
