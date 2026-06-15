import { z } from "zod";
import {
  permissionModeSchema,
  promptInputSchema,
  reasoningLevelSchema,
  serviceTierSchema,
  threadScheduleKindSchema,
} from "@bb/domain";
import { environmentArgsSchema } from "./shared.js";

export const AUTOMATION_NAME_MAX_LENGTH = 200;
export const SCHEDULE_CRON_MAX_LENGTH = 100;
export const SCHEDULE_NAME_MAX_LENGTH = 200;
export const SCHEDULE_TIMEZONE_MAX_LENGTH = 100;
export const THREAD_SCHEDULE_PROMPT_MAX_LENGTH = 8_000;

const automationThreadRequestSchema = z.object({
  // Automations must choose provider/model explicitly; omitted execution
  // options may still inherit scheduled-thread defaults.
  providerId: z.string().min(1),
  title: z.string().min(1).optional(),
  input: z.array(promptInputSchema).min(1),
  model: z.string().min(1),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  permissionMode: permissionModeSchema.optional(),
  environment: environmentArgsSchema,
  parentThreadId: z.string().min(1).optional(),
});
export type AutomationThreadRequest = z.infer<
  typeof automationThreadRequestSchema
>;

export const automationNameSchema = z
  .string()
  .min(1)
  .max(AUTOMATION_NAME_MAX_LENGTH);
export const scheduleCronSchema = z
  .string()
  .min(1)
  .max(SCHEDULE_CRON_MAX_LENGTH);
export const scheduleNameSchema = z
  .string()
  .min(1)
  .max(SCHEDULE_NAME_MAX_LENGTH);
export const scheduleTimezoneSchema = z
  .string()
  .min(1)
  .max(SCHEDULE_TIMEZONE_MAX_LENGTH);
export const threadSchedulePromptSchema = z
  .string()
  .min(1)
  .max(THREAD_SCHEDULE_PROMPT_MAX_LENGTH);
export const automationScheduleTriggerSchema = z.object({
  triggerType: z.literal("schedule"),
  cron: scheduleCronSchema,
  timezone: scheduleTimezoneSchema,
});
export type AutomationScheduleTrigger = z.infer<
  typeof automationScheduleTriggerSchema
>;

export const scheduledThreadAutomationActionSchema = z.object({
  actionType: z.literal("scheduled-thread"),
  threadRequest: automationThreadRequestSchema,
});

export const automationTriggerSchema = z.discriminatedUnion("triggerType", [
  automationScheduleTriggerSchema,
]);

export const automationActionSchema = z.discriminatedUnion("actionType", [
  scheduledThreadAutomationActionSchema,
]);
export type AutomationAction = z.infer<typeof automationActionSchema>;

export const automationValidationIssueSchema = z.string().min(1);
export const automationValidationSchema = z.object({
  isValid: z.boolean(),
  validationIssues: z.array(automationValidationIssueSchema),
});
export type AutomationValidation = z.infer<typeof automationValidationSchema>;

export const automationSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  name: automationNameSchema,
  enabled: z.boolean(),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  autoArchive: z.boolean(),
  nextRunAt: z.number().nullable(),
  lastRunAt: z.number().nullable(),
  runCount: z.number().int().nonnegative(),
  isValid: z.boolean(),
  validationIssues: z.array(automationValidationIssueSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Automation = z.infer<typeof automationSchema>;

export const threadScheduleSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  threadId: z.string().min(1),
  name: scheduleNameSchema,
  enabled: z.boolean(),
  kind: threadScheduleKindSchema,
  cron: scheduleCronSchema,
  timezone: scheduleTimezoneSchema,
  prompt: threadSchedulePromptSchema,
  nextFireAt: z.number(),
  lastFiredAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type ThreadSchedule = z.infer<typeof threadScheduleSchema>;

export const automationsOverviewProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type AutomationsOverviewProject = z.infer<
  typeof automationsOverviewProjectSchema
>;

export const automationsOverviewThreadSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().nullable(),
  titleFallback: z.string().nullable(),
});
export type AutomationsOverviewThread = z.infer<
  typeof automationsOverviewThreadSchema
>;

export const automationsOverviewAutomationSchema = z.object({
  automation: automationSchema,
  project: automationsOverviewProjectSchema,
});
export type AutomationsOverviewAutomation = z.infer<
  typeof automationsOverviewAutomationSchema
>;

export const automationsOverviewThreadScheduleSchema = z.object({
  project: automationsOverviewProjectSchema,
  schedule: threadScheduleSchema,
  thread: automationsOverviewThreadSchema,
});
export type AutomationsOverviewThreadSchedule = z.infer<
  typeof automationsOverviewThreadScheduleSchema
>;

export const automationsOverviewResponseSchema = z.object({
  automations: z.array(automationsOverviewAutomationSchema),
  threadSchedules: z.array(automationsOverviewThreadScheduleSchema),
});
export type AutomationsOverviewResponse = z.infer<
  typeof automationsOverviewResponseSchema
>;

export const createThreadScheduleRequestSchema = z
  .object({
    name: scheduleNameSchema,
    enabled: z.boolean().default(true),
    cron: scheduleCronSchema,
    timezone: scheduleTimezoneSchema,
    prompt: threadSchedulePromptSchema,
  })
  .strict();
export type CreateThreadScheduleRequest = z.input<
  typeof createThreadScheduleRequestSchema
>;
export type ResolvedCreateThreadScheduleRequest = z.output<
  typeof createThreadScheduleRequestSchema
>;

export const updateThreadScheduleEnabledRequestSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type UpdateThreadScheduleEnabledRequest = z.infer<
  typeof updateThreadScheduleEnabledRequestSchema
>;

export const updateThreadScheduleConfigRequestSchema = z
  .object({
    name: scheduleNameSchema,
    cron: scheduleCronSchema,
    timezone: scheduleTimezoneSchema,
    prompt: threadSchedulePromptSchema,
  })
  .partial()
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.cron !== undefined ||
      value.timezone !== undefined ||
      value.prompt !== undefined,
    "At least one field must be provided",
  );
export type UpdateThreadScheduleConfigRequest = z.infer<
  typeof updateThreadScheduleConfigRequestSchema
>;

export const updateThreadScheduleRequestSchema = z.union([
  updateThreadScheduleEnabledRequestSchema,
  updateThreadScheduleConfigRequestSchema,
]);
export type UpdateThreadScheduleRequest = z.infer<
  typeof updateThreadScheduleRequestSchema
>;

export const createAutomationRequestSchema = z.object({
  name: automationNameSchema,
  enabled: z.boolean().default(true),
  trigger: automationTriggerSchema,
  action: automationActionSchema,
  autoArchive: z.boolean().default(false),
});
export type CreateAutomationRequest = z.input<
  typeof createAutomationRequestSchema
>;
export type ResolvedCreateAutomationRequest = z.output<
  typeof createAutomationRequestSchema
>;

export const updateAutomationEnabledRequestSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();
export type UpdateAutomationEnabledRequest = z.infer<
  typeof updateAutomationEnabledRequestSchema
>;

export const updateAutomationConfigRequestSchema = z
  .object({
    name: automationNameSchema,
    trigger: automationTriggerSchema,
    action: automationActionSchema,
    autoArchive: z.boolean(),
  })
  .partial()
  .strict()
  .refine(
    (value) =>
      value.name !== undefined ||
      value.trigger !== undefined ||
      value.action !== undefined ||
      value.autoArchive !== undefined,
    "At least one field must be provided",
  );
export type UpdateAutomationConfigRequest = z.infer<
  typeof updateAutomationConfigRequestSchema
>;

export const updateAutomationRequestSchema = z.union([
  updateAutomationEnabledRequestSchema,
  updateAutomationConfigRequestSchema,
]);
export type UpdateAutomationRequest = z.infer<
  typeof updateAutomationRequestSchema
>;
