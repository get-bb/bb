import { z } from "zod";
import {
  automationOriginValues,
  automationRunModeValues,
  automationRunStatusValues,
  automationRunTriggerValues,
  automationScriptInterpreterValues,
  permissionModeSchema,
} from "@bb/domain";
import { environmentArgsSchema } from "./shared.js";

export const AUTOMATION_NAME_MAX_LENGTH = 200;
export const AUTOMATION_PROMPT_MAX_LENGTH = 8_000;
export const AUTOMATION_SCRIPT_MAX_LENGTH = 262_144;
export const AUTOMATION_SCRIPT_FILE_MAX_LENGTH = 200;
export const SCHEDULE_CRON_MAX_LENGTH = 100;
export const SCHEDULE_TIMEZONE_MAX_LENGTH = 100;
export const AUTOMATION_IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS = 120_000;
export const AUTOMATION_SCRIPT_TIMEOUT_MAX_MS = 900_000;

export const automationOriginSchema = z.enum(automationOriginValues);
export const automationRunModeSchema = z.enum(automationRunModeValues);
export const automationRunStatusSchema = z.enum(automationRunStatusValues);
export const automationRunTriggerSchema = z.enum(automationRunTriggerValues);
export const automationScriptInterpreterSchema = z.enum(
  automationScriptInterpreterValues,
);

export const automationScheduleTriggerSchema = z.object({
  triggerType: z.literal("schedule"),
  cron: z.string().min(1).max(SCHEDULE_CRON_MAX_LENGTH),
  timezone: z.string().min(1).max(SCHEDULE_TIMEZONE_MAX_LENGTH),
});
export const automationOnceTriggerSchema = z.object({
  triggerType: z.literal("once"),
  runAt: z.number().int().positive(),
});
export const automationTriggerSchema = z.discriminatedUnion("triggerType", [
  automationScheduleTriggerSchema,
  automationOnceTriggerSchema,
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

// Execution config, discriminated on mode. discriminatedUnion members must be
// plain objects, so the script `script` XOR `scriptFile` rule is enforced on the
// request schemas via superRefine, not on the union member itself.
export const automationAgentExecutionSchema = z.object({
  mode: z.literal("agent"),
  prompt: z.string().min(1).max(AUTOMATION_PROMPT_MAX_LENGTH),
  providerId: z.string().min(1),
  model: z.string().min(1),
  permissionMode: permissionModeSchema,
  targetThreadId: z.string().min(1).optional(),
});
export const automationScriptExecutionSchema = z.object({
  mode: z.literal("script"),
  // inline content (API-first) OR a relative file the user placed under the
  // automation's script dir; responses always carry scriptFile (never content).
  script: z.string().min(1).max(AUTOMATION_SCRIPT_MAX_LENGTH).optional(),
  scriptFile: z.string().min(1).max(AUTOMATION_SCRIPT_FILE_MAX_LENGTH).optional(),
  interpreter: automationScriptInterpreterSchema.optional(),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(AUTOMATION_SCRIPT_TIMEOUT_MAX_MS)
    .default(AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS),
  env: z.record(z.string(), z.string()).optional(),
});
export const automationExecutionSchema = z.discriminatedUnion("mode", [
  automationAgentExecutionSchema,
  automationScriptExecutionSchema,
]);
export type AutomationExecution = z.infer<typeof automationExecutionSchema>;

const requireExactlyOneScriptSource = (
  exec: z.infer<typeof automationExecutionSchema>,
  ctx: z.RefinementCtx,
): void => {
  if (exec.mode === "script" && (exec.script != null) === (exec.scriptFile != null)) {
    ctx.addIssue({
      code: "custom",
      message: "provide exactly one of script | scriptFile",
      path: ["script"],
    });
  }
};
export const automationExecutionRequestSchema =
  automationExecutionSchema.superRefine(requireExactlyOneScriptSource);

export const automationSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: automationTriggerSchema,
  execution: automationExecutionSchema,
  environment: environmentArgsSchema,
  autoArchive: z.boolean(),
  origin: automationOriginSchema,
  createdByThreadId: z.string().min(1).nullable(),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  runCount: z.number().int().min(0),
  lastRunStatus: automationRunStatusSchema.nullable(),
  lastRunThreadId: z.string().min(1).nullable(),
  lastError: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Automation = z.infer<typeof automationSchema>;

export const automationRunSchema = z.object({
  id: z.string(),
  automationId: z.string(),
  runMode: automationRunModeSchema,
  threadId: z.string().min(1).nullable(),
  status: automationRunStatusSchema,
  trigger: automationRunTriggerSchema,
  skipReason: z.string().nullable(),
  error: z.string().nullable(),
  output: z.string().nullable(),
  exitCode: z.number().int().nullable(),
  scheduledFor: z.number(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const createAutomationRequestSchema = z
  .object({
    name: z.string().min(1).max(AUTOMATION_NAME_MAX_LENGTH),
    enabled: z.boolean().default(true),
    trigger: automationTriggerSchema,
    execution: automationExecutionRequestSchema,
    environment: environmentArgsSchema,
    autoArchive: z.boolean().default(false),
    origin: automationOriginSchema,
    createdByThreadId: z.string().min(1).optional(),
  })
  .strict();
export type CreateAutomationRequest = z.input<typeof createAutomationRequestSchema>;
export type ResolvedCreateAutomationRequest = z.output<
  typeof createAutomationRequestSchema
>;

export const updateAutomationRequestSchema = z
  .object({
    name: z.string().min(1).max(AUTOMATION_NAME_MAX_LENGTH),
    trigger: automationTriggerSchema,
    execution: automationExecutionRequestSchema,
    environment: environmentArgsSchema,
    autoArchive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });
export type UpdateAutomationRequest = z.infer<typeof updateAutomationRequestSchema>;

export const runAutomationRequestSchema = z
  .object({
    idempotencyKey: z
      .string()
      .min(1)
      .max(AUTOMATION_IDEMPOTENCY_KEY_MAX_LENGTH)
      .optional(),
  })
  .strict();
export type RunAutomationRequest = z.infer<typeof runAutomationRequestSchema>;

export const automationRunListQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/u).optional(),
  cursor: z.string().min(1).optional(),
});
export type AutomationRunListQuery = z.infer<typeof automationRunListQuerySchema>;

export const automationRunListResponseSchema = z.object({
  runs: z.array(automationRunSchema),
  nextCursor: z.string().nullable(),
});
export type AutomationRunListResponse = z.infer<
  typeof automationRunListResponseSchema
>;

export const automationRunResponseSchema = z.object({ run: automationRunSchema });
export type AutomationRunResponse = z.infer<typeof automationRunResponseSchema>;

export const automationsOverviewEntrySchema = z.object({
  automation: automationSchema,
  project: z.object({ id: z.string(), name: z.string() }),
});
export const automationsOverviewResponseSchema = z.object({
  automations: z.array(automationsOverviewEntrySchema),
});
export type AutomationsOverviewResponse = z.infer<
  typeof automationsOverviewResponseSchema
>;
