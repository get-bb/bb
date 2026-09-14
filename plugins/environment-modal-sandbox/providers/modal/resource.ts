import { z } from "zod";

export const modalMachineResourceSchema = z.object({
  key: z.string().min(1),
  sandboxId: z.string().min(1).nullable(),
  snapshotImageId: z.string().min(1).nullable(),
  pendingSnapshotImageIds: z.array(z.string().min(1)),
  imageId: z.string().min(1),
  accountIdentity: z.string().min(1),
  appName: z.string().min(1),
  cpu: z.number().positive(),
  memoryMiB: z.number().positive(),
  snapshotSandboxId: z.string().min(1).nullable(),
});
export type ModalMachineResource = z.infer<typeof modalMachineResourceSchema>;
export function readModalMachineResource(value: unknown): ModalMachineResource {
  return modalMachineResourceSchema.parse(value);
}
