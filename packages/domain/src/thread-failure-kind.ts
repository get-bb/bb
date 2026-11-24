import { z } from "zod";

export const threadFailureKindValues = ["provisioning"] as const;
export const threadFailureKindSchema = z.enum(threadFailureKindValues);
export type ThreadFailureKind = z.infer<typeof threadFailureKindSchema>;
