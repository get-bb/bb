import { z } from "zod";

const tokenCountSchema = z.number().int().nonnegative();

export const contextEntrySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  tokens: tokenCountSchema,
});
export type ContextEntry = z.infer<typeof contextEntrySchema>;

export const contextCategorySchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["used", "free", "reserved", "deferred"]),
  tokens: tokenCountSchema,
  entries: z.array(contextEntrySchema),
});
export type ContextCategory = z.infer<typeof contextCategorySchema>;

export const contextSnapshotSchema = z.object({
  capturedAt: z.iso.datetime(),
  providerSessionId: z.string().min(1),
  providerTurnId: z.string().min(1).nullable(),
  model: z.string().min(1),
  usedTokens: tokenCountSchema,
  contextWindowTokens: z.number().int().positive(),
  autoCompactAtTokens: z.number().int().positive().nullable(),
  estimated: z.boolean(),
  categories: z.array(contextCategorySchema),
});
export type ContextSnapshot = z.infer<typeof contextSnapshotSchema>;
