import { z } from "zod";

export const claudeTaskToolNameValues = [
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
] as const;
export const claudeTaskToolNameSchema = z.enum(claudeTaskToolNameValues);
export type ClaudeTaskToolName = z.infer<typeof claudeTaskToolNameSchema>;

const claudeTaskStatusValues = ["pending", "in_progress", "completed"] as const;
const claudeTaskStatusSchema = z.enum(claudeTaskStatusValues);

const claudeTaskUpdateStatusValues = [
  ...claudeTaskStatusValues,
  "deleted",
] as const;
const claudeTaskUpdateStatusSchema = z.enum(claudeTaskUpdateStatusValues);

const claudeTaskListStatusValues = [
  ...claudeTaskStatusValues,
  "deleted",
] as const;
const claudeTaskListStatusSchema = z.enum(claudeTaskListStatusValues);

export const claudeTaskCreateArgsSchema = z
  .object({
    activeForm: z.string().optional(),
    subject: z.string(),
  })
  .passthrough();

export const claudeTaskGetArgsSchema = z
  .object({
    taskId: z.string(),
  })
  .passthrough();

export const claudeTaskUpdateArgsSchema = z
  .object({
    activeForm: z.string().optional(),
    status: claudeTaskUpdateStatusSchema.optional(),
    subject: z.string().optional(),
    taskId: z.string(),
  })
  .passthrough();

export const claudeTaskCreateOutputSchema = z
  .object({
    task: z
      .object({
        id: z.string(),
        subject: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const claudeTaskGetOutputTaskSchema = z
  .object({
    id: z.string(),
    status: claudeTaskStatusSchema,
    subject: z.string(),
  })
  .passthrough();

export const claudeTaskGetOutputSchema = z
  .object({
    task: claudeTaskGetOutputTaskSchema.nullable(),
  })
  .passthrough();

export const claudeTaskUpdateOutputSchema = z
  .object({
    success: z.boolean(),
    taskId: z.string(),
  })
  .passthrough();

export const claudeTaskListItemSchema = z
  .object({
    id: z.string(),
    status: claudeTaskListStatusSchema,
    subject: z.string(),
  })
  .passthrough();

export const claudeTaskListOutputSchema = z
  .object({
    tasks: z.array(z.unknown()),
  })
  .passthrough();

export const claudeTaskToolOutputSchema = z.union([
  claudeTaskCreateOutputSchema,
  claudeTaskGetOutputSchema,
  claudeTaskListOutputSchema,
  claudeTaskUpdateOutputSchema,
]);
export type ClaudeTaskToolOutput = z.infer<typeof claudeTaskToolOutputSchema>;
