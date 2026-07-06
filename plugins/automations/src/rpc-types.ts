import { z } from "zod";

export const AUTOMATION_NAME_MAX_LENGTH = 200;
export const AUTOMATION_PROMPT_MAX_LENGTH = 8_000;
export const AUTOMATION_SCRIPT_MAX_LENGTH = 262_144;
export const AUTOMATION_SCRIPT_FILE_MAX_LENGTH = 200;
export const SCHEDULE_CRON_MAX_LENGTH = 100;
export const SCHEDULE_TIMEZONE_MAX_LENGTH = 100;
export const AUTOMATION_IDEMPOTENCY_KEY_MAX_LENGTH = 200;
export const AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS = 120_000;
export const AUTOMATION_SCRIPT_TIMEOUT_MAX_MS = 900_000;
export const AUTOMATION_RUNS_LIMIT_DEFAULT = 50;
export const AUTOMATION_RUNS_LIMIT_MAX = 200;

export const permissionModeSchema = z.enum(["full", "workspace-write", "readonly"]);
export type PermissionMode = z.infer<typeof permissionModeSchema>;

export const unmanagedBranchSpecSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), name: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("new"), baseBranch: z.string().min(1) }).strict(),
]);

export const workspaceArgsSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("unmanaged"),
      path: z.string().min(1).nullable(),
      branch: unmanagedBranchSpecSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("managed-worktree"),
      baseBranch: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("named"), name: z.string().min(1) }).strict(),
        z.object({ kind: z.literal("default") }).strict(),
      ]),
    })
    .strict(),
  z.object({ type: z.literal("personal") }).strict(),
]);

export const reuseEnvironmentSchema = z
  .object({
    type: z.literal("reuse"),
    environmentId: z.string().min(1),
  })
  .strict();

export const hostEnvironmentSchema = z
  .object({
    type: z.literal("host"),
    hostId: z.string().min(1).optional(),
    workspace: workspaceArgsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.workspace.type !== "personal" && value.hostId === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "hostId is required unless workspace.type is personal",
        path: ["hostId"],
      });
    }
  });

export const projectDefaultEnvironmentSchema = z
  .object({ type: z.literal("project-default") })
  .strict();

export const agentEnvironmentSchema = z.discriminatedUnion("type", [
  reuseEnvironmentSchema,
  hostEnvironmentSchema,
  projectDefaultEnvironmentSchema,
]);
export type AgentEnvironment = z.infer<typeof agentEnvironmentSchema>;

export const automationOriginSchema = z.enum(["human", "app", "agent"]);
export type AutomationOrigin = z.infer<typeof automationOriginSchema>;
export const automationRunModeSchema = z.enum(["agent", "script"]);
export type AutomationRunMode = z.infer<typeof automationRunModeSchema>;
export const automationRunStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "skipped",
]);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;
export const automationRunTriggerSchema = z.enum(["schedule", "manual"]);
export type AutomationRunTrigger = z.infer<typeof automationRunTriggerSchema>;
export const automationScriptInterpreterSchema = z.enum([
  "bash",
  "sh",
  "node",
  "python3",
]);
export type AutomationScriptInterpreter = z.infer<
  typeof automationScriptInterpreterSchema
>;

export const automationScheduleTriggerSchema = z
  .object({
    triggerType: z.literal("schedule"),
    cron: z.string().min(1).max(SCHEDULE_CRON_MAX_LENGTH),
    timezone: z.string().min(1).max(SCHEDULE_TIMEZONE_MAX_LENGTH),
  })
  .strict();
export const automationOnceTriggerSchema = z
  .object({
    triggerType: z.literal("once"),
    runAt: z.number().int().positive(),
  })
  .strict();
export const automationTriggerSchema = z.discriminatedUnion("triggerType", [
  automationScheduleTriggerSchema,
  automationOnceTriggerSchema,
]);
export type AutomationTrigger = z.infer<typeof automationTriggerSchema>;

export const automationAgentExecutionSchema = z
  .object({
    mode: z.literal("agent"),
    prompt: z.string().min(1).max(AUTOMATION_PROMPT_MAX_LENGTH),
    providerId: z.string().min(1),
    model: z.string().min(1),
    permissionMode: permissionModeSchema,
    environment: agentEnvironmentSchema,
    targetThreadId: z.string().min(1).optional(),
  })
  .strict();

export const automationScriptExecutionSchema = z
  .object({
    mode: z.literal("script"),
    script: z.string().min(1).max(AUTOMATION_SCRIPT_MAX_LENGTH).optional(),
    scriptFile: z
      .string()
      .min(1)
      .max(AUTOMATION_SCRIPT_FILE_MAX_LENGTH)
      .optional(),
    interpreter: automationScriptInterpreterSchema.optional(),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(AUTOMATION_SCRIPT_TIMEOUT_MAX_MS)
      .default(AUTOMATION_SCRIPT_TIMEOUT_DEFAULT_MS),
    env: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const automationExecutionSchema = z.discriminatedUnion("mode", [
  automationAgentExecutionSchema,
  automationScriptExecutionSchema,
]);
export type AutomationExecution = z.infer<typeof automationExecutionSchema>;

function requireExactlyOneScriptSource(
  exec: z.infer<typeof automationExecutionSchema>,
  ctx: z.RefinementCtx,
): void {
  if (exec.mode === "script" && (exec.script != null) === (exec.scriptFile != null)) {
    ctx.addIssue({
      code: "custom",
      message: "provide exactly one of script | scriptFile",
      path: ["script"],
    });
  }
}

export const automationExecutionRequestSchema =
  automationExecutionSchema.superRefine(requireExactlyOneScriptSource);

export const automationResponseSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    enabled: z.boolean(),
    trigger: automationTriggerSchema,
    execution: automationExecutionSchema,
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
  })
  .strict();
export type AutomationResponse = z.infer<typeof automationResponseSchema>;

export const automationRunResponseSchema = z
  .object({
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
  })
  .strict();
export type AutomationRunResponse = z.infer<typeof automationRunResponseSchema>;

export const projectAutomationInputSchema = z
  .object({
    projectId: z.string().min(1),
    automationId: z.string().min(1),
  })
  .strict();
export type ProjectAutomationInput = z.infer<typeof projectAutomationInputSchema>;

export const listAutomationsInputSchema = z
  .object({ projectId: z.string().min(1) })
  .strict();
export type ListAutomationsInput = z.infer<typeof listAutomationsInputSchema>;

export const createAutomationInputSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1).max(AUTOMATION_NAME_MAX_LENGTH),
    enabled: z.boolean().default(true),
    trigger: automationTriggerSchema,
    execution: automationExecutionRequestSchema,
    origin: automationOriginSchema,
    createdByThreadId: z.string().min(1).optional(),
  })
  .strict();
export type CreateAutomationInput = z.input<typeof createAutomationInputSchema>;
export type ResolvedCreateAutomationInput = z.output<
  typeof createAutomationInputSchema
>;

export const updateAutomationInputSchema = z
  .object({
    projectId: z.string().min(1),
    automationId: z.string().min(1),
    name: z.string().min(1).max(AUTOMATION_NAME_MAX_LENGTH).optional(),
    trigger: automationTriggerSchema.optional(),
    execution: automationExecutionRequestSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.trigger !== undefined ||
      value.execution !== undefined,
    { message: "at least one field is required" },
  );
export type UpdateAutomationInput = z.infer<typeof updateAutomationInputSchema>;

export const runAutomationInputSchema = projectAutomationInputSchema
  .extend({
    idempotencyKey: z
      .string()
      .min(1)
      .max(AUTOMATION_IDEMPOTENCY_KEY_MAX_LENGTH)
      .optional(),
  })
  .strict();
export type RunAutomationInput = z.infer<typeof runAutomationInputSchema>;

export const automationRunsInputSchema = projectAutomationInputSchema
  .extend({
    limit: z
      .number()
      .int()
      .positive()
      .max(AUTOMATION_RUNS_LIMIT_MAX)
      .default(AUTOMATION_RUNS_LIMIT_DEFAULT),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type AutomationRunsInput = z.input<typeof automationRunsInputSchema>;
export type ResolvedAutomationRunsInput = z.output<
  typeof automationRunsInputSchema
>;

export const automationListResponseSchema = z.array(automationResponseSchema);
export type AutomationListResponse = z.infer<typeof automationListResponseSchema>;

export const automationRunListResponseSchema = z
  .object({
    runs: z.array(automationRunResponseSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type AutomationRunListResponse = z.infer<
  typeof automationRunListResponseSchema
>;

export const automationRunRpcResponseSchema = z
  .object({ run: automationRunResponseSchema })
  .strict();
export type AutomationRunRpcResponse = z.infer<
  typeof automationRunRpcResponseSchema
>;

export const automationsOverviewEntrySchema = z
  .object({
    automation: automationResponseSchema,
    project: z.object({ id: z.string(), name: z.string() }).strict(),
  })
  .strict();
export const automationsOverviewResponseSchema = z
  .object({ automations: z.array(automationsOverviewEntrySchema) })
  .strict();
export type AutomationsOverviewResponse = z.infer<
  typeof automationsOverviewResponseSchema
>;
