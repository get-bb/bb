import { z } from "zod";

export const threadSearchRequestSchema = z.object({
  query: z.string(),
  limitPerGroup: z.number().int().positive(),
});

export const threadSearchWorkerResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    rows: z.array(
      z.object({
        archived: z.union([z.literal(0), z.literal(1)]),
        segmentOrder: z.number(),
        sourceKind: z.string(),
        sourceSeq: z.number().nullable(),
        text: z.string(),
        threadId: z.string(),
        threadOrder: z.number(),
        total: z.number(),
      }),
    ),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
