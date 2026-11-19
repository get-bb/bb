import { z } from "zod";

export const accessCredentialKindValues = ["browser", "device"] as const;
export const accessCredentialKindSchema = z.enum(accessCredentialKindValues);
export type AccessCredentialKind = z.infer<typeof accessCredentialKindSchema>;
