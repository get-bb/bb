import { z } from "zod";
import type { SecureStorageLike } from "../profiles/secure-storage";
import { devicePrivateJwkSchema } from "./device-key";

export const deviceAccessRecordSchema = z
  .object({
    privateJwk: devicePrivateJwkSchema,
    credentialId: z.string().min(1),
    accessToken: z.string().min(1),
    accessTokenExpiresAt: z.number().int(),
  })
  .strict();
export type DeviceAccessRecord = z.infer<typeof deviceAccessRecordSchema>;

export interface DeviceAccessStore {
  read(credentialId: string): Promise<DeviceAccessRecord | null>;
  write(credentialId: string, record: DeviceAccessRecord): Promise<void>;
  remove(credentialId: string): Promise<void>;
}

function storageKey(credentialId: string): string {
  return `bb.device-access.${credentialId}`;
}

export function createDeviceAccessStore(
  storage: SecureStorageLike,
): DeviceAccessStore {
  return {
    async read(credentialId) {
      const raw = await storage.getItem(storageKey(credentialId));
      if (raw === null) return null;
      try {
        const parsed = deviceAccessRecordSchema.safeParse(JSON.parse(raw));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async write(credentialId, record) {
      await storage.setItem(storageKey(credentialId), JSON.stringify(record));
    },
    async remove(credentialId) {
      await storage.deleteItem(storageKey(credentialId));
    },
  };
}
