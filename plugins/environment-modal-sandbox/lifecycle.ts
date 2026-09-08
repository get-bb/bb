import { z } from "zod";
import { policySchema, resourcesSchema } from "./catalogue/model.js";

const legacyResourceSchema = z
  .object({
    version: z.literal(3),
    key: z.string().min(1),
    sandboxId: z.string().min(1).nullable(),
    snapshotImageId: z.string().min(1).nullable(),
    pendingSnapshotImageIds: z.array(z.string().min(1)),
  })
  .strict();
export const pinnedResourceSchema = legacyResourceSchema
  .extend({
    version: z.literal(4),
    buildId: z.string().min(1),
    imageId: z.string().min(1),
    accountRef: z.literal("default"),
    accountIdentity: z.string().min(1),
    appName: z.string().min(1),
    resources: resourcesSchema,
    policy: policySchema,
    expiresAt: z.number().nullable(),
    policyRevision: z.number().int().nonnegative().default(0),
  })
  .strict();
export const modalMachineResourceSchema = z.union([
  pinnedResourceSchema,
  legacyResourceSchema,
]);
export type ModalMachineResource = z.infer<typeof modalMachineResourceSchema>;
export function readModalMachineResource(value: unknown): ModalMachineResource {
  return modalMachineResourceSchema.parse(value);
}
