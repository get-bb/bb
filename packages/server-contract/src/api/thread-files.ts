import { z } from "zod";

/**
 * A thread file uploaded to `POST /threads/import`: a `.jsonl.zst` file written
 * by `GET /threads/:id/export`.
 */
export type ThreadImportForm = Record<"file", Blob>;

/**
 * The result of importing a thread file. `rows` is the number of events in the
 * file; `insertedRows` is how many of them the thread did not already have.
 */
export const threadImportResponseSchema = z.object({
  threadId: z.string().min(1),
  rows: z.number().int().nonnegative(),
  insertedRows: z.number().int().nonnegative(),
});
export type ThreadImportResponse = z.infer<typeof threadImportResponseSchema>;
