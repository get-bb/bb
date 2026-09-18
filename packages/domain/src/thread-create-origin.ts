import { z } from "zod";

export const threadCreateOriginValues = ["app", "cli", "sdk", "plugin"] as const;
export const threadCreateOriginSchema = z.enum(threadCreateOriginValues);
export type ThreadCreateOrigin = z.infer<typeof threadCreateOriginSchema>;
