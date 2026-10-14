import {
  deserializeSigningKeyPair,
  generateSigningKeyPair,
  localDeviceIdentity,
  serializeSigningKeyPair,
  type DeviceIdentity,
} from "@bb/sealed-channel";
import { z } from "zod";
import type { SecureStorageLike } from "../profiles/secure-storage";

const storedKeyPairSchema = z
  .object({ publicKey: z.string().min(1), secretKey: z.string().min(1) })
  .strict();

export const SEALED_DEVICE_STORAGE_KEY = "bb.sealed.device";

export interface SealedDeviceIdentityStore {
  load(): Promise<DeviceIdentity>;
  reset(): Promise<DeviceIdentity>;
}

export function createSealedDeviceIdentityStore(
  storage: SecureStorageLike,
): SealedDeviceIdentityStore {
  let cached: DeviceIdentity | null = null;
  let loading: Promise<DeviceIdentity> | null = null;

  async function generate(): Promise<DeviceIdentity> {
    const pair = generateSigningKeyPair();
    await storage.setItem(
      SEALED_DEVICE_STORAGE_KEY,
      JSON.stringify(serializeSigningKeyPair(pair)),
    );
    cached = localDeviceIdentity(pair);
    return cached;
  }

  return {
    load() {
      if (cached !== null) return Promise.resolve(cached);
      loading ??= (async () => {
        const raw = await storage.getItem(SEALED_DEVICE_STORAGE_KEY);
        if (raw !== null) {
          try {
            const parsed = storedKeyPairSchema.safeParse(JSON.parse(raw));
            if (parsed.success) {
              cached = localDeviceIdentity(
                deserializeSigningKeyPair(parsed.data),
              );
              return cached;
            }
          } catch {}
        }
        return generate();
      })().finally(() => {
        loading = null;
      });
      return loading;
    },
    reset: generate,
  };
}
