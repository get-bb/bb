import { promptHistoryListResponseSchema } from "../api/prompt-history.js";
import type { GroupOutputSchemas } from "../public-operations.js";

export const promptHistoryOutputSchemas: GroupOutputSchemas<"promptHistory"> = {
  "promptHistory.list": promptHistoryListResponseSchema,
};
