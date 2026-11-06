import { threadQueuedMessageListResponseSchema } from "../api/threads.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const queueOutputSchemas: GroupOutputSchemas<"queue"> = {
  "queue.list": threadQueuedMessageListResponseSchema,
};
