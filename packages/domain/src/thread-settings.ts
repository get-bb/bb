import { z } from "zod";

export const archivedConversationRetentionSchema = z.enum([
  "forever",
  "30-days",
]);
export type ArchivedConversationRetention = z.infer<
  typeof archivedConversationRetentionSchema
>;

export const threadSettingsSchema = z
  .object({
    archivedConversationRetention: archivedConversationRetentionSchema,
  })
  .strict();
export type ThreadSettings = z.infer<typeof threadSettingsSchema>;

export const defaultThreadSettings: ThreadSettings = {
  archivedConversationRetention: "forever",
};
