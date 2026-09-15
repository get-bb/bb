import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const changeActionSchema = z.enum([
  "created",
  "edited",
  "deleted",
  "renamed",
]);
export type ChangeAction = z.infer<typeof changeActionSchema>;

export const changeStatusSchema = z.enum([
  "pending",
  "completed",
  "error",
  "interrupted",
]);
export type ChangeStatus = z.infer<typeof changeStatusSchema>;

export const changeApprovalStatusSchema = z.enum([
  "waiting_for_approval",
  "denied",
]);

export const timelineCursorSchema = z
  .object({
    anchorSeq: z.number().int().positive(),
    anchorId: z.string().min(1),
  })
  .strict();
export type TimelineCursor = z.infer<typeof timelineCursorSchema>;

export const changeEntrySchema = z
  .object({
    rowId: z.string().min(1),
    threadId: z.string().min(1),
    turnId: z.string().nullable(),
    seqStart: z.number().int().nonnegative(),
    seqEnd: z.number().int().nonnegative(),
    createdAt: z.number(),
    path: z.string(),
    movePath: z.string().nullable(),
    action: changeActionSchema,
    status: changeStatusSchema,
    approvalStatus: changeApprovalStatusSchema.nullable(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    edits: z.number().int().min(1),
    patch: z.string().nullable(),
    patchTruncated: z.boolean(),
    nestedThreadId: z.string().nullable(),
  })
  .strict();
export type ChangeEntry = z.infer<typeof changeEntrySchema>;

export const changeTurnSchema = z
  .object({
    turnId: z.string().min(1),
    startedAt: z.number(),
    completedAt: z.number().nullable(),
    durationMs: z.number().int().nonnegative().nullable(),
    status: changeStatusSchema,
    promptExcerpt: z.string().nullable(),
  })
  .strict();
export type ChangeTurn = z.infer<typeof changeTurnSchema>;

export const changeFileSchema = z
  .object({
    path: z.string(),
    action: changeActionSchema,
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    changes: z.number().int().nonnegative(),
    edits: z.number().int().nonnegative(),
    lastCreatedAt: z.number(),
  })
  .strict();
export type ChangeFile = z.infer<typeof changeFileSchema>;

export const changeTotalsSchema = z
  .object({
    changes: z.number().int().nonnegative(),
    files: z.number().int().nonnegative(),
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    edits: z.number().int().nonnegative(),
  })
  .strict();
export type ChangeTotals = z.infer<typeof changeTotalsSchema>;

export const changePageSchema = z
  .object({
    hasOlder: z.boolean(),
    olderCursor: timelineCursorSchema.nullable(),
  })
  .strict();
export type ChangePage = z.infer<typeof changePageSchema>;

export const changeLogEntryLimit = 500;
export const changeLogPatchCharLimit = 200_000;

export const changeLogRpcContract = defineRpcContract({
  listChanges: {
    input: z
      .object({
        threadId: z.string().min(1),
        beforeAnchorSeq: z.number().int().positive().optional(),
        beforeAnchorId: z.string().min(1).optional(),
      })
      .strict(),
    output: z
      .object({
        thread: z
          .object({
            id: z.string().min(1),
            title: z.string(),
            environmentId: z.string().nullable(),
          })
          .strict(),
        entries: z.array(changeEntrySchema),
        turns: z.array(changeTurnSchema),
        files: z.array(changeFileSchema),
        totals: changeTotalsSchema,
        page: changePageSchema,
        truncated: z.boolean(),
      })
      .strict(),
  },
});
