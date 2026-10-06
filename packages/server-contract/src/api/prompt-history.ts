import { z } from "zod";
import { promptHistoryListEntrySchema } from "@bb/domain";

export const promptHistoryListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.string().regex(/^\d+$/u).optional(),
});
export type PromptHistoryListQuery = z.infer<
  typeof promptHistoryListQuerySchema
>;

export const promptHistoryListResponseSchema = z.object({
  entries: z.array(promptHistoryListEntrySchema),
  nextCursor: z.string().nullable(),
});
export type PromptHistoryListResponse = z.infer<
  typeof promptHistoryListResponseSchema
>;
