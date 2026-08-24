/**
 * The Claude Code task-tool vocabulary as `@get-bb/plugin-sdk/provider-bridge`
 * published it through 0.4.15: the four tool names and the union of their
 * outputs. Core shared these with the claude-code runtime when that runtime
 * lived in bb; the claude-code plugin now owns its own task vocabulary and
 * nothing in this repository reads these. They stay exactly as shipped so a
 * bridge compiled against an earlier SDK still resolves them, and go with
 * the next major version (docs/api_to_audit.md, "Scheduled removals").
 */
import { z } from "zod";

export const claudeTaskToolNameSchema = z.enum([
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
]);

const claudeTaskStatusSchema = z.enum(["pending", "in_progress", "completed"]);

const claudeTaskCreateOutputSchema = z
  .object({
    task: z
      .object({
        id: z.string(),
        subject: z.string(),
      })
      .passthrough(),
  })
  .passthrough();

const claudeTaskGetOutputSchema = z
  .object({
    task: z
      .object({
        id: z.string(),
        status: claudeTaskStatusSchema,
        subject: z.string(),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();

const claudeTaskUpdateOutputSchema = z
  .object({
    success: z.boolean(),
    taskId: z.string(),
  })
  .passthrough();

const claudeTaskListOutputSchema = z
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
