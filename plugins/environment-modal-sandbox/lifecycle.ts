import { z } from "zod";

export const modalMachineResourceSchema = z
  .object({
    version: z.literal(3),
    key: z.string().min(1),
    sandboxId: z.string().min(1).nullable(),
    snapshotImageId: z.string().min(1).nullable(),
    pendingSnapshotImageIds: z.array(z.string().min(1)),
  })
  .strict();

export type ModalMachineResource = z.infer<typeof modalMachineResourceSchema>;

export function readModalMachineResource(value: unknown): ModalMachineResource {
  return modalMachineResourceSchema.parse(value);
}
