import { z } from "zod";

export const threadVisibilityValues = ["visible", "hidden"] as const;
export const threadVisibilitySchema = z.enum(threadVisibilityValues);
export type ThreadVisibility = z.infer<typeof threadVisibilitySchema>;
