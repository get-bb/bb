import { z } from "zod";

export const AI_TASKS = ["thread-title", "commit-message", "voice"] as const;
export const aiTaskSchema = z.enum(AI_TASKS);
export type AiTask = z.infer<typeof aiTaskSchema>;

export const AI_TEXT_TASKS = ["thread-title", "commit-message"] as const;
export const aiTextTaskSchema = z.enum(AI_TEXT_TASKS);
export type AiTextTask = z.infer<typeof aiTextTaskSchema>;

export const aiServiceSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("automatic") }).strict(),
  z.object({ mode: z.literal("off") }).strict(),
  z
    .object({
      mode: z.literal("service"),
      pluginId: z.string().min(1),
      serviceId: z.string().min(1),
    })
    .strict(),
]);
export type AiServiceSelection = z.infer<typeof aiServiceSelectionSchema>;

export const aiServiceSelectionsSchema = z
  .object({
    "thread-title": aiServiceSelectionSchema,
    "commit-message": aiServiceSelectionSchema,
    voice: aiServiceSelectionSchema,
  })
  .strict();
export type AiServiceSelections = z.infer<typeof aiServiceSelectionsSchema>;

export const defaultAiServiceSelections: AiServiceSelections = {
  "thread-title": { mode: "automatic" },
  "commit-message": { mode: "automatic" },
  voice: { mode: "automatic" },
};

export const aiServiceStatusSchema = z.discriminatedUnion("ready", [
  z.object({ ready: z.literal(true) }).strict(),
  z.object({ ready: z.literal(false), message: z.string().min(1) }).strict(),
]);
export type AiServiceStatus = z.infer<typeof aiServiceStatusSchema>;
