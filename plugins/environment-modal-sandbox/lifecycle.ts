import { z } from "zod";

const common = z.object({
  key: z.string().min(1),
  sandboxId: z.string().min(1).nullable(),
  snapshotImageId: z.string().min(1).nullable(),
  pendingSnapshotImageIds: z.array(z.string().min(1)),
});
const current = common
  .extend({
    version: z.literal(5),
    imageId: z.string().min(1).nullable(),
    accountIdentity: z.string().min(1).nullable(),
    appName: z.string().min(1).nullable(),
    cpu: z.number().positive().nullable(),
    memoryMiB: z.number().positive().nullable(),
    expiresAt: z.number().nullable(),
  })
  .strict();
const legacy = common
  .extend({
    version: z.union([z.literal(3), z.literal(4)]),
    imageId: z.string().optional(),
    accountIdentity: z.string().optional(),
    appName: z.string().optional(),
    resources: z
      .object({ cpuCores: z.number(), memoryMiB: z.number() })
      .optional(),
    expiresAt: z.number().nullable().optional(),
  })
  .transform((value) => ({
    version: 5 as const,
    key: value.key,
    sandboxId: value.sandboxId,
    snapshotImageId: value.snapshotImageId,
    pendingSnapshotImageIds: value.pendingSnapshotImageIds,
    imageId: value.imageId ?? null,
    accountIdentity: value.accountIdentity ?? null,
    appName: value.appName ?? null,
    cpu: value.resources?.cpuCores ?? null,
    memoryMiB: value.resources?.memoryMiB ?? null,
    expiresAt: value.expiresAt ?? null,
  }));
export const modalMachineResourceSchema = z.union([current, legacy]);
export type ModalMachineResource = z.infer<typeof modalMachineResourceSchema>;
export function readModalMachineResource(value: unknown): ModalMachineResource {
  return modalMachineResourceSchema.parse(value);
}
