import { z } from "zod";

/**
 * A thread file uploaded to `POST /threads/import`: a `.jsonl.zst` file written
 * by `GET /threads/:id/export`.
 */
export type ThreadImportForm = Record<"file", Blob>;

/**
 * The result of importing a thread file: the recreated thread and the number of
 * events it was recreated with.
 */
export const threadImportResponseSchema = z.object({
  threadId: z.string().min(1),
  rows: z.number().int().nonnegative(),
});
export type ThreadImportResponse = z.infer<typeof threadImportResponseSchema>;
