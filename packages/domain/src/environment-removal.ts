import { z } from "zod";

export const environmentRemovalCursorSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((value) => Number.isSafeInteger(Number(value)));

export const environmentRemovalSchema = z.object({
  id: environmentRemovalCursorSchema,
  environmentId: z.string(),
  removedAt: z.number(),
  hostId: z.string().nullable(),
  path: z.string().nullable(),
  providerOwnedPath: z.boolean(),
});
export type EnvironmentRemoval = z.infer<typeof environmentRemovalSchema>;
export const environmentRemovalPageSchema = z.object({
  status: z.enum(["ok", "cursorExpired"]),
  removals: z.array(environmentRemovalSchema),
  nextCursor: environmentRemovalCursorSchema,
  hasMore: z.boolean(),
});
export type EnvironmentRemovalPage = z.infer<
  typeof environmentRemovalPageSchema
>;
