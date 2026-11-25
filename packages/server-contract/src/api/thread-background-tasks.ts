import { backgroundTaskStatusSchema } from "@bb/domain";
import { z } from "zod";

export const threadBackgroundTaskSchema = z
  .object({
    itemId: z.string().min(1),
    taskType: z.string(),
    description: z.string(),
    taskStatus: backgroundTaskStatusSchema,
    stoppable: z.boolean(),
  })
  .strict();
export type ThreadBackgroundTask = z.infer<typeof threadBackgroundTaskSchema>;

export const threadBackgroundTasksResponseSchema = z
  .object({ backgroundTasks: z.array(threadBackgroundTaskSchema) })
  .strict();
export type ThreadBackgroundTasksResponse = z.infer<
  typeof threadBackgroundTasksResponseSchema
>;
