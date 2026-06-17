import { z } from "zod";

export const threadSearchSourceKindValues = [
  "title",
  "title_fallback",
  "user_message",
  "assistant_message",
  "system_message",
] as const;

export const threadSearchSourceKindSchema = z.enum(
  threadSearchSourceKindValues,
);
export type ThreadSearchSourceKind = z.infer<
  typeof threadSearchSourceKindSchema
>;
